# Person 4 — Data, evidence, and deployment: database

Read the root `AGENTS.md`, `atlas_prd.md`, `docs/agents/person-4.md`, `contracts/README.md`, `backend/docs/database-handoff.md`, and `backend/docs/sources-handoff.md`. Root instructions apply throughout this subtree. Sibling guides: `scripts/source-definitions/AGENTS.md`, `assets/evidence/AGENTS.md`, `infra/AGENTS.md`.

**Phase gate:** the backend (Person 3) is implemented but blocked on our handoffs. Writing migrations, seeds, source definitions, or deployment config still needs an explicit user instruction for the Person 4 workstream. Until then, keep files comment-only, and do not connect to Tiger Cloud, run migrations or imports, call provider APIs, provision resources, commit, push, or deploy.

## Your scope

Own `db/` (migrations and verified seeds), `assets/evidence/`, `infra/`, and the source/import definitions in `scripts/source-definitions/`. Do not edit `backend/`, `contracts/`, or `frontend/`. Propose cross-owner changes with exact files and interfaces: Person 1 owns `contracts/`, Person 3 owns `backend/`, and Person 2 owns map rendering. Do not create a competing schema, type, or fixture copy.

## Design requirements

- **Target:** one Tiger Cloud PostgreSQL service with TimescaleDB and pgvector. No second database, NoSQL store, or separate vector DB. Verify extension availability on the actual service before relying on it.
- **Migrations:** ordered, forward-only SQL in `db/migrations/` (`001_extensions`, `002_records`, `003_observations`, `004_embeddings`, `005_aircraft`). Each must be reviewable and reproducible on an empty database. The backend never creates schema at request time, so nothing runs implicitly.
- **Shared contracts:** columns map to the schemas in `contracts/`. If a column needs a field the contract lacks, ask Person 1 to change the contract instead of diverging.
- **Timestamps:** `timestamptz`, stored and returned as UTC. Keep event, publication, discovery, observation, and fetch times in separate columns. Never substitute one for another.
- **Geography:** longitude–latitude order. Store precision (`address/facility/city/region`) and `bounds` explicitly. A regional record must not carry an invented point.
- **Nulls and units:** explicit `NULL` for unknown values, never zero or empty-string placeholders. Every observation carries `unit`, `metric`, `source_id`, and period/series identity.
- **IDs and provenance:** stable text IDs. Unique canonical URL per article, and a unique key per source. Keep `source_id` on every citation-bearing record, and keep original-source records separate from provider catalogs.
- **TimescaleDB:** a real observation hypertable and a justified continuous aggregate. Document the bucket period and timezone, units, missing-data handling, refresh policy, and an expected example series. The current backend timeline is raw. Coordinate any bucket schema or route change with Person 3 and Person 1.
- **pgvector:** fix the embedding model, version, and dimension with Person 3 before creating vector columns or indexes. Store `source_id`, `chunk_id`, `model`, `model_version`, `dimensions`, `content_hash`, chunk text, and an `embedding_permitted` flag. Exact search is enough initially. Make no ANN performance claims unless measured.
- **Aircraft:** keep it separate from the news and civic schema. Flights are in a process cache today with no durable history. Add `005_aircraft` storage only after an agreed ODbL, retention, and attribution handoff, with bounded retention and no route, delay, or emergency inference.
- **Ingestion state:** columns for `last_successful_at`, `attempted_at`, `status`, `next_retry_at`, and verification status. A failed refresh must preserve the previous `last_successful_at`.
- **Curated vs. provider rows:** an unreviewed provider refresh must not overwrite reviewed location, entity, theme, or verification metadata, and must not erase a known publication date.

## Seeds and data integrity

- Research first. Every seed row links to a real, reachable original source. Never invent articles, measurements, company relationships, precise coordinates, quotes, or licenses.
- Supply one complete investigation early: linked sources, locations, evidence, and a real observation series with actual values, units, and periods. Optional Toronto content is added only if it forms a complete civic use case.
- Record license, attribution, retrieval date, and coverage for each dataset. Prepared fixtures must be labeled as such and never presented as live.
- Seed definitions are data, not code. Person 3 executes approved imports. Provide an imports and migration-order note to avoid ambiguity.

## Handoff to Person 3

Per `backend/docs/database-handoff.md`, the schema is not frozen until we supply:

1. Exact qualified table, view, and column names, join keys, and JSON/array/null conventions.
2. Unique keys, timestamp types, observation primary key and series identity, and migration version.
3. Extension availability, roles and permissions (no credentials in Git), and the embedding model, version, and dimension.
4. A verified seeded investigation and an example expected timeline series.
5. Proposed SQL for each required plan (`news`, `semantic_news`, `locations`, `investigation`, `observations`, `sources`, `freshness`, `embedding_chunks`, `upsert_articles`, `upsert_embeddings`, `mark_refresh`). Strict filters apply before pagination, with OR within an array and AND across fields. Person 3 integrates these into `backend/handoffs/database.mjs`.

## Meaningful checks

When authorized, verify against the real service: migrations apply cleanly in order; extensions exist; hypertable and aggregate refresh work; example queries return the expected series with units; vector dimension and identity constraints reject mismatches; seed rows round-trip through the contract schemas with preserved nulls and UTC; and no secret appears in any file, log, or sample. Report what ran, what didn't, and what external setup (accounts, credits, extensions) is still missing. Do not call unconfigured resources completed integrations.
