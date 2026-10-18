// Person 4 handoff check: runs every plan in db/handoff/database.mjs through the backend's own PgRepository
// (same pg driver, parameter binding and transactions) against a DISPOSABLE local database with migrations 001–006,
// db/roles/atlas_runtime.sql and the Helene seed loaded. It writes test rows, so it refuses non-local hosts.
// Run from backend/ (uses its pinned dependencies):
//   ATLAS_CHECK_ADMIN_URL=postgres://postgres:<local-pw>@127.0.0.1:55432/atlas \
//   ATLAS_CHECK_RUNTIME_URL=postgres://atlas_runtime:<local-pw>@127.0.0.1:55432/atlas \
//   node --import tsx ../db/checks/validate-handoff.mts
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const adminUrl = process.env.ATLAS_CHECK_ADMIN_URL, runtimeUrl = process.env.ATLAS_CHECK_RUNTIME_URL;
for (const url of [adminUrl, runtimeUrl]) {
  if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('Set ATLAS_CHECK_ADMIN_URL and ATLAS_CHECK_RUNTIME_URL to a disposable local database');
}
const require = createRequire(`${repo}/backend/package.json`);
const pg = require('pg');
const { PgRepository, validateDatabaseHandoff } = await import(pathToFileURL(`${repo}/backend/src/data/queries.ts`).href);
const { matchesNews } = await import(pathToFileURL(`${repo}/backend/src/services/retrieval.ts`).href);
const mod = await import(pathToFileURL(`${repo}/db/handoff/database.mjs`).href);

const handoff = validateDatabaseHandoff(mod.databaseHandoff);
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const pool = new pg.Pool({ connectionString: runtimeUrl, max: 5 });
const repoDb = new PgRepository(pool, handoff);
assert.deepEqual(repoDb.missingPlans, []);
let checks = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++; };
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------- news: ordering, types, filter parity with the backend reference (before pagination) ----------
const all = await repoDb.read('news', { limit: 100, offset: 0 });
ok(all.length === 10, `10 seeded articles, got ${all.length}`);
for (const a of all) {
  ok(a.published_at === null || iso.test(a.published_at), `UTC ISO published_at ${a.id}`);
  ok(Array.isArray(a.location_ids) && Array.isArray(a.themes) && Array.isArray(a.entity_ids), 'arrays');
  ok(typeof a.fetched_at === 'string' && iso.test(a.fetched_at), 'fetched_at');
}
const order = [...all].sort((x, y) => (x.published_at === null) !== (y.published_at === null) ? (x.published_at === null ? 1 : -1)
  : x.published_at !== y.published_at ? (x.published_at < y.published_at ? 1 : -1) : (x.id < y.id ? -1 : 1));
ok(JSON.stringify(order.map(a => a.id)) === JSON.stringify(all.map(a => a.id)), 'published desc nulls last, id tiebreak');

