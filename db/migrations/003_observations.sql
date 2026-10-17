-- 003_observations — Person 4. Real indicator observations in a TimescaleDB hypertable plus one continuous aggregate.
-- Series identity lives in atlas.observation_series; (location_id, metric) identifies exactly one series so the
-- backend's location/metric query and comparison can never mix sources, units or statistics.
-- Aggregate semantics (bucket, timezone, units, missing data, refresh) are documented in db/README.md.
BEGIN;

CREATE TABLE atlas.observation_series (
  id                  text PRIMARY KEY CHECK (atlas.valid_id(id)),
  location_id         text NOT NULL REFERENCES atlas.locations (id),
  metric              text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]*$'),
  -- Unit exactly as published by the source (no silent conversion), e.g. 'ft3/s', 'ft'.
  unit                text NOT NULL CHECK (btrim(unit) <> ''),
  -- What one value represents: an instantaneous reading or a period statistic.
  statistic           text NOT NULL CHECK (statistic IN ('instantaneous', 'annual_peak', 'daily_mean', 'daily_total')),
  -- Nominal sampling interval for instantaneous series; NULL for irregular/period statistics.
  expected_interval   interval CHECK (expected_interval IS NULL OR expected_interval > interval '0'),
  source_id           text NOT NULL REFERENCES atlas.sources (id),
  -- Provider's own identifier, e.g. 'USGS:03451500:00060:00000'.
  provider_series_ref text NOT NULL,
  description         text NOT NULL,
  missing_data_rule   text NOT NULL,
  license             text NOT NULL,
  attribution         text NOT NULL,
  coverage_from       timestamptz NOT NULL,
  coverage_to         timestamptz NOT NULL,
  retrieved_at        timestamptz NOT NULL,
  live                boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, metric),
  UNIQUE (id, statistic),
  CHECK (coverage_from <= coverage_to),
  CHECK ((statistic = 'instantaneous') = (expected_interval IS NOT NULL))
);

ALTER TABLE atlas.evidence
  ADD CONSTRAINT evidence_series_fk FOREIGN KEY (series_id) REFERENCES atlas.observation_series (id);

CREATE TABLE atlas.observations (
  series_id      text NOT NULL,
  -- Copied from the series and pinned by the composite foreign key, so the aggregate can filter on it.
  statistic      text NOT NULL,
  -- Instant of the reading (instantaneous) or of the peak; for day-precision values, 00:00 of the provider's
  -- local standard-time date expressed in UTC, with time_precision = 'day' (no invented clock time).
  observed_at    timestamptz NOT NULL,
  -- NULL means the provider published the timestamp without a usable value. Absent rows are gaps; never interpolated.
  value          double precision CHECK (value IS NULL OR value::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  -- Provider qualification codes, e.g. USGS 'A' approved, 'P' provisional, 'e' estimated; peak codes '7', '9'.
  qualifiers     text[] NOT NULL DEFAULT '{}',
  -- 'instant' = an instantaneous reading; 'minute'/'day' = the resolution at which a statistic's time is reported.
  time_precision text NOT NULL DEFAULT 'instant' CHECK (time_precision IN ('instant', 'minute', 'day')),
  -- Period a statistic summarizes (e.g. a USGS water year for annual peaks); NULL for instantaneous readings.
  period_start   timestamptz,
  period_end     timestamptz,
  fetched_at     timestamptz NOT NULL,
  PRIMARY KEY (series_id, observed_at),
  FOREIGN KEY (series_id, statistic) REFERENCES atlas.observation_series (id, statistic),
  CHECK ((statistic = 'instantaneous') = (time_precision = 'instant')),
  CHECK ((period_start IS NULL) = (period_end IS NULL)),
  CHECK (period_start IS NULL OR (period_start <= observed_at AND observed_at < period_end))
);

-- One-year chunks: curated series are small (thousands of rows per year), and the sparse annual-peak record
-- reaches back to the 1890s, so shorter chunks would mostly create near-empty partitions.
SELECT create_hypertable('atlas.observations', by_range('observed_at', INTERVAL '365 days'));

-- Daily UTC buckets of instantaneous readings. Justification: a 20-day flood window holds ~1,900 raw 15-minute
-- readings per series (beyond the API's 100-row page); the daily min/max/mean/count series draws the visible
-- timeline in 21 points while raw rows remain available for drill-down. max_value preserves the flood crest.
CREATE MATERIALIZED VIEW atlas.observation_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  series_id,
  time_bucket(INTERVAL '1 day', observed_at) AS bucket_start,
  count(*)                                    AS sample_count,
  count(value)                                AS value_count,
  min(value)                                  AS min_value,
  max(value)                                  AS max_value,
  avg(value)                                  AS mean_value,
  min(observed_at)                            AS first_observed_at,
  max(observed_at)                            AS last_observed_at,
  bool_or('e' = ANY (qualifiers))             AS has_estimated,
  bool_or('P' = ANY (qualifiers))             AS has_provisional
FROM atlas.observations
WHERE statistic = 'instantaneous'
GROUP BY series_id, time_bucket(INTERVAL '1 day', observed_at)
WITH NO DATA;

-- Recent-window refresh for future recurring imports. Curated historical backfills (like the 2024 seed) are older
-- than start_offset, so the import procedure refreshes their window explicitly (db/README.md). Because
-- materialized_only = false, unmaterialized rows are still aggregated in real time, so results stay correct.
SELECT add_continuous_aggregate_policy('atlas.observation_daily',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- Flat Observation rows with series identity, shared by the observations and investigation plans.
CREATE VIEW atlas.observation_records AS
SELECT
  o.series_id || '@' || to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') AS id,
  o.series_id, s.location_id, s.metric, s.unit, o.statistic, s.source_id,
  o.observed_at, o.value, o.qualifiers, o.time_precision, o.period_start, o.period_end, o.fetched_at
FROM atlas.observations o
JOIN atlas.observation_series s ON s.id = o.series_id;

-- Curated key observations for an investigation (e.g. a gauge's crest). Kept as (series_id, observed_at)
-- because foreign keys into the hypertable are avoided; seeds are checked for dangling references.
CREATE TABLE atlas.investigation_observations (
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  series_id        text NOT NULL REFERENCES atlas.observation_series (id),
  observed_at      timestamptz NOT NULL,
  role             text NOT NULL CHECK (btrim(role) <> ''),
  position         integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (investigation_id, series_id, observed_at)
);

CREATE TABLE atlas.investigation_series (
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  series_id        text NOT NULL REFERENCES atlas.observation_series (id),
  position         integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (investigation_id, series_id)
);

INSERT INTO atlas.schema_migrations (version) VALUES ('003_observations');
COMMIT;
