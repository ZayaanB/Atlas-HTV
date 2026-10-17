-- 001_extensions — Person 4. Forward-only; apply in filename order with psql -v ON_ERROR_STOP=1.
-- Requires a role allowed to create extensions (the Tiger Cloud service owner, tsdbadmin).
-- TimescaleDB is preinstalled on Tiger Cloud services; pgvector is installed as extension "vector".
-- Verified locally on timescale/timescaledb-ha:pg17 (PostgreSQL 17.11, TimescaleDB 2.30.2, pgvector 0.8.7).
-- NOT yet verified on the team's Tiger Cloud service: run `npm --prefix backend run verify:connections -- --database`
-- and confirm both extensions report true before applying 002+.
BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- All Atlas news/civic/evidence objects live in one schema. Aircraft data, if ever stored, gets its own schema (see 005).
CREATE SCHEMA IF NOT EXISTS atlas;

CREATE TABLE IF NOT EXISTS atlas.schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Shared helpers used by views and the proposed query plans.
-- UTC ISO-8601 with milliseconds and an explicit Z, matching JavaScript Date#toISOString.
CREATE OR REPLACE FUNCTION atlas.utc_iso(ts timestamptz) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- Stable text IDs: lowercase, URL-safe, bounded.
CREATE OR REPLACE FUNCTION atlas.valid_id(id text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN id ~ '^[a-z0-9][a-z0-9._:-]*$' AND length(id) <= 160;

INSERT INTO atlas.schema_migrations (version) VALUES ('001_extensions');
COMMIT;