const locs = await repoDb.read('locations', { limit: 100, offset: 0 });
const within = (ids: string[], [w, s, e, n]: number[]) => ids.some(id => {
  const p = locs.find(l => l.id === id); if (!p) return false;
  if (p.bounds) return p.bounds[0] >= w && p.bounds[2] <= e && p.bounds[1] >= s && p.bounds[3] <= n;
  return p.coordinates && p.coordinates[0] >= w && p.coordinates[0] <= e && p.coordinates[1] >= s && p.coordinates[1] <= n;
});
const queries: Record<string, unknown>[] = [
  { location_ids: ['loc-asheville-nc'] },
  { location_ids: ['loc-asheville-nc', 'loc-usgs-03451500'] },
  { themes: ['drinking-water'] },
  { themes: ['drinking-water'], location_ids: ['loc-buncombe-county-nc'] },
  { entity_ids: ['ent-usgs'] },
  { keyword: 'boil' }, { keyword: '  BOIL  ' }, { keyword: '%' }, { keyword: '_' }, { keyword: "here's" },
  { published_from: '2024-10-01T00:00:00.000Z', published_to: '2024-10-31T23:59:59.000Z' },
  { published_from: '2024-11-18T19:15:44.305Z' },
  { bounds: [-82.62, 35.54, -82.52, 35.62] },              // gauge points only; city/county extents do not fit
  { bounds: [-83, 35.4, -82.4, 35.7] },                    // fits Asheville extent, not Buncombe
  { bounds: [-90, 30, -80, 40] },                          // fits everything
  { themes: [] }, { location_ids: ['no-such-location'] }
];
for (const q of queries) {
  const rows = await repoDb.read('news', { ...q, limit: 100, offset: 0 });
  const expected = all.filter(a => matchesNews(a, q) && (!q.bounds || within(a.location_ids, q.bounds as number[]))).map(a => a.id);
  ok(JSON.stringify(rows.map(r => r.id)) === JSON.stringify(expected), `news parity ${JSON.stringify(q)}: got ${rows.map(r => r.id)} expected ${expected}`);
  // Pagination happens after filtering: page 2 of size 2 equals slice(2,4).
  const page = await repoDb.read('news', { ...q, limit: 2, offset: 2 });
  ok(JSON.stringify(page.map(r => r.id)) === JSON.stringify(expected.slice(2, 4)), `pagination after filter ${JSON.stringify(q)}`);
}

// ---------- locations ----------
ok((await repoDb.read('locations', { ids: ['loc-asheville-nc'], limit: 50, offset: 0 })).length === 1, 'locations by id');
const byName = await repoDb.read('locations', { query: 'usgs', limit: 50, offset: 0 });
ok(byName.length === 2 && byName.every(l => l.precision === 'facility' && l.bounds === null && l.coordinates.length === 2), 'facility points, no bounds');
const city = locs.find(l => l.id === 'loc-asheville-nc');
ok(city.precision === 'city' && city.bounds.length === 4 && city.coordinates_basis === 'census_2020_internal_point', 'city keeps extent');
ok((await repoDb.read('locations', { query: '%', limit: 50, offset: 0 })).length === 0, 'literal % in location query');

// ---------- investigation ----------
const [inv] = await repoDb.read('investigation', { id: 'inv-helene-asheville-2024' });
ok(inv && inv.investigation.id === 'inv-helene-asheville-2024', 'investigation found');
ok((await repoDb.read('investigation', { id: 'nope' })).length === 0, 'unknown investigation: zero rows');
const sourceIds = new Set(inv.sources.map((s: { id: string }) => s.id));
const cited: string[] = [];
for (const it of inv.investigation.items) cited.push(...it.source_ids);
for (const a of inv.articles) cited.push(a.source_id);
for (const e of inv.evidence) cited.push(e.source_id, ...e.source_ids);
for (const o of inv.observations) cited.push(o.source_id);
for (const s of inv.observation_series) cited.push(s.source_id);
ok(cited.every(id => sourceIds.has(id)), `every cited source is returned: missing ${cited.filter(id => !sourceIds.has(id))}`);
ok(inv.sources.every((s: { url: string }) => s.url.startsWith('https://')), 'HTTPS sources');
ok(inv.articles.length === 10 && inv.evidence.length === 9 && inv.observations.length === 7 && inv.locations.length === 4 && inv.observation_series.length === 5, 'counts');
const crest = inv.observations.find((o: { id: string }) => o.id === 'usgs-03451500-discharge@20240927T213800Z');
ok(crest && crest.value === 113000 && crest.unit === 'ft3/s' && crest.observed_at === '2024-09-27T21:38:00.000Z', 'crest observation');
ok(inv.investigation.key_observations.every((k: { observation_id: string }) => inv.observations.some((o: { id: string }) => o.id === k.observation_id)), 'key observations resolve');
const imagery = inv.evidence.filter((e: { type: string }) => e.type === 'imagery');
ok(imagery.length === 2 && imagery.every((e: { imagery: { bounds: number[] } }) => JSON.stringify(e.imagery.bounds) === '[-82.62,35.54,-82.52,35.62]'), 'imagery bounds');
ok(inv.investigation.items.filter((i: { kind: string }) => i.kind === 'business_exposure').length === 0, 'no business exposure claimed');
ok(JSON.stringify(inv).length < 64000, `investigation fits AI context bound (${JSON.stringify(inv).length} bytes)`);

