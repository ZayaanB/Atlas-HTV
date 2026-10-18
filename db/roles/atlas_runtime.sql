-- Least-privilege role for the backend (API + manual ingest/embed CLIs) — Person 4.
-- Run as the service owner (tsdbadmin) after migrations 001–006; re-running it is safe and applies new grants:
--   psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/roles/atlas_runtime.sql
-- Then set the password interactively so it never touches Git, shell history or logs:
--   psql "$ATLAS_ADMIN_DATABASE_URL" -c '\password atlas_runtime'
-- and build the backend's DATABASE_URL from it (store only in /etc/atlas/backend.env or backend/.env).
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_runtime') THEN
    CREATE ROLE atlas_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 10;
  END IF;
END $$;

-- Bounded statements even if a plan misbehaves (the backend also sets 8 s / 9 s client-side timeouts).
ALTER ROLE atlas_runtime SET statement_timeout = '10s';
ALTER ROLE atlas_runtime SET idle_in_transaction_session_timeout = '30s';

GRANT USAGE ON SCHEMA atlas TO atlas_runtime;
-- Read everything the query plans touch (tables, views, the continuous aggregate).
GRANT SELECT ON ALL TABLES IN SCHEMA atlas TO atlas_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA atlas TO atlas_runtime;
-- Writes only where upsert_articles / upsert_embeddings / mark_refresh write. No DELETE, no DDL.
GRANT INSERT, UPDATE ON atlas.sources, atlas.articles, atlas.article_discoveries, atlas.text_chunks,
  atlas.chunk_embeddings, atlas.ingestion_state TO atlas_runtime;
-- Live ingestion (006): upsert_event_locations writes unreviewed provider locations and provider_asserted links;
-- upsert_observation_series writes live series, their readings (hypertable) and configured investigation links.
-- The plans never update reviewed locations, curated series or existing investigation links.
GRANT INSERT, UPDATE ON atlas.locations, atlas.article_locations, atlas.observation_series, atlas.observations TO atlas_runtime;
GRANT INSERT ON atlas.investigation_series TO atlas_runtime;

COMMIT;
