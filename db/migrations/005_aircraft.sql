-- 005_aircraft — Person 4. Intentionally creates NO aircraft storage.
--
-- Why it is left out (2026-10-17 review):
--   * The backend keeps ADSB.lol positions in a per-process memory cache; no route or tool reads or writes
--     durable aircraft history, so a table would have no consumer.
--   * ADSB.lol publishes its API data under ODbL v1.0 (https://opendatacommons.org/licenses/odbl/1-0/) and asks
--     production users to contact the operator; it documents no polling entitlement. Storing samples creates an
--     ODbL "derivative database" with attribution and share-alike obligations that the team has not agreed.
--   * No retention period, attribution display, or deletion job has been agreed with Person 3 and Person 2.
--
-- Before adding storage in a NEW migration (e.g. 006_aircraft_history.sql; never edit an applied file):
--   1. Contact ADSB.lol about production use and record the answer in scripts/source-definitions/README.md.
--   2. Agree retention (proposed: <= 24 hours of samples, enforced with add_retention_policy), attribution
--      text, and ODbL share-alike handling for any published derived data.
--   3. Use a separate schema (atlas_aircraft) and hypertable keyed by (aircraft_id, observed_at), storing only
--      AircraftState fields: no routes, delays, destinations or emergency inferences.
BEGIN;
INSERT INTO atlas.schema_migrations (version) VALUES ('005_aircraft');
COMMIT;