// ---------- observations ----------
const obs = await repoDb.read('observations', { location_id: 'loc-usgs-03451500', metric: 'discharge',
  observed_from: '2024-09-27T21:00:00Z', observed_to: '2024-09-27T22:00:00Z', limit: 100, offset: 0 });
ok(obs.length === 6 && obs.some(o => o.value === 113000 && o.observed_at === '2024-09-27T21:38:00.000Z'), `crest window ${obs.map(o => o.value)}`);
ok(obs.every(o => typeof o.value === 'number' && o.unit === 'ft3/s' && o.location_id === 'loc-usgs-03451500' && o.metric === 'discharge'), 'one series, numeric');
const page2 = await repoDb.read('observations', { location_id: 'loc-usgs-03451500', metric: 'discharge', limit: 3, offset: 3 });
ok(page2.length === 3 && page2[0].observed_at === '2024-09-20T00:45:00.000Z', 'observation pagination ascending');
const peaks = await repoDb.read('observations', { location_id: 'loc-usgs-03451500', metric: 'annual_peak_discharge', limit: 100, offset: 0 });
ok(peaks.length === 100 && peaks[0].time_precision === 'day' && peaks[0].period_start !== null, 'peaks paged at 100 with periods');
ok((await repoDb.read('observations', { location_id: 'loc-usgs-03451500', limit: 100, offset: 0 }))
  .every(o => o.location_id === 'loc-usgs-03451500'), 'location filter');

// ---------- sources ----------
const srcs = await repoDb.read('sources', { ids: ['src-wbtv-boil-water-lifted', 'src-usgs-news-helene-streamgages', 'missing'] });
ok(srcs.length === 2 && srcs.find(s => s.id === 'src-usgs-news-helene-streamgages').published_date === '2024-10-04', 'sources incl. date-only');
ok(srcs.find(s => s.id === 'src-wbtv-boil-water-lifted').published_at === '2024-11-18T19:15:44.305Z', 'ms precision preserved');

// ---------- freshness + mark_refresh (failed refresh preserves last_successful_at) ----------
const [cov] = await repoDb.read('freshness', {});
ok(cov.scope === 'all' && cov.datasets.length === 5 && cov.articles.total === 10 && cov.feeds.length === 0, 'coverage row');
ok((await repoDb.read('freshness', { source_id: 'gdelt-test' })).length === 0, 'no state yet');
await repoDb.writeBatch('mark_refresh', [{ source_id: 'gdelt-test', attempted_at: '2026-10-17T12:00:00.000Z', status: 'success', last_successful_at: '2026-10-17T12:00:01.000Z', next_retry_at: null }]);
await repoDb.writeBatch('mark_refresh', [{ source_id: 'gdelt-test', attempted_at: '2026-10-17T13:00:00.000Z', status: 'failed', last_successful_at: null, next_retry_at: '2026-10-17T13:15:00.000Z' }]);
let [st] = await repoDb.read('freshness', { source_id: 'gdelt-test' });
ok(st.status === 'failed' && st.last_successful_at === '2026-10-17T12:00:01.000Z' && st.next_retry_at === '2026-10-17T13:15:00.000Z' && st.consecutive_failures === 1, `failure preserves success: ${JSON.stringify(st)}`);
await repoDb.writeBatch('mark_refresh', [{ source_id: 'gdelt-test', attempted_at: '2026-10-17T14:00:00.000Z', status: 'success', last_successful_at: '2026-10-17T14:00:02.000Z', next_retry_at: null }]);
[st] = await repoDb.read('freshness', { source_id: 'gdelt-test' });
ok(st.status === 'success' && st.next_retry_at === null && st.consecutive_failures === 0 && st.last_successful_at === '2026-10-17T14:00:02.000Z', 'success clears retry');

