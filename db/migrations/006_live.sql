-- 006_live — recurring live ingestion. Provider-asserted event locations for feeds that publish event coordinates
-- (GDACS), and continuously refreshed observation series beside the curated archives of the same gauges.
-- Nothing here relabels curated content: reviewed links stay reviewed, and live rows carry their own provenance.
BEGIN;

-- How an article/location link was established. 'reviewed' is the curated default (every existing row).
-- 'provider_asserted' links are written only by imports, only to unreviewed articles and unreviewed locations whose
-- coordinates/bounds the provider itself published for that item. They are not geocoded or inferred from text.
ALTER TABLE atlas.article_locations
  ADD COLUMN link_basis text NOT NULL DEFAULT 'reviewed' CHECK (link_basis IN ('reviewed', 'provider_asserted'));

-- One series per (location, metric, source): a live provider series of a gauge sits beside the curated archive of
-- the same gauge without mixing provenance. Consumers that need exactly one series select it by series_id; rows
-- always carry series_id and source_id, and comparisons still reject mixed sources.
ALTER TABLE atlas.observation_series DROP CONSTRAINT observation_series_location_id_metric_key;
ALTER TABLE atlas.observation_series
  ADD CONSTRAINT observation_series_location_metric_source_key UNIQUE (location_id, metric, source_id);

-- Raises instead of silently skipping when a reviewed import plan's precondition fails (e.g. a configured series ID
-- that already belongs to another location/metric/unit/source).
CREATE FUNCTION atlas.require(condition boolean, message text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'atlas precondition failed: %', message USING ERRCODE = 'check_violation'; END IF;
  RETURN true;
END $$;

INSERT INTO atlas.schema_migrations (version) VALUES ('006_live');
COMMIT;
