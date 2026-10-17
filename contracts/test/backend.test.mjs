// Integration checks exercise Person 3's existing code without editing it or opening external connections.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readConfig } from '../../backend/src/config.ts';
import { loadHandoffs } from '../../backend/src/runtime/handoffs.ts';
import { Contracts, normalizeQuery } from '../../backend/src/services/validation.ts';
import { normalizeArticle } from '../../backend/src/data/ingestion.ts';
import { EvidenceLedger } from '../../backend/src/services/gemini/citations.ts';
import { schemas } from '../dist/index.js';

const examples = JSON.parse(await readFile(new URL('../examples/helene-core.json', import.meta.url), 'utf8'));
const contracts = new Contracts(schemas);

test('existing backend loader imports the compiled module and preserves partial readiness', async () => {
  const handoff = await loadHandoffs(readConfig({ ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' }));
  for (const name of Object.keys(schemas)) assert.equal(handoff.contracts.has(name), true);
  assert.equal(handoff.contracts.ready, false);
  assert.equal(handoff.databaseHandoff, undefined);
  assert.deepEqual(handoff.contracts.parse('Article', examples.articles[0], true), examples.articles[0]);
});

test('existing GET normalization feeds the shared query schema without coercion or defaults', () => {
  const normalized = normalizeQuery({ location_ids: 'loc-asheville-nc,loc-buncombe-county-nc', themes: 'flooding', bounds: '-83,35,-82,36', limit: '20', offset: '0' });
  assert.deepEqual(contracts.parse('NewsQuery', normalized), {
    location_ids: ['loc-asheville-nc', 'loc-buncombe-county-nc'], themes: ['flooding'], bounds: [-83, 35, -82, 36], limit: 20, offset: 0
  });
  assert.throws(() => contracts.parse('NewsQuery', { limit: '20' }), /Invalid NewsQuery/);
});

test('existing article normalizer supports GDELT unknown publication and RSS feed assertions', () => {
  // Synthetic protocol inputs only; no external provider is contacted.
  const definition = { id: 'synthetic-feed', excerpts_permitted: false };
  const raw = { title: 'Synthetic protocol headline', publisher: 'Synthetic publisher', url: 'https://example.invalid/story?utm_source=test',
    excerpt: null, published_at: null, discovered_at: '2026-01-01T00:00:00.000Z', publication_time_basis: 'unavailable', provider: 'gdelt' };
  const article = normalizeArticle(raw, definition, Date.parse('2026-01-02T00:00:00Z'), contracts);
  assert.equal(article.published_at, null);
  assert.equal('published_date' in article, false);
  assert.equal(article.url, 'https://example.invalid/story');
  assert.deepEqual(article.location_ids, []);
  const rss = normalizeArticle({ ...raw, provider: 'rss', published_at: '2026-01-01T00:00:00.000Z', publication_time_basis: 'feed_asserted', discovered_at: null,
    excerpt: 'Synthetic permitted feed excerpt.' }, { ...definition, excerpts_permitted: true }, Date.parse('2026-01-02T00:00:00Z'), contracts);
  assert.equal(rss.excerpt, 'Synthetic permitted feed excerpt.');
});

test('existing citation ledger resolves original sources and rejects unsupported relationships', () => {
  const article = examples.articles[0], source = examples.sources.find(source => source.id === article.source_id);
  const ledger = new EvidenceLedger();
  ledger.collect({ items: [article] });
  ledger.attach([source]);
  assert.deepEqual(ledger.resolve([{ source_id: source.id, record_id: article.id }], contracts), [{ source_id: source.id, record_id: article.id, url: source.url, title: source.title }]);
  assert.throws(() => ledger.resolve([{ source_id: source.id, record_id: examples.articles[1].id }], contracts), /not retrieved/);
  assert.throws(() => ledger.resolve([{ source_id: source.id, record_id: article.id, url: 'https://example.invalid/forged' }], contracts), /does not match/);
});

test('backend configuration checker reports the five supplied contracts and remaining setup honestly', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/check.ts'], {
    cwd: fileURLToPath(new URL('../../backend/', import.meta.url)), encoding: 'utf8', timeout: 15000,
    // Do not inherit credentials or load .env. This checker imports local handoffs only.
    env: { PATH: process.env.PATH, NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js',
      ATLAS_DATABASE_MODULE: 'db/handoff/database.mjs', ATLAS_SOURCES_MODULE: 'scripts/source-definitions/atlas.mjs' }
  });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.contracts.complete, false);
  assert.equal(report.contracts.missing.length, 19);
  for (const name of ['NewsQuery', 'Article', 'Location', 'Source', 'Citation']) assert.equal(report.contracts.missing.includes(name), false);
  assert.deepEqual(report.database.missing_plans, []);
  assert.equal(report.database.credentials_configured, false);
  assert.equal(report.live_connections_verified, false);
});
