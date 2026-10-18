// Person 4 → Person 3: reviewed, parameterized SQL for the frozen Atlas schema (migrations 001–006).
// Interface: backend/docs/database-handoff.md ("atlas-p3-v1"). SQL text is trusted developer configuration;
// request values only ever arrive as bound parameters listed in `parameters`, in placeholder order.
//
// Person 3 may point ATLAS_DATABASE_MODULE=db/handoff/database.mjs directly (the backend loader allows db/) or copy
// it to backend/handoffs/database.mjs. Rows are flat, JSON-compatible records: timestamps are UTC ISO strings
// (atlas.utc_iso, millisecond precision with Z), counts are int (never bigint strings), arrays are text[] or json,
// unknown values are NULL. Column lists that depend on Person 1's closed schemas are single constants below.
//
// Validated against a disposable local TimescaleDB 2.30.2 / pgvector 0.8.7 / PostgreSQL 17 database through
// node-postgres (see db/README.md). Migrations 001–005 run on Tiger Cloud; 006 and its live-ingestion plans are
// validated locally only until they are applied there.

export const schemaVersion = '006_live';

const iso = column => `atlas.utc_iso(${column})`;

// Article record (contracts-handoff.md fields + published_date for date-only publications; see db/README.md gaps).
const ARTICLE_COLUMNS = `a.id, a.source_id, a.title, a.publisher, a.url, a.excerpt,
  ${iso('a.published_at')} AS published_at, a.published_date::text AS published_date, ${iso('a.event_at')} AS event_at,
  ${iso('a.discovered_at')} AS discovered_at, ${iso('a.fetched_at')} AS fetched_at,
  a.location_ids, a.entity_ids, a.themes, a.provider, a.provider_source_id, a.publication_time_basis,
  a.verification_status, a.geographic_precision, a.content_hash`;

// Strict NewsQuery constraints on alias `a` (atlas.article_records), parameters $1..$7:
// location_ids, themes, entity_ids, bounds, keyword, published_from, published_to.
// OR within each array, AND across fields. An empty array means "no constraint", as in the backend's matchesNews.
// keyword is a literal, case-insensitive substring (strpos: no LIKE wildcards to escape). Unknown publication
// times never match a publication filter. Bounds keep broad places broad: a city/region matches only when its
// whole extent fits; a facility/address matches by its point.
const NEWS_FILTERS = `(cardinality(COALESCE($1::text[], '{}')) = 0 OR a.location_ids && $1::text[])
  AND (cardinality(COALESCE($2::text[], '{}')) = 0 OR a.themes && $2::text[])
  AND (cardinality(COALESCE($3::text[], '{}')) = 0 OR a.entity_ids && $3::text[])
  AND ($4::float8[] IS NULL OR EXISTS (
    SELECT 1 FROM atlas.article_locations al JOIN atlas.locations l ON l.id = al.location_id
    WHERE al.article_id = a.id
      AND atlas.location_within(l, ($4::float8[])[1], ($4::float8[])[2], ($4::float8[])[3], ($4::float8[])[4])))
  AND (COALESCE(btrim($5::text), '') = ''
    OR strpos(lower(a.title || ' ' || COALESCE(a.excerpt, '')), lower(btrim($5::text))) > 0)
  AND ($6::timestamptz IS NULL OR (a.published_at IS NOT NULL AND a.published_at >= $6::timestamptz))
  AND ($7::timestamptz IS NULL OR (a.published_at IS NOT NULL AND a.published_at <= $7::timestamptz))`;
const NEWS_PARAMETERS = ['location_ids', 'themes', 'entity_ids', 'bounds', 'keyword', 'published_from', 'published_to'];

const LOCATION_JSON = l => `json_build_object(
  'id', ${l}.id, 'name', ${l}.name, 'precision', ${l}.precision,
  'coordinates', CASE WHEN ${l}.longitude IS NULL THEN NULL ELSE json_build_array(${l}.longitude, ${l}.latitude) END,
  'bounds', CASE WHEN ${l}.bounds_west IS NULL THEN NULL
    ELSE json_build_array(${l}.bounds_west, ${l}.bounds_south, ${l}.bounds_east, ${l}.bounds_north) END,
  'coordinates_basis', ${l}.coordinates_basis, 'bounds_basis', ${l}.bounds_basis,
  'source_id', ${l}.source_id, 'verification_status', ${l}.verification_status)`;

const OBSERVATION_COLUMNS = `o.id, o.location_id, o.metric, o.value, o.unit, o.source_id,
  ${iso('o.observed_at')} AS observed_at, ${iso('o.fetched_at')} AS fetched_at, o.series_id, o.statistic,
  o.qualifiers, o.time_precision, ${iso('o.period_start')} AS period_start, ${iso('o.period_end')} AS period_end`;