// ---------- upsert_articles ----------
const base = { provider: 'gdelt', provider_source_id: 'gdelt-test', publication_time_basis: 'unavailable', excerpt: null, published_at: null,
  event_at: null, location_ids: [], entity_ids: [], themes: [], verification_status: 'unreviewed', geographic_precision: null };
const newUrl = 'https://example.org/news/helene-test-article';
await repoDb.writeBatch('upsert_articles', [{ ...base, id: 'article-test-1', source_id: 'source-test-1', url: newUrl, title: 'Test discovery title',
  publisher: 'example.org', discovered_at: '2026-10-17T10:00:00.000Z', fetched_at: '2026-10-17T12:00:00.000Z' }]);
let r = await pool.query(`SELECT a.verification_status, a.source_id, s.source_type, (SELECT count(*)::int FROM atlas.article_discoveries d WHERE d.article_id = a.id) d,
  (SELECT count(*)::int FROM atlas.text_chunks c WHERE c.article_id = a.id) c, a.content_hash = atlas.article_content_hash(a.title, a.excerpt) h
  FROM atlas.articles a JOIN atlas.sources s ON s.id = a.source_id WHERE a.url = $1`, [newUrl]);
ok(r.rows[0].verification_status === 'unreviewed' && r.rows[0].d === 1 && r.rows[0].c === 1 && r.rows[0].h, 'new import: unreviewed + discovery + chunk');
// RSS later asserts a publication time; a later GDELT refresh with NULL must not erase it.
await repoDb.writeBatch('upsert_articles', [{ ...base, provider: 'rss', provider_source_id: 'rss-test', publication_time_basis: 'feed_asserted',
  id: 'article-test-1', source_id: 'source-test-1', url: newUrl, title: 'Test discovery title', excerpt: 'Permitted excerpt.', publisher: 'Example',
  published_at: '2026-10-16T08:00:00.000Z', discovered_at: null, fetched_at: '2026-10-17T12:30:00.000Z' }]);
await repoDb.writeBatch('upsert_articles', [{ ...base, id: 'article-test-1', source_id: 'source-test-1', url: newUrl, title: 'Test discovery title',
  publisher: 'example.org', discovered_at: '2026-10-17T11:00:00.000Z', fetched_at: '2026-10-17T13:00:00.000Z' }]);
r = await pool.query(`SELECT published_at, publication_time_basis, excerpt, discovered_at, fetched_at,
  (SELECT count(*)::int FROM atlas.article_discoveries d WHERE d.article_id = a.id) d,
  (SELECT text FROM atlas.text_chunks c WHERE c.article_id = a.id) t FROM atlas.articles a WHERE url = $1`, [newUrl]);
ok(r.rows[0].published_at.toISOString() === '2026-10-16T08:00:00.000Z' && r.rows[0].publication_time_basis === 'feed_asserted', 'NULL never erases known publication');
ok(r.rows[0].excerpt === 'Permitted excerpt.' && r.rows[0].d === 2 && r.rows[0].t === 'Test discovery title\n\nPermitted excerpt.', 'excerpt kept, two discoveries, chunk text');
ok(r.rows[0].discovered_at.toISOString() === '2026-10-17T10:00:00.000Z' && r.rows[0].fetched_at.toISOString() === '2026-10-17T13:00:00.000Z', 'earliest discovery, latest fetch');
// A provider rediscovering a curated URL must not overwrite reviewed facts or create a duplicate.
const curatedUrl = 'https://wlos.com/news/local/breaking-boil-water-advisory-has-been-lifted-water-resources-department-says';
await repoDb.writeBatch('upsert_articles', [{ ...base, id: 'article-hash-x', source_id: 'source-hash-x', url: curatedUrl, title: 'Provider title rewrite',
  publisher: 'wlos.com', discovered_at: '2026-10-17T09:00:00.000Z', fetched_at: '2026-10-17T12:00:00.000Z' }]);
