# Database — Person 4

Atlas uses one Tiger Cloud PostgreSQL service with TimescaleDB and pgvector: relational research records, a real observation hypertable with one continuous aggregate, and embedding storage. There is no second database, NoSQL store or separate vector database.

| Path | What it is |
| --- | --- |
| `migrations/001–005` | Forward-only schema migrations, applied in filename order. |
| `roles/atlas_runtime.sql` | Least-privilege login role for the backend. |
| `seeds/helene-asheville-2024/` | One complete, source-linked investigation with a real USGS observation series (provenance in `SOURCES.md`). |
| `handoff/database.mjs` | Reviewed, parameterized SQL for every plan Person 3 needs (`atlas-p3-v1`). |
| `checks/validate-handoff.mts` | Runs every plan through the backend's own repository against a **disposable local** database. |

## Status: what was and was not verified (2026-10-17)

| Verified locally | Not yet verified (needs external setup) |
| --- | --- |
| **Migrations.** 001→005 apply cleanly to an empty `timescale/timescaledb-ha:pg17` database (PostgreSQL 17.11, TimescaleDB 2.30.2, pgvector 0.8.7). | **The team's Tiger Cloud service** has not been touched: no migration, role, seed or query has run there. Extension availability there is unconfirmed. |
| **Seed load.** It loads in one transaction (7,467 observations). Every key observation resolves, and the aggregate refreshes to 84 materialized daily buckets. | **Tiger Cloud's TimescaleDB/pgvector versions** and whether `tsdbadmin` can `CREATE EXTENSION vector`. |
| **Plan checks.** 110 checks pass through `PgRepository` connected as `atlas_runtime`, covering filters, pagination, refresh, writes and embeddings in detail (see [Local validation](#local-validation)). | **TLS connection behaviour** of the real backend pool (`createPool` requires a CA-verified TLS connection; the local check used plain TCP). |
| **Hash parity.** The SQL article/chunk hashes match the backend's Node `sha256` algorithms on all 42 seeded rows. | **Full API responses.** Person 1's contract schemas do not exist yet, so no API response has been validated end to end. |
| **Backend check.** `npm --prefix backend run check` with `ATLAS_DATABASE_MODULE=db/handoff/database.mjs` reports `missing_plans: []`. | **Embeddings.** No real embedding has been generated (no model is agreed); semantic search was exercised with 4-dimensional test vectors only. |

## Migration order

Run these as the service owner (`tsdbadmin` on Tiger Cloud), from the repository root, with `ON_ERROR_STOP`. **Do not run them against Tiger Cloud until Person 4 is authorized to do so.**

```bash
# ATLAS_ADMIN_DATABASE_URL is a local shell variable only (never committed, never in backend/.env).
for f in db/migrations/001_extensions.sql db/migrations/002_records.sql db/migrations/003_observations.sql \
         db/migrations/004_embeddings.sql db/migrations/005_aircraft.sql; do
  psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/roles/atlas_runtime.sql
psql "$ATLAS_ADMIN_DATABASE_URL" -c '\password atlas_runtime'      # interactive; nothing lands in history
psql "$ATLAS_ADMIN_DATABASE_URL" -c 'SELECT version FROM atlas.schema_migrations ORDER BY version'
```

| Migration | Creates |
| --- | --- |
| `001_extensions` | `timescaledb` and `vector` extensions, the `atlas` schema, `atlas.schema_migrations`, and helpers `atlas.utc_iso()` and `atlas.valid_id()`. |
| `002_records` | `sources`, `locations`, `entities`, `themes`, `articles`, `article_discoveries`, link tables (`article_locations`, `article_entities`, `article_themes`), `investigations`, `investigation_items` and `investigation_item_sources`, `investigation_articles`, `investigation_locations`, `evidence`, `evidence_sources`, `investigation_evidence`, and `ingestion_state`. Also the view `article_records` and the functions `location_within()` and `article_content_hash()`. |
| `003_observations` | `observation_series`, the hypertable `observations`, the continuous aggregate `observation_daily` with its refresh policy, the view `observation_records`, and `investigation_observations` and `investigation_series`. |
| `004_embeddings` | `embedding_models` (starts empty), `text_chunks` (with a hash trigger), and `chunk_embeddings` (an untyped `vector`, with a dimension CHECK, an FK to `embedding_models`, and a permission/staleness guard trigger). |
| `005_aircraft` | **No storage.** It only records the version, and explains why: no consumer exists, and no ODbL or retention policy has been agreed. |

Migrations never change after they have been applied to a shared service; any change goes in a new numbered file. The backend never creates schema at request time.

## Load the curated seed

```bash
psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/helene-asheville-2024/load.sql   # from the repo root
```

`load.sql` runs as one transaction:
1. Applies `records.sql`.
2. Copies in `observations.csv`.
3. Verifies the counts, the key observations and the series coverage.

After the commit, it refreshes `observation_daily` for 2024-09-20 to 2024-10-11. Running it again fails on primary keys, so a seed is never silently merged. See [`seeds/README.md`](seeds/README.md).

## Handoff to Person 3 (frozen schema `005_aircraft`, interface `atlas-p3-v1`)

You can either set `ATLAS_DATABASE_MODULE=db/handoff/database.mjs` (the backend loader accepts `db/`) or copy the module to `backend/handoffs/database.mjs`. It exports all 11 plans: `news`, `semantic_news`, `locations`, `investigation`, `observations`, `sources`, `freshness`, `embedding_chunks`, `upsert_articles`, `upsert_embeddings`, and `mark_refresh`. It also exports `proposedPlans.observation_buckets`, which the current validator would reject, so it is kept separate.

### Conventions every plan follows

- **Tables and keys.** Everything lives in schema `atlas`. Stable text IDs match `^[a-z0-9][a-z0-9._:-]*$` (at most 160 characters). The unique keys are `sources.url`, `articles.url`, `observation_series (location_id, metric)` and the observations PK `(series_id, observed_at)`. An Observation `id` is `<series_id>@<YYYYMMDDTHHMMSSZ>`.
- **Timestamps.** Stored as `timestamptz`. Returned by `atlas.utc_iso()` as `YYYY-MM-DDTHH:MM:SS.mmmZ`, matching `Date#toISOString`. Dates (`published_date`, event dates) are returned as `YYYY-MM-DD` strings.
- **Nulls.** Unknown values are SQL `NULL` → JSON `null`. Values are never coerced to `0` or `''`. Every count is cast to `int`, because `pg` would return a bigint as a string.
- **Arrays.** `location_ids`, `entity_ids`, `themes` and `qualifiers` are `text[]` and arrive as JS arrays. `coordinates` is `[lon, lat]` and `bounds` is `[west, south, east, north]`; both are `json` and arrive as number arrays, or `null`.
- **Filters.** OR within an array, AND across fields, and an empty array means no constraint. A `keyword` matches through `strpos` on lower-cased text, so `%`, `_` and `\` are literal and no LIKE escaping is needed. Unknown publication times never match a publication-date filter. A `bounds` filter matches a city or region only when its whole extent fits, and a facility only by its point. All filters run **before** `ORDER BY … LIMIT/OFFSET`.
- **Parameter binding.** Every placeholder is explicitly cast (`$n::text`, `::text[]`, `::float8[]`, `::timestamptz`, `::int`, `::vector`), so unused (`NULL`) parameters bind safely.
- **Two kinds of "source".** `atlas.sources.id` is an original evidence record (the citation target). `ingestion_state.source_id`, `freshness(source_id)` and `mark_refresh(source_id)` are the **source-definition IDs** in `scripts/source-definitions/atlas.mjs`.

### Write semantics (`upsert_articles`)

Each normalized Article becomes **one statement**, which upserts four things: the original `sources` row (by `url`), the `articles` row (by `url`), the provider's `article_discoveries` row (`article_id, provider_source_id`), and the article's embeddable `text_chunks` row (the title, plus the excerpt if one is permitted).

- **No review claims.** Imports are always `unreviewed`. They never write location, entity or theme links, `geographic_precision`, or `event_at`.
- **Reviewed rows are protected.** A reviewed row keeps its title, publisher, excerpt and publication facts. A provider rediscovering a curated URL only adds a discovery row; this is tested on the WLOS seed article.
- **Dates only improve.** A NULL publication time never erases a known one. `discovered_at` keeps the earliest value and `fetched_at` the latest.
- **Hashing.** `content_hash` is recomputed in SQL from the stored values by `atlas.article_content_hash()`, the same algorithm as `normalizeArticle`.
- **Failed refreshes.** `mark_refresh` with `last_successful_at = NULL` (a failure) keeps the stored success time and increments `consecutive_failures`. A success clears `next_retry_at`.

## Field assumptions and contract gaps (for Person 1)

`contracts/schemas/*.ts` are still comment-only. The SQL follows the field list in `backend/docs/contracts-handoff.md`. Each column list is a single constant in `handoff/database.mjs`, so any rename is a one-line change there.

1. **No authoritative schemas yet.** The backend validates every row against Person 1's schemas, so no API can serve data until `contracts/` exports them (`npm --prefix backend run check` currently lists all 24 as missing).
2. **Article additions.** `published_date` is added for date-only publications: the USGS release shows only "October 4, 2024", so `published_at` stays NULL rather than inventing 00:00. `publication_time_basis` adds `page_metadata`, `document_text` and `date_only` alongside `feed_asserted` and `unavailable`. `provider` adds `curated`.
3. **Location additions.** Adds `coordinates_basis`, `bounds_basis`, `source_id` and `verification_status`. City and region rows carry both a sourced representative point and their extent.
4. **Observation additions.** Adds `series_id`, `statistic` (`instantaneous`, `annual_peak` …), `qualifiers` (USGS codes), `time_precision` (`instant`, `minute`, `day`), and `period_start`/`period_end` (water year).
5. **Source additions.** Adds `publisher`, `source_type`, `license`, `license_url`, `attribution`, `published_at`, `published_date`, `published_at_basis`, `retrieved_at` and `verification_status`.
6. **No Evidence schema.** The PRD lists Evidence, but the contracts handoff has no `Evidence` schema. The proposal is the shape returned inside `investigation.evidence`: `type`, `source_id`, `source_ids`, `observed_from`/`observed_to`, `series_id`, and an `imagery` object (`bounds`, `asset_path`, `layer_ref`, `legend`, `attribution`, `license`, `resolution_m`, `comparison_group`, `comparison_role`).
7. **InvestigationResponse envelope.** The proposal is `{investigation, articles, evidence, observations, observation_series, locations, sources}`. `investigation.items[]` are `{id, kind, text, source_ids}` with kind `what_happened|public_impact|resource|research_question|uncertainty|business_exposure`. The envelope also carries `event_period {start_date, end_date, timezone}` and `key_observations [{observation_id, role}]`. Every citation-bearing record has `id` plus `source_id` or `source_ids`.
8. **Coverage shape (`freshness` with no `source_id`).** The proposal is `{scope:'all', feeds[], datasets[], articles{total, reviewed, unreviewed, publication_time_known, publication_date_only}}`. Per-source fields are `null` at this scope by design, and the backend adds `mode` and `live`.
9. **Bucketed timeline.** `ObservationsResponse` only allows `aggregation:"raw"`. The daily buckets need a new response schema from Person 1, plus a new plan name (`observation_buckets`) added to the backend's `reads` list by Person 3.
10. **FlightRegion.** The schema is missing, so `regions` in the source definitions are not yet schema-validated by the backend.

## Observations and the continuous aggregate

**Hypertable.** `atlas.observations` is partitioned by `observed_at` in 365-day chunks. The curated series are small, and the annual-peak record is sparse back to 1896.

**Series identity.** `atlas.observation_series` holds one row per (location, metric), with the unit, statistic, source, provider reference, missing-data rule, license and coverage. A composite FK keeps each observation's `statistic` equal to its series' `statistic`.

**Aggregate.** `atlas.observation_daily` is a continuous aggregate:

| Property | Value |
| --- | --- |
| Bucket | `time_bucket('1 day', observed_at)`: one whole **UTC calendar day**, `[bucket_start, bucket_start + 1 day)`. For Asheville, a UTC day runs 20:00 EDT to 20:00 EDT. |
| Input | Only `statistic = 'instantaneous'` rows. Annual peaks are never averaged into days. |
| Columns | `sample_count`, `value_count` (non-null values), `min_value`, `max_value`, `mean_value`, `first_observed_at`, `last_observed_at`, `has_estimated` (any `e` qualifier), `has_provisional` (any `P`). |
| Units | The series unit, unchanged (ft³/s stored as `ft3/s`, ft). Mean, min and max share that unit. |
| Missing data | Gaps are absent rows and are never interpolated. A provider no-data value is stored as a NULL `value`, so it counts in `sample_count` but not in `value_count`. `complete` in the bucket plan means `value_count >= 86400 / expected_interval` (96 for 15-minute data). Extra irregular readings, such as USGS's crest at 21:38Z, can push a day above 96. |
| Refresh | Policy: every hour, for the window `[now − 30 days, now − 1 hour]`, for future recurring imports. A historical backfill (like this seed) is older than that window, so the import calls `refresh_continuous_aggregate` for its own window. `materialized_only = false` (real-time aggregation): rows not yet materialized are still aggregated on read, so results are correct before a refresh. |
| Retention | None. Curated evidence is kept. |

**Why it's justified.** A 20-day flood window holds about 1,920 raw 15-minute readings per series, which is 20 pages at the API's 100-row limit. The daily series draws the visible timeline in 21 points, `max_value` keeps the crest, and the raw rows stay available for drill-down.

**Expected series:** `usgs-03451500-discharge`, i.e. location `loc-usgs-03451500`, metric `discharge`, unit `ft3/s`. These are actual values from the local run:

| bucket_start (UTC) | n | min | max | mean | complete |
| --- | --- | --- | --- | --- | --- |
| 2024-09-20 | 96 | 1040 | 1190 | 1107.7 | yes |
| 2024-09-21 | 96 | 858 | 1040 | 923.6 | yes |
| 2024-09-22 | 96 | 770 | 858 | 805.8 | yes |
| 2024-09-23 | 96 | 727 | 770 | 747.3 | yes |
| 2024-09-24 | 96 | 727 | 1260 | 862.1 | yes |
| 2024-09-25 | 96 | 1250 | 7710 | 1881.9 | yes |
| 2024-09-26 | 96 | 7960 | 22900 | 17882.1 | yes |
| **2024-09-27** | **97** | 23200 | **113000** | 54727.8 | yes (extra crest reading) |
| 2024-09-28 | 95 | 54400 | 105000 | 74628.4 | **no** (20:30Z missing) |
| 2024-09-29 | 96 | 28700 | 53900 | 40553.1 | yes |
| 2024-09-30 | 96 | 14100 | 28300 | 19970.8 | yes |
| 2024-10-01 … 2024-10-09 | 96 each | 8760 → 2220 | 14000 → 2380 | 10885.1 → 2295.5 | yes |
| 2024-10-10 | 1 | 2220 | 2220 | 2220.0 | **no** (only the inclusive end reading) |

## Embeddings (pgvector)

No embedding model is agreed yet: `EMBEDDING_MODEL` and `EMBEDDING_VERSION` are unset in `backend/.env.example`, and `EMBEDDING_DIMENSIONS` defaults to 768. So the schema assumes no model:

- **Untyped vector.** `chunk_embeddings.embedding` is an untyped `vector` with `CHECK (vector_dims(embedding) = dimensions)`.
- **No identity yet.** `atlas.embedding_models` is **empty**, and the FK means every embedding write fails until Persons 3 and 4 register the agreed identity:
  ```sql
  INSERT INTO atlas.embedding_models (model, model_version, dimensions, approved_at, approved_note)
  VALUES ('<EMBEDDING_MODEL>', '<EMBEDDING_VERSION>', <EMBEDDING_DIMENSIONS>, now(), '<who agreed, where>');
  ```
- **Write guard.** A trigger rejects embeddings of chunks with `embedding_permitted = false`, and embeddings whose `content_hash` does not match the chunk's current text (`sha256` of the UTF-8 text, kept current by a trigger).
- **What can be embedded.** Stored titles plus a source-permitted excerpt (never full article text), and the Atlas-authored, source-linked brief passages (22 in the seed).
- **Search.** Exact cosine distance (`<=>`) only. No ANN index exists and no performance is claimed. An HNSW index needs a fixed dimension and a measured need. It would be added in a new migration as an expression index, e.g. on `(embedding::vector(768))` restricted with `WHERE dimensions = 768`.

## News refresh and retention

Imports run through Person 3's CLI, one reviewed definition at a time: `npm --prefix backend run ingest -- gdelt-asheville-flooding`. GDELT asks for at most one request every 5 seconds, so wait between sources. A failure keeps all stored rows and `last_successful_at`, and backs off at least 15 minutes (`next_retry_at`). Scheduled ingestion is not enabled.

| Data | Retention |
| --- | --- |
| Imported article metadata | Kept until removed (title, URL, timestamps, excerpt of at most 500 characters only where permitted). |
| Curated seed | Permanent. |
| Observations | Permanent. |
| Embeddings | Replaced in place when chunk text changes; stale rows are ignored by search. |
| Aircraft | Not stored (see `005_aircraft`). |

Licences and attribution are recorded in `scripts/source-definitions/README.md` and `seeds/helene-asheville-2024/SOURCES.md`.

## Example queries

```sql
-- The crest and the reading that matched the provisional 24.67 ft report.
SELECT id, metric, value, unit, atlas.utc_iso(observed_at) AS observed_at, qualifiers
FROM atlas.observation_records
WHERE location_id = 'loc-usgs-03451500' AND observed_at BETWEEN '2024-09-27T21:00Z' AND '2024-09-27T22:00Z'
ORDER BY observed_at, metric;

-- Daily timeline from the continuous aggregate (what the bucket plan returns).
SELECT atlas.utc_iso(bucket_start), value_count, min_value, max_value, round(mean_value::numeric, 1)
FROM atlas.observation_daily WHERE series_id = 'usgs-03451500-discharge' ORDER BY bucket_start;

-- Historical comparison: the five largest annual peaks (discharge, never stage, across the 1916 datum change).
SELECT extract(year FROM period_end) AS water_year, value, unit, time_precision, qualifiers
FROM atlas.observation_records WHERE series_id = 'usgs-03451500-annual-peak-discharge'
ORDER BY value DESC LIMIT 5;

-- Drinking-water reporting placed within Asheville's extent, newest first.
SELECT id, title, atlas.utc_iso(published_at) FROM atlas.article_records a
WHERE themes && '{drinking-water}' AND EXISTS (
  SELECT 1 FROM atlas.article_locations al JOIN atlas.locations l ON l.id = al.location_id
  WHERE al.article_id = a.id AND atlas.location_within(l, -82.7, 35.4, -82.4, 35.7))
ORDER BY published_at DESC NULLS LAST, id;
```

## Local validation

To validate locally, use a disposable container. It has no TLS and must never be pointed at Tiger Cloud.

```bash
docker run -d --name atlas-p4-pg -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=<local-only> -e POSTGRES_DB=atlas timescale/timescaledb-ha:pg17
# Apply 001–005, db/roles/atlas_runtime.sql (then ALTER ROLE atlas_runtime PASSWORD '<local-only>') and the seed as above, then:
npm --prefix backend ci
cd backend && ATLAS_CHECK_ADMIN_URL=postgres://postgres:<pw>@127.0.0.1:55432/atlas \
  ATLAS_CHECK_RUNTIME_URL=postgres://atlas_runtime:<pw>@127.0.0.1:55432/atlas node --import tsx ../db/checks/validate-handoff.mts
```

The check script writes test rows: a `gdelt-test` refresh state, `example.org` articles, and a 4-dimensional test embedding model. It refuses any host other than localhost. Its 110 assertions cover:
- **News:** filter parity against the backend's own `matchesNews` and bounds logic (17 queries), plus pagination after filtering.
- **Locations:** precision and bounds behaviour, and literal `%`.
- **Investigation:** citation integrity (every cited source is returned), and key observations, evidence and imagery bounds.
- **Observations:** ordering and pagination.
- **Sources:** date-only and millisecond timestamps.
- **Freshness:** `mark_refresh` success → failure → success.
- **Article upserts:** RSS date preservation, curated-row protection, and batch rollback.
- **Embeddings:** rejection for an unregistered identity, a dimension mismatch, a stale hash and a non-permitted chunk; strict filters on semantic search; stale embeddings ignored.
- **Daily buckets.**

## Scope decision: Toronto civic content cut

There is no Toronto civic investigation. A complete School of Cities use case needs linked civic datasets, a defined resident decision and a usable comparison or briefing. None of that could be researched and verified to the same standard in this slice, so per the PRD cut order it is left out rather than shipped half-built. The schema supports it later: add `locations` with Statistics Canada or City of Toronto boundaries, plus an `observation_series` for each civic indicator.

## Sponsor use (Tiger Data): what is actually implemented

- **Implemented in code:** relational research records with verified links, a TimescaleDB hypertable of real USGS observations, and a justified daily continuous aggregate with a refresh policy and documented semantics. Also pgvector storage with identity enforcement, and reproducible queries.
- **Not yet true:** none of this is running on Tiger Cloud. It counts as a sponsor integration only after the migrations and seed are applied there and the deployed timeline reads from it.