const SOURCE_JSON = s => `json_build_object(
  'id', ${s}.id, 'url', ${s}.url, 'title', ${s}.title, 'publisher', ${s}.publisher, 'source_type', ${s}.source_type,
  'license', ${s}.license, 'license_url', ${s}.license_url, 'attribution', ${s}.attribution,
  'published_at', ${iso(`${s}.published_at`)}, 'published_date', ${s}.published_date::text,
  'published_at_basis', ${s}.published_at_basis, 'retrieved_at', ${iso(`${s}.retrieved_at`)},
  'verification_status', ${s}.verification_status)`;

export const databaseHandoff = {
  version: 'atlas-p3-v1',
  plans: {
    news: {
      text: `SELECT ${ARTICLE_COLUMNS}
FROM atlas.article_records a
WHERE ${NEWS_FILTERS}
ORDER BY a.published_at DESC NULLS LAST, a.id
LIMIT $8::int OFFSET $9::int`,
      parameters: [...NEWS_PARAMETERS, 'limit', 'offset']
    },

    // Ranked by the closest permitted, current (hash-matching) chunk per article under one exact model identity.
    // All strict filters apply before ranking and pagination; similarity never widens the result set.
    semantic_news: {
      text: `WITH ranked AS (
  SELECT c.article_id, min(e.embedding <=> $8::vector) AS distance
  FROM atlas.chunk_embeddings e
  JOIN atlas.text_chunks c ON c.source_id = e.source_id AND c.chunk_id = e.chunk_id
  JOIN atlas.article_records a ON a.id = c.article_id
  WHERE e.model = $9::text AND e.model_version = $10::text AND e.dimensions = $11::int
    AND vector_dims(e.embedding) = vector_dims($8::vector)
    AND c.embedding_permitted AND e.content_hash = c.content_hash
    AND ${NEWS_FILTERS}
  GROUP BY c.article_id
)
SELECT ${ARTICLE_COLUMNS}
FROM ranked r JOIN atlas.article_records a ON a.id = r.article_id
ORDER BY r.distance, a.id
LIMIT $12::int OFFSET $13::int`,
      parameters: [...NEWS_PARAMETERS, 'vector', 'model', 'model_version', 'dimensions', 'limit', 'offset']
    },

    // Literal, case-insensitive name substring (not trimmed, matching the backend's post-filter).
    locations: {
      text: `SELECT l.id, l.name,
  CASE WHEN l.longitude IS NULL THEN NULL ELSE json_build_array(l.longitude, l.latitude) END AS coordinates,
  CASE WHEN l.bounds_west IS NULL THEN NULL
    ELSE json_build_array(l.bounds_west, l.bounds_south, l.bounds_east, l.bounds_north) END AS bounds,
  l.precision, l.coordinates_basis, l.bounds_basis, l.source_id, l.verification_status
FROM atlas.locations l
WHERE (cardinality(COALESCE($1::text[], '{}')) = 0 OR l.id = ANY ($1::text[]))
  AND (COALESCE($2::text, '') = '' OR strpos(lower(l.name), lower($2::text)) > 0)
ORDER BY l.id
LIMIT $3::int OFFSET $4::int`,
      parameters: ['ids', 'query', 'limit', 'offset']
    },

    // Zero or one row: the resolved InvestigationResponse envelope. Nested arrays are bounded (<= 100 each).
    investigation: {
      text: `SELECT
  json_build_object(
    'id', i.id, 'title', i.title, 'summary', i.summary, 'primary_location_id', i.primary_location_id,
    'event_period', json_build_object('start_date', i.event_start_date::text, 'end_date', i.event_end_date::text, 'timezone', i.event_timezone),
    'content_status', i.content_status, 'verification_status', i.verification_status, 'reviewed_at', ${iso('i.reviewed_at')},
    'location_ids', (SELECT COALESCE(json_agg(x.location_id ORDER BY x.position), '[]') FROM atlas.investigation_locations x WHERE x.investigation_id = i.id),
    'article_ids', (SELECT COALESCE(json_agg(x.article_id ORDER BY x.position), '[]') FROM atlas.investigation_articles x WHERE x.investigation_id = i.id),
    'evidence_ids', (SELECT COALESCE(json_agg(x.evidence_id ORDER BY x.position), '[]') FROM atlas.investigation_evidence x WHERE x.investigation_id = i.id),
    'series_ids', (SELECT COALESCE(json_agg(x.series_id ORDER BY x.position), '[]') FROM atlas.investigation_series x WHERE x.investigation_id = i.id),
    'key_observations', (SELECT COALESCE(json_agg(json_build_object(
        'observation_id', x.series_id || '@' || to_char(x.observed_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'), 'role', x.role) ORDER BY x.position), '[]')
      FROM atlas.investigation_observations x WHERE x.investigation_id = i.id),
    'items', (SELECT COALESCE(json_agg(json_build_object(
        'id', it.id, 'kind', it.kind, 'text', it.text, 'exposure_basis', it.exposure_basis,
        'source_ids', (SELECT COALESCE(json_agg(src.source_id ORDER BY src.source_id), '[]') FROM atlas.investigation_item_sources src WHERE src.item_id = it.id)
      ) ORDER BY it.kind, it.position), '[]') FROM atlas.investigation_items it WHERE it.investigation_id = i.id)
  ) AS investigation,
  (SELECT COALESCE(json_agg(json_build_object(
      'id', a.id, 'source_id', a.source_id, 'title', a.title, 'publisher', a.publisher, 'url', a.url, 'excerpt', a.excerpt,
      'published_at', ${iso('a.published_at')}, 'published_date', a.published_date::text, 'event_at', ${iso('a.event_at')},
      'discovered_at', ${iso('a.discovered_at')}, 'fetched_at', ${iso('a.fetched_at')},
      'location_ids', a.location_ids, 'entity_ids', a.entity_ids, 'themes', a.themes, 'provider', a.provider,
      'provider_source_id', a.provider_source_id, 'publication_time_basis', a.publication_time_basis,
      'verification_status', a.verification_status, 'geographic_precision', a.geographic_precision, 'content_hash', a.content_hash
    ) ORDER BY x.position), '[]')
   FROM (SELECT * FROM atlas.investigation_articles WHERE investigation_id = i.id ORDER BY position LIMIT 100) x
   JOIN atlas.article_records a ON a.id = x.article_id) AS articles,
  (SELECT COALESCE(json_agg(json_build_object(
      'id', e.id, 'type', e.evidence_type, 'title', e.title, 'description', e.description, 'limitations', e.limitations,
      'source_id', e.source_id,
      'source_ids', (SELECT COALESCE(json_agg(es.source_id ORDER BY es.source_id), '[]') FROM atlas.evidence_sources es WHERE es.evidence_id = e.id),
      'observed_from', ${iso('e.observed_from')}, 'observed_to', ${iso('e.observed_to')},
      'location_id', e.location_id, 'series_id', e.series_id,
      'imagery', CASE WHEN e.evidence_type <> 'imagery' THEN NULL ELSE json_build_object(
        'bounds', json_build_array(e.bounds_west, e.bounds_south, e.bounds_east, e.bounds_north),
        'asset_path', e.asset_path, 'layer_ref', e.layer_ref, 'legend', e.legend, 'attribution', e.attribution,
        'license', e.license, 'resolution_m', e.resolution_m,
        'comparison_group', e.comparison_group, 'comparison_role', e.comparison_role) END
    ) ORDER BY x.position), '[]')
   FROM (SELECT * FROM atlas.investigation_evidence WHERE investigation_id = i.id ORDER BY position LIMIT 100) x
   JOIN atlas.evidence e ON e.id = x.evidence_id) AS evidence,
  (SELECT COALESCE(json_agg(json_build_object(
      'id', o.id, 'location_id', o.location_id, 'metric', o.metric, 'value', o.value, 'unit', o.unit, 'source_id', o.source_id,
      'observed_at', ${iso('o.observed_at')}, 'fetched_at', ${iso('o.fetched_at')}, 'series_id', o.series_id,
      'statistic', o.statistic, 'qualifiers', o.qualifiers, 'time_precision', o.time_precision,
      'period_start', ${iso('o.period_start')}, 'period_end', ${iso('o.period_end')}
    ) ORDER BY x.position), '[]')
   FROM (SELECT * FROM atlas.investigation_observations WHERE investigation_id = i.id ORDER BY position LIMIT 100) x
   JOIN atlas.observation_records o ON o.series_id = x.series_id AND o.observed_at = x.observed_at) AS observations,
  (SELECT COALESCE(json_agg(json_build_object(
      'id', s.id, 'location_id', s.location_id, 'metric', s.metric, 'unit', s.unit, 'statistic', s.statistic,
      'expected_interval_seconds', extract(epoch FROM s.expected_interval)::int, 'source_id', s.source_id,
      'provider_series_ref', s.provider_series_ref, 'description', s.description, 'missing_data_rule', s.missing_data_rule,
      'license', s.license, 'attribution', s.attribution, 'coverage_from', ${iso('s.coverage_from')},
      'coverage_to', ${iso('s.coverage_to')}, 'retrieved_at', ${iso('s.retrieved_at')}, 'live', s.live
    ) ORDER BY x.position), '[]')
   FROM atlas.investigation_series x JOIN atlas.observation_series s ON s.id = x.series_id
   WHERE x.investigation_id = i.id) AS observation_series,
  (SELECT COALESCE(json_agg(${LOCATION_JSON('l')} ORDER BY x.position), '[]')
   FROM atlas.investigation_locations x JOIN atlas.locations l ON l.id = x.location_id
   WHERE x.investigation_id = i.id) AS locations,
  (SELECT COALESCE(json_agg(${SOURCE_JSON('s')} ORDER BY s.id), '[]')
   FROM (SELECT * FROM atlas.sources WHERE id IN (
       SELECT a.source_id FROM atlas.investigation_articles x JOIN atlas.articles a ON a.id = x.article_id WHERE x.investigation_id = i.id
       UNION SELECT es.source_id FROM atlas.investigation_evidence x JOIN atlas.evidence_sources es ON es.evidence_id = x.evidence_id WHERE x.investigation_id = i.id
       UNION SELECT s2.source_id FROM atlas.investigation_items it JOIN atlas.investigation_item_sources s2 ON s2.item_id = it.id WHERE it.investigation_id = i.id
       UNION SELECT l.source_id FROM atlas.investigation_locations x JOIN atlas.locations l ON l.id = x.location_id WHERE x.investigation_id = i.id
       UNION SELECT os.source_id FROM atlas.investigation_series x JOIN atlas.observation_series os ON os.id = x.series_id WHERE x.investigation_id = i.id)
     ORDER BY id LIMIT 100) s) AS sources
FROM atlas.investigations i
WHERE i.id = $1::text`,
      parameters: ['id']
    },

    // Raw observations: strict location/metric/series/inclusive observation range before pagination; ascending time.
    // Since 006 a location + metric can have a curated archive and a live series; series_id selects exactly one.
    observations: {
      text: `SELECT ${OBSERVATION_COLUMNS}
FROM atlas.observation_records o
WHERE ($1::text IS NULL OR o.location_id = $1::text)
  AND ($2::text IS NULL OR o.metric = $2::text)
  AND ($3::timestamptz IS NULL OR o.observed_at >= $3::timestamptz)
  AND ($4::timestamptz IS NULL OR o.observed_at <= $4::timestamptz)
  AND ($7::text IS NULL OR o.series_id = $7::text)
ORDER BY o.observed_at, o.id
LIMIT $5::int OFFSET $6::int`,
      parameters: ['location_id', 'metric', 'observed_from', 'observed_to', 'limit', 'offset', 'series_id']
    },

    sources: {
      text: `SELECT s.id, s.url, s.title, s.publisher, s.source_type, s.license, s.license_url, s.attribution,
  ${iso('s.published_at')} AS published_at, s.published_date::text AS published_date, s.published_at_basis,
  ${iso('s.retrieved_at')} AS retrieved_at, s.verification_status
FROM atlas.sources s
WHERE s.id = ANY ($1::text[])
ORDER BY s.id
LIMIT 100`,
      parameters: ['ids']
    },

    // With source_id: that feed's refresh state (zero rows if never attempted).
    // Without: one coverage row (scope 'all'): per-feed state, curated dataset coverage and article counts.
    // Both branches share one column list; fields that do not apply to a scope are NULL by design.
    freshness: {
      text: `WITH feeds AS (
  SELECT st.source_id, st.status, st.attempted_at, st.last_successful_at, st.next_retry_at, st.consecutive_failures,
    st.verification_status,
    (SELECT count(*) FROM atlas.article_discoveries d WHERE d.provider_source_id = st.source_id)::int AS article_count,
    (SELECT count(*) FROM atlas.article_discoveries d WHERE d.provider_source_id = st.source_id AND d.asserted_published_at IS NOT NULL)::int AS publication_time_known_count
  FROM atlas.ingestion_state st
)
SELECT 'source' AS scope, f.source_id, f.status, ${iso('f.attempted_at')} AS attempted_at,
  ${iso('f.last_successful_at')} AS last_successful_at, ${iso('f.next_retry_at')} AS next_retry_at,
  f.consecutive_failures, f.verification_status, NULL::json AS feeds, NULL::json AS datasets, NULL::json AS articles
FROM feeds f
WHERE $1::text IS NOT NULL AND f.source_id = $1::text
UNION ALL
SELECT 'all', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  (SELECT COALESCE(json_agg(json_build_object(
      'source_id', f.source_id, 'status', f.status, 'attempted_at', ${iso('f.attempted_at')},
      'last_successful_at', ${iso('f.last_successful_at')}, 'next_retry_at', ${iso('f.next_retry_at')},
      'verification_status', f.verification_status, 'article_count', f.article_count,
      'publication_time_known_count', f.publication_time_known_count) ORDER BY f.source_id), '[]')
   FROM (SELECT * FROM feeds ORDER BY source_id LIMIT 100) f),
  (SELECT COALESCE(json_agg(json_build_object(
      'series_id', s.id, 'location_id', s.location_id, 'metric', s.metric, 'unit', s.unit, 'source_id', s.source_id,
      'coverage_from', ${iso('s.coverage_from')}, 'coverage_to', ${iso('s.coverage_to')},
      'retrieved_at', ${iso('s.retrieved_at')}, 'live', s.live) ORDER BY s.id), '[]')
   FROM (SELECT * FROM atlas.observation_series ORDER BY id LIMIT 100) s),
  (SELECT json_build_object(
      'total', count(*)::int,
      'reviewed', count(*) FILTER (WHERE verification_status = 'reviewed')::int,
      'unreviewed', count(*) FILTER (WHERE verification_status = 'unreviewed')::int,
      'publication_time_known', count(*) FILTER (WHERE published_at IS NOT NULL)::int,
      'publication_date_only', count(*) FILTER (WHERE publication_time_basis = 'date_only')::int)
   FROM atlas.articles)
WHERE $1::text IS NULL`,
      parameters: ['source_id']
    },

    // Permitted chunk plus the matching embedding identity, if any (identity columns NULL when absent or when
    // model/version/dimensions were not supplied).
    embedding_chunks: {
      text: `SELECT c.source_id, c.chunk_id, c.text, c.embedding_permitted,
  e.model, e.model_version, e.dimensions, e.content_hash
FROM atlas.text_chunks c
LEFT JOIN atlas.chunk_embeddings e ON e.source_id = c.source_id AND e.chunk_id = c.chunk_id
  AND e.model = $3::text AND e.model_version = $4::text AND e.dimensions = $5::int
WHERE c.source_id = $1::text AND c.chunk_id = $2::text`,
      parameters: ['source_id', 'chunk_id', 'model', 'model_version', 'dimensions']
    },

    // One statement per normalized Article: upserts the original source record, the article, the per-provider
    // discovery row, and the article's embeddable chunk (title + permitted excerpt). Provider rows are always
    // unreviewed; reviewed rows keep their title/publisher/excerpt/publication/event facts; reviewed links
    // (locations/entities/themes) and precision are never written here (provider-asserted locations go through
    // upsert_event_locations); a provider-asserted event time (e.g. GDACS fromdate) is written to unreviewed rows
    // only; a NULL publication or event time never erases a known one; discovered_at keeps the earliest and
    // fetched_at the latest value. source_type/license/license_url/attribution come from the reviewed source
    // definition; a NULL source_type means 'news_article', and existing licensing metadata is never erased.
    upsert_articles: {
      text: `WITH src AS (
  INSERT INTO atlas.sources AS s (id, url, title, publisher, source_type, published_at, published_at_basis, retrieved_at,
    license, license_url, attribution)
  VALUES ($2::text, $3::text, $4::text, $5::text, COALESCE($14::text, 'news_article'), $7::timestamptz,
    CASE WHEN $7::timestamptz IS NULL THEN 'unavailable' ELSE 'feed_asserted' END, $9::timestamptz,
    $15::text, $16::text, $17::text)
  ON CONFLICT (url) DO UPDATE SET
    retrieved_at = GREATEST(s.retrieved_at, EXCLUDED.retrieved_at),
    title = CASE WHEN s.verification_status = 'reviewed' THEN s.title ELSE EXCLUDED.title END,
    publisher = CASE WHEN s.verification_status = 'reviewed' THEN s.publisher ELSE EXCLUDED.publisher END,
    published_at = CASE WHEN s.verification_status = 'reviewed' THEN s.published_at ELSE COALESCE(EXCLUDED.published_at, s.published_at) END,
    published_at_basis = CASE WHEN s.verification_status = 'reviewed' OR EXCLUDED.published_at IS NULL THEN s.published_at_basis ELSE 'feed_asserted' END,
    license = COALESCE(s.license, EXCLUDED.license),
    license_url = COALESCE(s.license_url, EXCLUDED.license_url),
    attribution = COALESCE(s.attribution, EXCLUDED.attribution),
    updated_at = now()
  RETURNING s.id
), art AS (
  INSERT INTO atlas.articles AS a (id, source_id, url, title, publisher, excerpt, published_at, publication_time_basis,
    discovered_at, fetched_at, provider, provider_source_id, verification_status, content_hash, event_at)
  SELECT $1::text, src.id, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $12::text,
    $8::timestamptz, $9::timestamptz, $10::text, $11::text, 'unreviewed', atlas.article_content_hash($4::text, $6::text),
    $13::timestamptz
  FROM src
  ON CONFLICT (url) DO UPDATE SET
    title = CASE WHEN a.verification_status = 'reviewed' THEN a.title ELSE EXCLUDED.title END,
    publisher = CASE WHEN a.verification_status = 'reviewed' THEN a.publisher ELSE EXCLUDED.publisher END,
    excerpt = CASE WHEN a.verification_status = 'reviewed' THEN a.excerpt ELSE COALESCE(EXCLUDED.excerpt, a.excerpt) END,
    published_at = CASE WHEN a.verification_status = 'reviewed' THEN a.published_at ELSE COALESCE(EXCLUDED.published_at, a.published_at) END,
    event_at = CASE WHEN a.verification_status = 'reviewed' THEN a.event_at ELSE COALESCE(EXCLUDED.event_at, a.event_at) END,
    publication_time_basis = CASE WHEN a.verification_status = 'reviewed' OR EXCLUDED.published_at IS NULL
      THEN a.publication_time_basis ELSE EXCLUDED.publication_time_basis END,
    discovered_at = LEAST(a.discovered_at, EXCLUDED.discovered_at),
    fetched_at = GREATEST(a.fetched_at, EXCLUDED.fetched_at),
    content_hash = CASE WHEN a.verification_status = 'reviewed' THEN a.content_hash
      ELSE atlas.article_content_hash(EXCLUDED.title, COALESCE(EXCLUDED.excerpt, a.excerpt)) END,
    updated_at = now()
  RETURNING a.id, a.source_id, a.title, a.excerpt
), discovery AS (
  INSERT INTO atlas.article_discoveries AS d (article_id, provider, provider_source_id, discovered_at, asserted_published_at,
    publication_time_basis, first_fetched_at, last_fetched_at)
  SELECT art.id, $10::text, $11::text, $8::timestamptz, $7::timestamptz, $12::text, $9::timestamptz, $9::timestamptz FROM art
  ON CONFLICT (article_id, provider_source_id) DO UPDATE SET
    discovered_at = LEAST(d.discovered_at, EXCLUDED.discovered_at),
    asserted_published_at = COALESCE(EXCLUDED.asserted_published_at, d.asserted_published_at),
    publication_time_basis = CASE WHEN EXCLUDED.asserted_published_at IS NULL THEN d.publication_time_basis ELSE EXCLUDED.publication_time_basis END,
    last_fetched_at = GREATEST(d.last_fetched_at, EXCLUDED.last_fetched_at)
)
INSERT INTO atlas.text_chunks AS c (source_id, chunk_id, article_id, text, embedding_permitted, permission_basis, content_hash)
SELECT art.source_id, 'article-text', art.id, art.title || COALESCE(E'\\n\\n' || art.excerpt, ''), true,
  CASE WHEN art.excerpt IS NULL THEN 'stored article title; no publisher excerpt stored'
    ELSE 'stored article title and source-permitted feed excerpt' END, ''
FROM art
ON CONFLICT (source_id, chunk_id) DO UPDATE SET text = EXCLUDED.text, permission_basis = EXCLUDED.permission_basis
WHERE c.text IS DISTINCT FROM EXCLUDED.text`,
      parameters: ['id', 'source_id', 'url', 'title', 'publisher', 'excerpt', 'published_at', 'discovered_at', 'fetched_at',
        'provider', 'provider_source_id', 'publication_time_basis', 'event_at', 'source_type', 'license', 'license_url',
        'attribution']
    },

    // One statement per provider-asserted event location (006). Upserts an UNREVIEWED location built from the
    // coordinates/bounds the provider published for that item, then links it to the stored article with
    // link_basis 'provider_asserted'. Run it after upsert_articles: article and source are both found by canonical
    // URL `article_url` (a curated row may own that URL under a different ID), the location cites that source, and
    // the article is linked only while unreviewed. Reviewed locations are never updated; if the configured ID
    // already belongs to a reviewed location, nothing is linked. No geocoding or text inference happens here.
    upsert_event_locations: {
      text: `WITH loc AS (
  INSERT INTO atlas.locations AS l (id, name, precision, longitude, latitude, coordinates_basis,
    bounds_west, bounds_south, bounds_east, bounds_north, bounds_basis, source_id, verification_status)
  VALUES ($2::text, $3::text, $4::text, $5::float8, $6::float8, $7::text,
    $8::float8, $9::float8, $10::float8, $11::float8, $12::text, (SELECT s.id FROM atlas.sources s WHERE s.url = $1::text), 'unreviewed')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, precision = EXCLUDED.precision, longitude = EXCLUDED.longitude, latitude = EXCLUDED.latitude,
    coordinates_basis = EXCLUDED.coordinates_basis, bounds_west = EXCLUDED.bounds_west, bounds_south = EXCLUDED.bounds_south,
    bounds_east = EXCLUDED.bounds_east, bounds_north = EXCLUDED.bounds_north, bounds_basis = EXCLUDED.bounds_basis,
    source_id = EXCLUDED.source_id, updated_at = now()
  WHERE l.verification_status = 'unreviewed'
  RETURNING l.id
)
INSERT INTO atlas.article_locations (article_id, location_id, link_basis)
SELECT a.id, loc.id, 'provider_asserted'
FROM loc JOIN atlas.articles a ON a.url = $1::text AND a.verification_status = 'unreviewed'
ON CONFLICT (article_id, location_id) DO NOTHING`,
      parameters: ['article_url', 'id', 'name', 'precision', 'longitude', 'latitude', 'coordinates_basis',
        'bounds_west', 'bounds_south', 'bounds_east', 'bounds_north', 'bounds_basis']
    },

    // One statement per live series refresh (006). Upserts the series' original dataset source (by URL), the series
    // itself (live = true; coverage only widens; retrieved_at only advances) and its readings, passed as one JSON
    // array `readings` of {observed_at, value, qualifiers}; the caller sends at least one reading (coverage is
    // computed from them and is NOT NULL). A reading already stored at the same instant is replaced:
    // provisional provider values can be revised. atlas.require raises if the configured series ID already belongs
    // to another location/metric/unit/statistic/source, so a misconfiguration never writes into the wrong series.
    // investigation_id (nullable) links the series to a reviewed investigation once, appended after existing series;
    // the link is configuration in the reviewed source definition, never inferred.
    upsert_observation_series: {
      text: `WITH src AS (
  INSERT INTO atlas.sources AS s (id, url, title, publisher, source_type, published_at, published_at_basis, retrieved_at,
    license, license_url, attribution)
  VALUES ($2::text, $3::text, $4::text, $5::text, 'dataset', NULL, 'unavailable', $16::timestamptz, $13::text, $14::text, $15::text)
  ON CONFLICT (url) DO UPDATE SET retrieved_at = GREATEST(s.retrieved_at, EXCLUDED.retrieved_at), updated_at = now()
  RETURNING s.id
), r AS (
  SELECT x.observed_at, x.value, COALESCE(x.qualifiers, '{}') AS qualifiers
  FROM jsonb_to_recordset($19::jsonb) AS x(observed_at timestamptz, value float8, qualifiers text[])
), series AS (
  INSERT INTO atlas.observation_series AS os (id, location_id, metric, unit, statistic, expected_interval, source_id,
    provider_series_ref, description, missing_data_rule, license, attribution, coverage_from, coverage_to, retrieved_at, live)
  SELECT $1::text, $6::text, $7::text, $8::text, $9::text, make_interval(secs => $10::int), src.id,
    $11::text, $12::text, $17::text, $13::text, $15::text,
    (SELECT min(observed_at) FROM r), (SELECT max(observed_at) FROM r), $16::timestamptz, true
  FROM src
  ON CONFLICT (id) DO UPDATE SET
    coverage_from = LEAST(os.coverage_from, EXCLUDED.coverage_from),
    coverage_to = GREATEST(os.coverage_to, EXCLUDED.coverage_to),
    retrieved_at = GREATEST(os.retrieved_at, EXCLUDED.retrieved_at),
    live = true
  WHERE atlas.require(os.location_id = EXCLUDED.location_id AND os.metric = EXCLUDED.metric AND os.unit = EXCLUDED.unit
    AND os.statistic = EXCLUDED.statistic AND os.source_id = EXCLUDED.source_id, 'series ID belongs to another series identity')
  RETURNING os.id, os.statistic
), link AS (
  INSERT INTO atlas.investigation_series (investigation_id, series_id, position)
  SELECT $18::text, series.id,
    (SELECT COALESCE(max(x.position) + 1, 0) FROM atlas.investigation_series x WHERE x.investigation_id = $18::text)
  FROM series WHERE $18::text IS NOT NULL
  ON CONFLICT (investigation_id, series_id) DO NOTHING
)
INSERT INTO atlas.observations AS o (series_id, statistic, observed_at, value, qualifiers, time_precision, fetched_at)
SELECT series.id, series.statistic, r.observed_at, r.value, r.qualifiers, 'instant', $16::timestamptz
FROM series CROSS JOIN r
ON CONFLICT (series_id, observed_at) DO UPDATE SET
  value = EXCLUDED.value, qualifiers = EXCLUDED.qualifiers, fetched_at = EXCLUDED.fetched_at`,
      parameters: ['id', 'source_id', 'source_url', 'source_title', 'publisher', 'location_id', 'metric', 'unit', 'statistic',
        'expected_interval_seconds', 'provider_series_ref', 'description', 'license', 'license_url', 'attribution',
        'retrieved_at', 'missing_data_rule', 'investigation_id', 'readings']
    },

    // FK to atlas.embedding_models rejects unagreed identities; CHECK rejects dimension mismatches; the trigger
    // rejects non-permitted chunks and stale content hashes. Changed text re-embeds in place.
    upsert_embeddings: {
      text: `INSERT INTO atlas.chunk_embeddings (source_id, chunk_id, model, model_version, dimensions, content_hash, embedding)
VALUES ($1::text, $2::text, $3::text, $4::text, $5::int, $6::text, $7::vector)
ON CONFLICT (source_id, chunk_id, model, model_version, dimensions)
DO UPDATE SET content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding`,
      parameters: ['source_id', 'chunk_id', 'model', 'model_version', 'dimensions', 'content_hash', 'vector']
    },

    // A failed refresh (last_successful_at NULL) preserves the stored success time. Success clears retry state.
    mark_refresh: {
      text: `INSERT INTO atlas.ingestion_state AS st (source_id, status, attempted_at, last_successful_at, next_retry_at, consecutive_failures, updated_at)
VALUES ($1::text, $3::text, $2::timestamptz, $4::timestamptz,
  CASE WHEN $3::text = 'success' THEN NULL ELSE $5::timestamptz END,
  CASE WHEN $3::text = 'success' THEN 0 ELSE 1 END, now())
ON CONFLICT (source_id) DO UPDATE SET
  status = EXCLUDED.status,
  attempted_at = EXCLUDED.attempted_at,
  last_successful_at = COALESCE(EXCLUDED.last_successful_at, st.last_successful_at),
  next_retry_at = EXCLUDED.next_retry_at,
  consecutive_failures = CASE WHEN EXCLUDED.status = 'success' THEN 0 ELSE st.consecutive_failures + 1 END,
  updated_at = now()`,
      parameters: ['source_id', 'attempted_at', 'status', 'last_successful_at', 'next_retry_at']
    }
  }
};