r = await pool.query(`SELECT id, title, verification_status, source_id, published_at, (SELECT count(*)::int FROM atlas.articles WHERE url = $1) n,
  (SELECT count(*)::int FROM atlas.article_discoveries d WHERE d.article_id = a.id) d,
  (SELECT count(*)::int FROM atlas.sources WHERE id = 'source-hash-x') orphan FROM atlas.articles a WHERE url = $1`, [curatedUrl]);
ok(r.rows[0].id === 'art-wlos-boil-water-lifted' && r.rows[0].title.startsWith("Asheville's boil water notice") && r.rows[0].verification_status === 'reviewed'
  && r.rows[0].n === 1 && r.rows[0].d === 2 && r.rows[0].orphan === 0 && r.rows[0].source_id === 'src-wlos-boil-water-lifted', `curated protected: ${JSON.stringify(r.rows[0])}`);
// Batch atomicity: one invalid row (non-HTTPS) rolls back the whole batch.
await assert.rejects(repoDb.writeBatch('upsert_articles', [
  { ...base, id: 'article-batch-ok', source_id: 'source-batch-ok', url: 'https://example.org/batch-ok', title: 'ok', publisher: 'x', discovered_at: null, fetched_at: '2026-10-17T12:00:00.000Z' },
  { ...base, id: 'article-batch-bad', source_id: 'source-batch-bad', url: 'http://example.org/bad', title: 'bad', publisher: 'x', discovered_at: null, fetched_at: '2026-10-17T12:00:00.000Z' }]));
ok((await pool.query(`SELECT 1 FROM atlas.articles WHERE id = 'article-batch-ok'`)).rowCount === 0, 'batch rolled back');
checks++;

// ---------- embeddings ----------
const chunkKey = { source_id: 'src-wbtv-boil-water-lifted', chunk_id: 'article-text' };
let [chunk] = await repoDb.read('embedding_chunks', { ...chunkKey, model: null, model_version: null, dimensions: null });
ok(chunk.embedding_permitted === true && chunk.model === null && chunk.text.length > 0, 'chunk without identity');
const { createHash } = await import('node:crypto');
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const id4 = { model: 'test-embedding-model', model_version: 'test-v1', dimensions: 4 };
await assert.rejects(repoDb.writeBatch('upsert_embeddings', [{ ...chunkKey, ...id4, content_hash: hash(chunk.text), vector: '[1,0,0,0]' }]), /foreign key|violates/);
checks++;
await admin.query(`INSERT INTO atlas.embedding_models VALUES ($1,$2,$3, now(), 'validation-only identity')`, [id4.model, id4.model_version, id4.dimensions]);
await assert.rejects(repoDb.writeBatch('upsert_embeddings', [{ ...chunkKey, ...id4, content_hash: hash(chunk.text), vector: '[1,0,0]' }]), /check/i); checks++;
await assert.rejects(repoDb.writeBatch('upsert_embeddings', [{ ...chunkKey, ...id4, content_hash: hash('stale'), vector: '[1,0,0,0]' }]), /content_hash/); checks++;
await pool.query(`UPDATE atlas.text_chunks SET embedding_permitted = false WHERE source_id = 'src-foxweather-rad-drone'`);
await assert.rejects(repoDb.writeBatch('upsert_embeddings', [{ source_id: 'src-foxweather-rad-drone', chunk_id: 'article-text', ...id4, content_hash: hash('x'), vector: '[1,0,0,0]' }]), /not permitted/); checks++;
await pool.query(`UPDATE atlas.text_chunks SET embedding_permitted = true WHERE source_id = 'src-foxweather-rad-drone'`);
// Index every seeded article chunk with a deterministic toy vector; boil-water articles point one way.
const chunks = (await pool.query(`SELECT source_id, chunk_id, text FROM atlas.text_chunks WHERE article_id IS NOT NULL AND article_id NOT LIKE 'article-test%'`)).rows;
await repoDb.writeBatch('upsert_embeddings', chunks.map(c => ({ source_id: c.source_id, chunk_id: c.chunk_id, ...id4, content_hash: hash(c.text),
  vector: /boil/i.test(c.text) ? '[1,0,0,0]' : /water/i.test(c.text) ? '[0.7,0.7,0,0]' : '[0,0,1,0]' })));
