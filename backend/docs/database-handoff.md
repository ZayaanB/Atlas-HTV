# Required database handoff — Persons 4 and 3

**Not frozen yet. No domain SQL consumers execute without this handoff.** Person 4's current migrations contain only comments. No backend migration, shadow schema, seed dataset, or alternative database has been created. Person 4 owns schema/migrations/verified data; Person 3 integrates reviewed parameterized query plans into `backend/` once the table/view/column mapping is agreed.

## Runtime integration interface

After freezing the schema, supply a local reviewed module (suggested `backend/handoffs/database.mjs`) exporting:

```js
// Interface illustration only. Empty plans leave data operations unavailable.
export const databaseHandoff = {
  version: 'atlas-p3-v1',
  plans: {
    // news: { text: 'fixed reviewed SQL using $1, $2, ...', parameters: ['location_ids', 'themes', ...] }
  }
};
```

`ATLAS_DATABASE_MODULE` names that repository-relative module. Exported SQL is trusted developer-authored configuration, never supplied by HTTP, ingested content or Gemini. `parameters` lists input field names in placeholder order; values are passed separately to `pg`. Dynamic identifiers/operators are not accepted from request payloads. Rows must be flattened, JSON-compatible shared records/envelopes (not `{record:...}` wrappers). SQL should encode timestamps as UTC ISO strings, numeric measurements as finite numbers or null, and explicit nulls for unavailable fields. JavaScript `pg` timestamp/number defaults alone do not define a wire contract.

`PgRepository` opens one certificate-verified TLS pool, at most five connections, 5-second connection timeout, 8-second statement and 9-second query timeout. A trusted CA file is optional; disabling certificate verification is not supported. URL SSL overrides are rejected because `pg` can override explicit TLS options. There is no schema creation or auto-migration on startup/request. A pool idle error is handled without exposing raw connection details. Closing Fastify closes its owned pool. Readiness checks complete shared contracts and database connectivity; it does not prove provider access or that every table/seed exists.

## Required query plans and semantics

| Plan | Parameters available | Required result/behavior |
| --- | --- | --- |
| `news` | `location_ids`, `themes`, `entity_ids`, `bounds`, `keyword`, `published_from`, `published_to`, `limit`, `offset` | Flat Articles. Apply all strict constraints **before pagination**, stable order (publication descending, nulls last, ID tie break). OR within each array, AND across fields. Literal keyword substring must escape LIKE `%`, `_`, backslash; do not interpret request text as SQL/operators. Unknown publication is excluded from publication filters. Bounds match verified location geometry; regional geometry must fit, not an invented local point. |
| `semantic_news` | Same constraints plus `semantic_query`, serialized `vector`, `model`, `model_version`, `dimensions`, `content_hash` | Flat Articles ranked by permitted chunk vectors; filter on identical model/version/dimensions and all strict geography/date/theme/entity/keyword constraints **before** ranking/limit. Deduplicate articles across chunks. `vector` must bind as a parameter cast to pgvector; never interpolate it. Cite original Article/Source, not vector rows. |
| `locations` | `ids`, `query`, `limit`, `offset` | Flat Locations, stable ID order, literal name substring. Query known IDs with precision/bounds; no inference from news query names. |
| `investigation` | `id` | Zero/one fully resolved `InvestigationResponse`: investigation, linked articles/evidence/observations/locations and original Source records; bound nested arrays/text to shared schema limits. Preserve `id` and direct `source_id`/`source_ids` on citation-bearing records. |
| `observations` | `location_id`, `metric`, `observed_from`, `observed_to`, `limit`, `offset` | Flat raw Observations, ascending observed time/ID, strict location/metric/inclusive observation range before pagination. Same units/series definition as the verified import. Current backend response is raw, not a continuous aggregate. |
| `sources` | `ids` | Original source records for supplied retrieved IDs (max 100). HTTPS links, titles, publisher/attribution/license; do not replace publisher evidence with a provider homepage. |
| `freshness` | Optional `source_id` | With source_id: one ingestion state row including `next_retry_at`. Without it: one bounded aggregate coverage object, with source-specific coverage/last successful refresh/verification/publication availability. Never substitute attempt time for success time. |
| `embedding_chunks` | `source_id`, `chunk_id`; optional `model`, `model_version`, `dimensions` | Permitted chunk `{source_id,chunk_id,text,embedding_permitted}` and matching existing index identity `{model,model_version,dimensions,content_hash}` if present. Required for manual indexing and unchanged-chunk checks. |
| `upsert_articles` | Every normalized Article field in the contract handoff | Atomic upsert of the Article **and** original source/provenance record. Unique canonical URL/stable ID. Preserve reviewed location/entity/theme/verification metadata on refresh; an unreviewed provider row must not overwrite curated facts. Do not erase a known publication date when a later discovery has null. Store provider discovery/provenance separately if multiple providers discover the same URL. |
| `upsert_embeddings` | `source_id`, `chunk_id`, `vector`, `model`, `model_version`, `dimensions`, `content_hash` | Upsert the matching source/chunk/model identity, cast parameterized vector, enforce dimension constraints. Do not remove original evidence. Permit changed-hash reindex; indexing skips exact identity/hash matches. |
| `mark_refresh` | `source_id`, `attempted_at`, `status`, `last_successful_at`, `next_retry_at` | Record refresh state. A failed refresh supplies null success time: **preserve** the previous `last_successful_at`; do not set it to null. Retain prior stored news. On success clear retry state. |

Core retrieval validates/filter-checks returned records defensively. This is not a substitute for correct SQL filter-before-pagination semantics: a bad plan may produce short pages. Observation comparisons are between compatible returned endpoints, with a cap limitation; do not label this as a full-period trend or causal effect. Mixed source/unit/location/metric series and null/non-finite values are rejected for numeric comparison.

Write batches use one checked-out client and BEGIN/COMMIT/ROLLBACK, max 1000 rows. Article upsert and subsequent refresh metadata are separate transactions: if recording success fails after article import, imported data remains, and success metadata must not be claimed. CLI/job runs should use one worker until a database advisory-lock/idempotency strategy is agreed. In-process refreshes for the same source coalesce; the database retry state supports conservative backoff across manual invocations.

## Schema details Person 4 must freeze

Supply exact qualified table/view/column names, join keys, JSON/array/null conventions, unique canonical-URL/source IDs, timestamp types and UTC encoding, observation primary key and series identity, extension availability, permissions and migration version. Supply one verified investigation with linked original sources, known geographic precision, actual observation values/units/periods, coverage/license/attribution, and source refresh metadata. Do not supply credentials in Git.

For TimescaleDB: define the real hypertable, a justified continuous aggregate, bucket timezone/period/units/count/missing-data semantics, refresh policy and an example expected series. A later agreed bucket schema/route will consume that aggregate; current raw timeline code does not claim it.

For pgvector: agree the configured model/version/dimension before defining vector columns/indexes, enforce identity in queries, retain source/chunk text/provenance and permission metadata. Exact search is sufficient initially; no approximate index performance claim is made.

Flight data remains in a process cache with no durable history. Any later TimescaleDB aircraft history, retention or derived database needs a separate Person 4 schema/ODbL handoff. No flight migration/storage is implicitly requested by these adapters.

After handoff: Person 4 applies/reviews migrations and supplies verified seeds; Person 3 integrates concrete SQL plans, validates parameter/filter parity and UTC/null handling against Tiger Cloud, exercises rollback/provider failures, checks the real timeline, and makes a real source-cited Gemini request. Those live checks are pending.