// NOT consumable by the current backend (its validator rejects unknown plan names). Proposed for a later bucketed
// timeline route agreed by Persons 1 and 3: whole UTC-day buckets from atlas.observation_daily for one series.
// A bucket is returned when it overlaps [observed_from, observed_to]; request day-aligned ranges to avoid partial
// days. `complete` compares readings present with the series' nominal count; gaps are never filled.
export const proposedPlans = {
  observation_buckets: {
    text: `SELECT s.id AS series_id, s.location_id, s.metric, s.unit, s.source_id,
  'P1D' AS bucket_period, 'UTC' AS bucket_timezone,
  ${iso('d.bucket_start')} AS bucket_start, ${iso("d.bucket_start + INTERVAL '1 day'")} AS bucket_end,
  d.sample_count::int AS sample_count, d.value_count::int AS value_count,
  (extract(epoch FROM INTERVAL '1 day') / extract(epoch FROM s.expected_interval))::int AS expected_count,
  d.value_count >= (extract(epoch FROM INTERVAL '1 day') / extract(epoch FROM s.expected_interval)) AS complete,
  d.min_value, d.max_value, d.mean_value,
  ${iso('d.first_observed_at')} AS first_observed_at, ${iso('d.last_observed_at')} AS last_observed_at,
  d.has_estimated, d.has_provisional
FROM atlas.observation_daily d
JOIN atlas.observation_series s ON s.id = d.series_id
WHERE s.location_id = $1::text AND s.metric = $2::text
  AND ($3::timestamptz IS NULL OR d.bucket_start + INTERVAL '1 day' > $3::timestamptz)
  AND ($4::timestamptz IS NULL OR d.bucket_start <= $4::timestamptz)
ORDER BY d.bucket_start
LIMIT $5::int OFFSET $6::int`,
    parameters: ['location_id', 'metric', 'observed_from', 'observed_to', 'limit', 'offset']
  }
};