[chunk] = await repoDb.read('embedding_chunks', { ...chunkKey, ...id4 });
ok(chunk.model === id4.model && chunk.dimensions === 4 && chunk.content_hash === hash(chunk.text), 'identity returned (int dimensions)');
const sem = await repoDb.read('semantic_news', { vector: '[1,0,0,0]', ...id4, limit: 3, offset: 0 });
ok(sem.length === 3 && /boil/i.test(sem[0].title) && /boil/i.test(sem[1].title), `semantic ranking ${sem.map(a => a.id)}`);
const semFiltered = await repoDb.read('semantic_news', { vector: '[1,0,0,0]', ...id4, themes: ['flooding'], limit: 10, offset: 0 });
ok(semFiltered.length > 0 && semFiltered.every(a => a.themes.includes('flooding')), 'strict filters bound semantic results');
ok((await repoDb.read('semantic_news', { vector: '[1,0,0,0]', ...id4, published_from: '2030-01-01T00:00:00Z', limit: 10, offset: 0 })).length === 0, 'semantic never widens date range');
ok((await repoDb.read('semantic_news', { vector: '[1,0,0,0]', model: id4.model, model_version: 'other', dimensions: 4, limit: 10, offset: 0 })).length === 0, 'identity enforced');
// Changing chunk text makes the stored embedding stale (ignored by search, reindex detected).
await pool.query(`UPDATE atlas.text_chunks SET text = text || ' (edited)' WHERE source_id = 'src-wbtv-boil-water-lifted'`);
ok(!(await repoDb.read('semantic_news', { vector: '[1,0,0,0]', ...id4, limit: 10, offset: 0 })).some(a => a.id === 'art-wbtv-boil-water-lifted'), 'stale embedding ignored');

