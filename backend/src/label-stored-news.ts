import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile} from 'node:fs/promises';
import {readConfig} from './config.js';
import {createPool} from './data/database.js';
import {cleanTigerUri} from './setup/tiger.js';

// One explicit, reviewed metadata batch. No fetching, automatic classification,
// schema changes, article verification changes, or API write endpoint.
interface LabelRow {article_id: string; url: string; title: string; expected_content_hash: string; theme_ids: string[]; basis: string}
interface Manifest {version: number; themes: {id: string; label: string}[]; articles: LabelRow[]}
const manifestPath = new URL('../data/manual-topic-labels-2026-10-18.json', import.meta.url);
const receiptPath = new URL('../data/manual-topic-labels-2026-10-18.receipt.json', import.meta.url);
const execute = promisify(execFile);
let phase = 'validate_batch';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length && args[0] !== '--apply') throw new Error('Use no arguments for a dry run, or --apply');
  const apply = args[0] === '--apply';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const themeIds = new Set(manifest.themes.map(t => t.id));
  if (manifest.version !== 1 || manifest.articles.length !== 44 || themeIds.size !== manifest.themes.length ||
      new Set(manifest.articles.map(a => a.article_id)).size !== manifest.articles.length ||
      manifest.articles.some(a => !a.basis || !a.theme_ids.length || a.theme_ids.some(t => !themeIds.has(t))))
    throw new Error('Invalid reviewed metadata batch');
  const config = readConfig();
  if (!config.databaseUrl) throw new Error('Existing database configuration is required');
  if (apply) {
    // The runtime role deliberately cannot curate theme links. Use the saved
    // owner credential only for this batch; never grant new runtime privileges.
    const target = new URL(config.databaseUrl), service = target.hostname.split('.')[0]!;
    const cli = async (parts: string[]) => (await execute('tiger', ['--analytics=false', '--version-check=false', ...parts],
      {timeout: 20000, maxBuffer: 1000000})).stdout;
    phase = 'verify_dev_service';
    const state = JSON.parse(await cli(['service', 'get', service, '-o', 'json']));
    if (state.status !== 'READY' || state.metadata?.environment !== 'DEV') throw new Error('Only the existing READY DEV service is allowed');
    phase = 'load_saved_owner_connection';
    const admin = cleanTigerUri(await cli(['db', 'uri', service, '--role', 'tsdbadmin', '--with-password']));
    if (admin.hostname !== target.hostname || admin.port !== target.port || admin.pathname !== target.pathname ||
        decodeURIComponent(admin.username) !== 'tsdbadmin') throw new Error('Owner connection does not match configured database');
    config.databaseUrl = admin.href;
  }
  phase = 'connect_database';
  const pool = await createPool(config);
  if (!pool) throw new Error('Database unavailable');
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY'); transaction = true;
    if (apply) await client.query("SET LOCAL lock_timeout = '5s'");
    phase = 'verify_article_snapshots';
    const {rows} = await client.query(`SELECT id, url, title, content_hash, provider, verification_status
      FROM atlas.articles WHERE id = ANY($1::text[]) ORDER BY id ${apply ? 'FOR UPDATE' : ''}`,
      [manifest.articles.map(a => a.article_id)]);
    const byId = new Map(rows.map(a => [a.id, a]));
    for (const expected of manifest.articles) {
      const actual = byId.get(expected.article_id);
      if (!actual || actual.provider === 'curated' || actual.verification_status !== 'unreviewed' ||
          actual.url !== expected.url || actual.title !== expected.title || actual.content_hash !== expected.expected_content_hash)
        throw new Error('A target article is missing, reviewed, or changed since the metadata review; no labels applied');
    }
    const existing = await client.query('SELECT article_id, theme_id FROM atlas.article_themes WHERE article_id = ANY($1::text[])',
      [manifest.articles.map(a => a.article_id)]);
    const existingLinks = new Set(existing.rows.map(a => `${a.article_id}/${a.theme_id}`));
    const additions = manifest.articles.flatMap(a => a.theme_ids.filter(t => !existingLinks.has(`${a.article_id}/${t}`))
      .map(theme_id => ({article_id: a.article_id, theme_id})));
    const report = {mode: apply ? 'apply' : 'dry_run', targeted_articles: rows.length,
      articles_with_additions: new Set(additions.map(a => a.article_id)).size, new_links: additions.length};
    if (apply) {
      phase = 'insert_topic_links';
      const insertedThemes: string[] = [], insertedLinks: {article_id: string; theme_id: string}[] = [];
      for (const theme of manifest.themes) {
        const result = await client.query('INSERT INTO atlas.themes (id, label) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [theme.id, theme.label]);
        insertedThemes.push(...result.rows.map(t => t.id));
      }
      for (const link of additions) {
        const result = await client.query(`INSERT INTO atlas.article_themes (article_id, theme_id) VALUES ($1, $2)
          ON CONFLICT (article_id, theme_id) DO NOTHING RETURNING article_id, theme_id`, [link.article_id, link.theme_id]);
        insertedLinks.push(...result.rows);
      }
      // Keep a durable receipt of precisely this batch's additions for review
      // and selective reversal. A no-op rerun preserves the original receipt.
      if (insertedThemes.length || insertedLinks.length) {
        const receipt = {status: 'pending_commit', applied_at: new Date().toISOString(), inserted_themes: insertedThemes, inserted_links: insertedLinks};
        await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
        await client.query('COMMIT'); transaction = false;
        await writeFile(receiptPath, JSON.stringify({...receipt, status: 'committed'}, null, 2) + '\n');
      } else {await client.query('COMMIT'); transaction = false;}
    } else {await client.query('ROLLBACK'); transaction = false;}
    console.log(JSON.stringify(report));
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    client.release(); await pool.end();
  }
}

main().catch(() => {
  // Child-process/pg errors may contain credentials. Do not print raw errors.
  console.error(`Manual label batch failed during ${phase}. Existing metadata was preserved unless the receipt records a completed commit.`);
  process.exitCode = 1;
});
