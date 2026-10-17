-- Loads the Helene/Asheville curated seed. Run from the repository root AFTER migrations 001–005:
--   psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/helene-asheville-2024/load.sql
-- All-or-nothing: any constraint failure rolls the whole seed back. Re-running on a loaded database fails on
-- primary keys by design (seeds are reviewed data, not upserts).
\set ON_ERROR_STOP 1
BEGIN;

\ir records.sql

CREATE TEMP TABLE seed_observations (
  series_id text, statistic text, observed_at timestamptz, value double precision, qualifiers text[],
  time_precision text, period_start timestamptz, period_end timestamptz, fetched_at timestamptz
) ON COMMIT DROP;
-- \copy paths resolve against the psql working directory (the repository root).
\copy seed_observations FROM 'db/seeds/helene-asheville-2024/observations.csv' WITH (FORMAT csv, HEADER true)

INSERT INTO atlas.observations (series_id, statistic, observed_at, value, qualifiers, time_precision, period_start, period_end, fetched_at)
SELECT series_id, statistic, observed_at, value, qualifiers, time_precision, period_start, period_end, fetched_at FROM seed_observations;

-- Integrity checks that constraints cannot express.
DO $$
DECLARE missing integer; counts text;
BEGIN
  SELECT count(*) INTO missing FROM atlas.investigation_observations k
  WHERE NOT EXISTS (SELECT 1 FROM atlas.observations o WHERE o.series_id = k.series_id AND o.observed_at = k.observed_at);
  IF missing > 0 THEN RAISE EXCEPTION '% key observations reference missing rows', missing; END IF;

  SELECT string_agg(series_id || '=' || n, ',' ORDER BY series_id) INTO counts
  FROM (SELECT series_id, count(*) n FROM atlas.observations GROUP BY series_id) c;
  IF counts IS DISTINCT FROM 'usgs-03451000-discharge=1752,usgs-03451000-gage-height=1743,usgs-03451500-annual-peak-discharge=130,usgs-03451500-discharge=1921,usgs-03451500-gage-height=1921' THEN
    RAISE EXCEPTION 'unexpected observation counts: %', counts;
  END IF;

  SELECT count(*) INTO missing FROM atlas.observations o JOIN atlas.observation_series s ON s.id = o.series_id
  WHERE o.observed_at < s.coverage_from OR o.observed_at > s.coverage_to;
  IF missing > 0 THEN RAISE EXCEPTION '% observations fall outside their series coverage', missing; END IF;
END $$;

COMMIT;

-- Historical backfill is older than the policy's 30-day window, so materialize it explicitly (cannot run in a transaction).
CALL refresh_continuous_aggregate('atlas.observation_daily', '2024-09-20T00:00:00Z', '2024-10-11T00:00:00Z');