// ---------- proposed bucket plan ----------
const buckets = await pool.query({ text: mod.proposedPlans.observation_buckets.text,
  values: ['loc-usgs-03451500', 'discharge', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', 100, 0] });
ok(buckets.rows.length === 21 && buckets.rows[7].max_value === 113000 && buckets.rows[7].sample_count === 97 && buckets.rows[8].complete === false
  && buckets.rows[20].value_count === 1 && buckets.rows[20].complete === false, 'daily buckets');

// ---------- 006 live ingestion: provider event fields, provider-asserted locations, live series ----------
const quakeUrl = 'https://www.gdacs.org/report.aspx?eventid=9990001&eventtype=EQ';
const quake = { ...base, provider: 'rss', provider_source_id: 'rss-test-gdacs', publication_time_basis: 'feed_asserted',
  id: 'article-test-quake', source_id: 'source-test-quake', url: quakeUrl, title: 'Test earthquake alert', publisher: 'GDACS',
  excerpt: 'Test alert.', published_at: '2026-10-17T05:26:57.000Z', discovered_at: null, fetched_at: '2026-10-17T06:00:00.000Z',
  event_at: '2026-10-17T05:06:57.000Z', source_type: 'government_report', license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Source: GDACS' };
await repoDb.writeBatch('upsert_articles', [quake]);
await repoDb.writeBatch('upsert_articles', [{ ...quake, event_at: null, fetched_at: '2026-10-17T07:00:00.000Z', attribution: 'changed' }]);
r = await pool.query(`SELECT a.event_at, s.source_type, s.license, s.attribution FROM atlas.articles a JOIN atlas.sources s ON s.id = a.source_id WHERE a.url = $1`, [quakeUrl]);
ok(r.rows[0].event_at.toISOString() === '2026-10-17T05:06:57.000Z' && r.rows[0].source_type === 'government_report' && r.rows[0].license === 'CC BY 4.0'
  && r.rows[0].attribution === 'Source: GDACS', `provider event time + licensing kept: ${JSON.stringify(r.rows[0])}`);
// Reviewed (curated) articles never take a provider event time.
await repoDb.writeBatch('upsert_articles', [{ ...base, id: 'article-hash-x', source_id: 'source-hash-x', url: curatedUrl, title: 'x', publisher: 'x',
  discovered_at: null, fetched_at: '2026-10-17T12:00:00.000Z', event_at: '2026-01-01T00:00:00.000Z' }]);
ok((await pool.query(`SELECT event_at FROM atlas.articles WHERE url = $1`, [curatedUrl])).rows[0].event_at === null, 'reviewed event time untouched');

const place = { article_url: quakeUrl, id: 'loc-gdacs-eq-9990001', name: 'Testland · GDACS earthquake 9990001', precision: 'region',
  longitude: 66.1708, latitude: 28.0179, coordinates_basis: 'GDACS event point (test)', bounds_west: 62.1708, bounds_south: 24.0179,
  bounds_east: 70.1708, bounds_north: 32.0179, bounds_basis: 'GDACS alert bounding box (test)' };
await repoDb.writeBatch('upsert_event_locations', [place]);
await repoDb.writeBatch('upsert_event_locations', [{ ...place, name: 'Testland · updated' }]);
r = await pool.query(`SELECT l.verification_status, l.name, l.source_id = a.source_id cites, al.link_basis, a.location_ids
  FROM atlas.locations l JOIN atlas.article_locations al ON al.location_id = l.id JOIN atlas.article_records a ON a.id = al.article_id WHERE l.id = $1`, [place.id]);
ok(r.rowCount === 1 && r.rows[0].verification_status === 'unreviewed' && r.rows[0].name === 'Testland · updated' && r.rows[0].cites
  && r.rows[0].link_basis === 'provider_asserted' && r.rows[0].location_ids.includes(place.id), `provider location + link: ${JSON.stringify(r.rows)}`);
ok((await pool.query(`SELECT count(*)::int n FROM atlas.article_locations WHERE link_basis = 'reviewed'`)).rows[0].n > 0, 'curated links default to reviewed');
const located = await repoDb.read('news', { bounds: [60, 20, 75, 35], limit: 100, offset: 0 });
ok(located.length === 1 && located[0].url === quakeUrl, 'bounds filter finds the provider region');
// Reviewed locations are never rewritten and reviewed articles are never linked by imports.
await repoDb.writeBatch('upsert_event_locations', [{ ...place, id: 'loc-asheville-nc', name: 'Overwrite attempt' }]);
ok((await pool.query(`SELECT name FROM atlas.locations WHERE id = 'loc-asheville-nc'`)).rows[0].name !== 'Overwrite attempt'
  && (await pool.query(`SELECT 1 FROM atlas.article_locations WHERE location_id = 'loc-asheville-nc' AND link_basis = 'provider_asserted'`)).rowCount === 0, 'reviewed location protected');
await repoDb.writeBatch('upsert_event_locations', [{ ...place, article_url: curatedUrl, id: 'loc-gdacs-eq-9990002' }]);
ok((await pool.query(`SELECT 1 FROM atlas.article_locations WHERE location_id = 'loc-gdacs-eq-9990002'`)).rowCount === 0, 'reviewed article never linked');

const live = { id: 'usgs-03451500-discharge-live', source_id: 'src-usgs-waterdata-03451500-00060-00011',
  source_url: 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?monitoring_location_id=USGS-03451500&parameter_code=00060&statistic_id=00011',
  source_title: 'Test live discharge', publisher: 'U.S. Geological Survey', location_id: 'loc-usgs-03451500', metric: 'discharge', unit: 'ft^3/s',
  statistic: 'instantaneous', expected_interval_seconds: 900, provider_series_ref: 'USGS:03451500:00060:00011', description: 'Test live series.',
  license: 'U.S. Public Domain', license_url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  attribution: 'U.S. Geological Survey', missing_data_rule: 'Gaps are not interpolated.', investigation_id: 'inv-helene-asheville-2024',
  retrieved_at: '2026-10-18T00:30:00.000Z' };
const readings = (rows: [string, number | null, string[]][]) => JSON.stringify(rows.map(([observed_at, value, qualifiers]) => ({ observed_at, value, qualifiers })));
await repoDb.writeBatch('upsert_observation_series', [{ ...live, readings: readings([
  ['2026-10-17T21:30:00.000Z', 1150, ['P']], ['2026-10-17T21:45:00.000Z', null, ['P']], ['2026-10-17T22:00:00.000Z', 1140, ['P']]]) }]);
// A later refresh re-reads the overlap: a revised provisional value replaces the stored one, coverage widens.
await repoDb.writeBatch('upsert_observation_series', [{ ...live, retrieved_at: '2026-10-18T00:50:00.000Z', readings: readings([
  ['2026-10-17T22:00:00.000Z', 1145, ['P']], ['2026-10-17T22:15:00.000Z', 1150, ['P']]]) }]);
const liveRows = await repoDb.read('observations', { series_id: live.id, limit: 100, offset: 0 });
ok(liveRows.length === 4 && liveRows.every(o => o.series_id === live.id && o.unit === 'ft^3/s' && o.source_id === live.source_id)
  && liveRows[1].value === null && liveRows[2].value === 1145, `live readings by series_id: ${liveRows.map(o => o.value)}`);
const [cov2] = await repoDb.read('freshness', {});
const ds = cov2.datasets.find((d: { series_id: string }) => d.series_id === live.id);
ok(cov2.datasets.length === 6 && ds.live === true && ds.coverage_from === '2026-10-17T21:30:00.000Z' && ds.coverage_to === '2026-10-17T22:15:00.000Z'
  && ds.retrieved_at === '2026-10-18T00:50:00.000Z', `live dataset coverage: ${JSON.stringify(ds)}`);
ok((await repoDb.read('observations', { location_id: 'loc-usgs-03451500', metric: 'discharge', series_id: 'usgs-03451500-discharge', limit: 100, offset: 0 }))
  .every(o => o.series_id === 'usgs-03451500-discharge'), 'series_id isolates the curated archive');
const [inv2] = await repoDb.read('investigation', { id: 'inv-helene-asheville-2024' });
ok(inv2.observation_series.length === 6 && inv2.observation_series.at(-1).id === live.id && inv2.observation_series.at(-1).live === true
  && inv2.sources.some((s: { id: string }) => s.id === live.source_id), 'live series appended to the investigation with its source');
const daily = await pool.query(`SELECT value_count::int, max_value FROM atlas.observation_daily WHERE series_id = $1`, [live.id]);
ok(daily.rowCount === 1 && daily.rows[0].value_count === 3 && daily.rows[0].max_value === 1150, 'live readings reach the daily aggregate');
await assert.rejects(repoDb.writeBatch('upsert_observation_series', [{ ...live, metric: 'gage_height', readings: readings([['2026-10-17T23:00:00.000Z', 1, []]]) }]),
  /precondition failed/); checks++;
ok((await pool.query(`SELECT 1 FROM atlas.observations WHERE series_id = $1 AND observed_at = '2026-10-17T23:00:00Z'`, [live.id])).rowCount === 0, 'mismatched identity writes nothing');

await repoDb.close();
await admin.end();
console.log(JSON.stringify({ status: 'passed', checks }));
