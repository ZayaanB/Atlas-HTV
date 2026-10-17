-- Seed: Hurricane Helene's French Broad River flood at Asheville, NC (September 2024) — Person 4.
-- Curated seed (not live, not a provider import). Every URL below returned HTTP 200 on 2026-10-17 (retrieved_at),
-- and every statement was checked against the linked page text or the USGS data files. See SOURCES.md.
-- Times are UTC. Event dates are local calendar dates (America/New_York). NULL means unknown, never zero.
-- Load with load.sql (it wraps this file and observations.csv in one transaction).

-- Sources --------------------------------------------------------------------------------------------------------
INSERT INTO atlas.sources (id, url, title, publisher, source_type, license, license_url, attribution, published_at, published_date, published_at_basis, retrieved_at, verification_status, reviewed_at) VALUES
('src-usgs-alert-2024-09-30', 'https://water.usgs.gov/alerts/item_2024-09-30_21:46:06.html',
 'PROJECT ALERT NOTICE (GA NC SC) 09/30/2024 USGS SAWSC response to post-Hurricane Helene flooding',
 'U.S. Geological Survey, South Atlantic Water Science Center', 'government_report', 'U.S. Public Domain',
 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 '2024-10-01T01:46:06Z', NULL, 'document_text', '2026-10-17T11:49:34Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-news-helene-streamgages', 'https://www.usgs.gov/news/national-news-release/usgs-collecting-flood-data-and-repairing-streamgages-damaged-hurricane',
 'USGS is collecting flood data and repairing streamgages damaged by Hurricane Helene', 'U.S. Geological Survey', 'government_report',
 'U.S. Public Domain', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, '2024-10-04', 'date_only', '2026-10-17T11:49:36Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-nws-gsp-helene-flood-summary', 'https://www.weather.gov/gsp/20240926-20240927_flood_eventSum',
 'Summary of 20240926-20240927 Flash Flood Event', 'National Weather Service Greenville-Spartanburg', 'government_report',
 'Public domain (NWS web pages, unless noted otherwise)', 'https://www.weather.gov/disclaimer', 'NOAA National Weather Service',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:37Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-nasa-eo-flash-floods-nc', 'https://science.nasa.gov/earth/earth-observatory/flash-floods-swamp-north-carolina-153416/',
 'Flash Floods Swamp North Carolina', 'NASA Earth Observatory', 'news_article',
 'NASA media usage guidelines (generally not subject to U.S. copyright; third-party material excepted)',
 'https://www.nasa.gov/nasa-brand-center/images-and-media/', 'NASA Earth Observatory',
 '2024-10-05T16:00:00Z', NULL, 'page_metadata', '2026-10-17T11:49:37Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-foxweather-rad-drone', 'https://www.foxweather.com/extreme-weather/asheville-north-carolina-river-arts-district-flooding-drone',
 'Drone video shows Asheville''s River Arts District underwater during record-breaking flooding', 'FOX Weather', 'news_article',
 'Publisher copyright; link and title only', NULL, 'FOX Weather',
 '2024-09-30T19:25:55Z', NULL, 'page_metadata', '2026-10-17T11:49:37Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-eenews-helene-flood-records', 'https://www.eenews.net/articles/helene-broke-century-old-flood-records-across-southeast/',
 'Helene broke century-old flood records across Southeast', 'E&E News by POLITICO', 'news_article',
 'Publisher copyright; link and title only', NULL, 'E&E News by POLITICO',
 '2024-10-04T20:14:22Z', NULL, 'page_metadata', '2026-10-17T11:49:38Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-wlos-first-water-flow', 'https://wlos.com/news/local/buncombe-county-sees-first-water-flow-since-hurricane-helene',
 'Buncombe County sees first water flow since Hurricane Helene', 'WLOS', 'news_article',
 'Publisher copyright; link and title only', NULL, 'WLOS',
 '2024-10-12T18:58:30Z', NULL, 'page_metadata', '2026-10-17T11:49:38Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-wlos-boil-water-lifted', 'https://wlos.com/news/local/breaking-boil-water-advisory-has-been-lifted-water-resources-department-says',
 'Asheville''s boil water notice has been lifted, water resources department says', 'WLOS', 'news_article',
 'Publisher copyright; link and title only', NULL, 'WLOS',
 '2024-11-18T16:43:49Z', NULL, 'page_metadata', '2026-10-17T11:49:38Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-wbtv-boil-water-lifted', 'https://www.wbtv.com/2024/11/18/asheville-boil-water-advisory-lifted-nearly-2-months-after-helene/',
 'Asheville boil water advisory lifted nearly 2 months after Helene', 'WBTV', 'news_article',
 'Publisher copyright; link and title only', NULL, 'WBTV',
 '2024-11-18T19:15:44.305Z', NULL, 'page_metadata', '2026-10-17T11:49:38Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-wlos-council-recovery-2025', 'https://wlos.com/news/local/asheville-city-council-approves-helene-recovery-items-breakdown-fema-hud-grants-water-system-north-fork-transmission-main-gashes-creek-bridge-four-boards-economy-housing-infrastructure',
 'Asheville City Council approves 10 Helene recovery items. Here''s a breakdown', 'WLOS', 'news_article',
 'Publisher copyright; link and title only', NULL, 'WLOS',
 '2025-08-27T22:14:26Z', NULL, 'page_metadata', '2026-10-17T11:49:39Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-page-03451500', 'https://waterdata.usgs.gov/monitoring-location/USGS-03451500/',
 'USGS 03451500 French Broad River at Asheville, NC — monitoring location', 'U.S. Geological Survey', 'web_page',
 'U.S. Public Domain', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:39Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-page-03451000', 'https://waterdata.usgs.gov/monitoring-location/USGS-03451000/',
 'USGS 03451000 Swannanoa River at Biltmore, NC — monitoring location', 'U.S. Geological Survey', 'web_page',
 'U.S. Public Domain', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:39Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-site-file-asheville-gages', 'https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=03451500,03451000&siteOutput=expanded',
 'USGS NWIS site file: 03451500 and 03451000 (expanded)', 'U.S. Geological Survey, National Water Information System', 'dataset',
 'U.S. Public Domain', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:39Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-iv-03451500-00060', 'https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=03451500&parameterCd=00060&startDT=2024-09-20T00:00Z&endDT=2024-10-10T00:00Z',
 'USGS instantaneous values: 03451500 French Broad River at Asheville, NC, discharge (00060), 2024-09-20 to 2024-10-10 UTC',
 'U.S. Geological Survey, National Water Information System', 'dataset', 'U.S. Public Domain',
 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:46:34Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-iv-03451500-00065', 'https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=03451500&parameterCd=00065&startDT=2024-09-20T00:00Z&endDT=2024-10-10T00:00Z',
 'USGS instantaneous values: 03451500 French Broad River at Asheville, NC, gage height (00065), 2024-09-20 to 2024-10-10 UTC',
 'U.S. Geological Survey, National Water Information System', 'dataset', 'U.S. Public Domain',
 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:46:34Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-iv-03451000-00060', 'https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=03451000&parameterCd=00060&startDT=2024-09-20T00:00Z&endDT=2024-10-10T00:00Z',
 'USGS instantaneous values: 03451000 Swannanoa River at Biltmore, NC, discharge (00060), 2024-09-20 to 2024-10-10 UTC',
 'U.S. Geological Survey, National Water Information System', 'dataset', 'U.S. Public Domain',
 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:46:35Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-iv-03451000-00065', 'https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=03451000&parameterCd=00065&startDT=2024-09-20T00:00Z&endDT=2024-10-10T00:00Z',
 'USGS instantaneous values: 03451000 Swannanoa River at Biltmore, NC, gage height (00065), 2024-09-20 to 2024-10-10 UTC',
 'U.S. Geological Survey, National Water Information System', 'dataset', 'U.S. Public Domain',
 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:46:35Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-usgs-peak-03451500', 'https://nwis.waterdata.usgs.gov/nwis/peak?site_no=03451500&agency_cd=USGS&format=rdb',
 'USGS annual peak streamflow: 03451500 French Broad River at Asheville, NC', 'U.S. Geological Survey, National Water Information System',
 'dataset', 'U.S. Public Domain', 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', 'U.S. Geological Survey',
 NULL, NULL, 'unavailable', '2026-10-17T11:46:36Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-census-2020-place-asheville', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/25/query?where=GEOID%3D%273702140%27&outFields=GEOID,NAME,INTPTLAT,INTPTLON&returnGeometry=true&outSR=4326&f=json',
 'Census 2020 TIGERweb incorporated place: Asheville city, NC (GEOID 3702140)', 'U.S. Census Bureau', 'dataset',
 'U.S. Public Domain (federal government work)', NULL, 'Source: U.S. Census Bureau',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:39Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-census-2020-county-buncombe', 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/55/query?where=GEOID%3D%2737021%27&outFields=GEOID,NAME,INTPTLAT,INTPTLON&returnGeometry=true&outSR=4326&f=json',
 'Census 2020 TIGERweb county: Buncombe County, NC (GEOID 37021)', 'U.S. Census Bureau', 'dataset',
 'U.S. Public Domain (federal government work)', NULL, 'Source: U.S. Census Bureau',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:40Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-hls-l30-granule-2024-08-30', 'https://cmr.earthdata.nasa.gov/search/concepts/G3222264591-LPCLOUD.umm_json',
 'HLS.L30.T17SLV.2024243T160534.v2.0 (Landsat 8 OLI, 2024-08-30)', 'NASA LP DAAC', 'imagery',
 'CC0 (EOSDIS data use guidance; no restrictions, citation requested)', 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance',
 'NASA LP DAAC HLS L30 v2.0 (doi:10.5067/HLS/HLSL30.002), imagery via NASA GIBS',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:40Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-hls-l30-granule-2024-10-09', 'https://cmr.earthdata.nasa.gov/search/concepts/G3263842231-LPCLOUD.umm_json',
 'HLS.L30.T17SLV.2024283T160541.v2.0 (Landsat 9 OLI, 2024-10-09)', 'NASA LP DAAC', 'imagery',
 'CC0 (EOSDIS data use guidance; no restrictions, citation requested)', 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance',
 'NASA LP DAAC HLS L30 v2.0 (doi:10.5067/HLS/HLSL30.002), imagery via NASA GIBS',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:40Z', 'reviewed', '2026-10-17T11:49:41Z'),
('src-hls-l30-v2-dataset', 'https://www.earthdata.nasa.gov/data/catalog/lpcloud-hlsl30-2.0',
 'HLS Operational Land Imager Surface Reflectance and TOA Brightness Daily Global 30m v2.0', 'NASA LP DAAC', 'dataset',
 'CC0 (EOSDIS data use guidance; no restrictions, citation requested)', 'https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance',
 'Neigh, C., et al. (2021). HLS Operational Land Imager Surface Reflectance and TOA Brightness Daily Global 30m v2.0. NASA LP DAAC. doi:10.5067/HLS/HLSL30.002',
 NULL, NULL, 'unavailable', '2026-10-17T11:49:41Z', 'reviewed', '2026-10-17T11:49:41Z');

-- Locations: gauge points from the USGS site file (NAD83, 1-second accuracy); city/region extents are the
-- outward-rounded bounding boxes of Census 2020 boundaries, with Census internal points (not event locations).
INSERT INTO atlas.locations (id, name, precision, longitude, latitude, coordinates_basis, bounds_west, bounds_south, bounds_east, bounds_north, bounds_basis, source_id, verification_status, reviewed_at) VALUES
('loc-usgs-03451500', 'USGS 03451500 French Broad River at Asheville, NC', 'facility', -82.5780556, 35.60888889, 'usgs_site_file_nad83',
 NULL, NULL, NULL, NULL, NULL, 'src-usgs-site-file-asheville-gages', 'reviewed', '2026-10-17T11:49:41Z'),
('loc-usgs-03451000', 'USGS 03451000 Swannanoa River at Biltmore, NC', 'facility', -82.5447222, 35.5683333, 'usgs_site_file_nad83',
 NULL, NULL, NULL, NULL, NULL, 'src-usgs-site-file-asheville-gages', 'reviewed', '2026-10-17T11:49:41Z'),
('loc-asheville-nc', 'Asheville, North Carolina', 'city', -82.5527255, 35.5709722, 'census_2020_internal_point',
 -82.67045, 35.41644, -82.46038, 35.65612, 'census_2020_place_boundary_extent', 'src-census-2020-place-asheville', 'reviewed', '2026-10-17T11:49:41Z'),
('loc-buncombe-county-nc', 'Buncombe County, North Carolina', 'region', -82.5304234, 35.6093706, 'census_2020_internal_point',
 -82.88811, 35.41644, -82.16904, 35.82411, 'census_2020_county_boundary_extent', 'src-census-2020-county-buncombe', 'reviewed', '2026-10-17T11:49:41Z');

INSERT INTO atlas.entities (id, name, entity_type, source_id) VALUES
('ent-hurricane-helene-2024', 'Hurricane Helene (2024)', 'event', 'src-nws-gsp-helene-flood-summary'),
('ent-french-broad-river', 'French Broad River', 'waterbody', 'src-usgs-site-file-asheville-gages'),
('ent-swannanoa-river', 'Swannanoa River', 'waterbody', 'src-usgs-site-file-asheville-gages'),
('ent-usgs', 'U.S. Geological Survey', 'government_agency', 'src-usgs-news-helene-streamgages'),
('ent-asheville-water-resources', 'City of Asheville Water Resources Department', 'government_agency', 'src-wlos-boil-water-lifted');

INSERT INTO atlas.themes (id, label) VALUES
('flooding', 'Flooding'), ('drinking-water', 'Drinking water'), ('hurricanes', 'Hurricanes and tropical storms'),
('infrastructure', 'Infrastructure'), ('river-monitoring', 'River monitoring');

-- Articles: curated, reviewed feed records. Title and link only (no publisher excerpts stored).
INSERT INTO atlas.articles (id, source_id, url, title, publisher, excerpt, published_at, published_date, publication_time_basis, event_at, discovered_at, fetched_at, provider, provider_source_id, verification_status, geographic_precision, content_hash, reviewed_at)
SELECT a.id, s.id, s.url, s.title, s.publisher, NULL, s.published_at, s.published_date, s.published_at_basis, NULL, NULL, s.retrieved_at,
  'curated', 'curated-seed-helene-asheville-2024', 'reviewed', a.precision, atlas.article_content_hash(s.title, NULL), '2026-10-17T11:49:41Z'
FROM (VALUES
  ('art-usgs-alert-2024-09-30', 'src-usgs-alert-2024-09-30', 'facility'),
  ('art-usgs-news-helene-streamgages', 'src-usgs-news-helene-streamgages', 'facility'),
  ('art-nws-gsp-helene-flood-summary', 'src-nws-gsp-helene-flood-summary', 'region'),
  ('art-nasa-eo-flash-floods-nc', 'src-nasa-eo-flash-floods-nc', 'region'),
  ('art-foxweather-rad-drone', 'src-foxweather-rad-drone', 'city'),
  ('art-eenews-helene-flood-records', 'src-eenews-helene-flood-records', 'facility'),
  ('art-wlos-first-water-flow', 'src-wlos-first-water-flow', 'region'),
  ('art-wlos-boil-water-lifted', 'src-wlos-boil-water-lifted', 'city'),
  ('art-wbtv-boil-water-lifted', 'src-wbtv-boil-water-lifted', 'city'),
  ('art-wlos-council-recovery-2025', 'src-wlos-council-recovery-2025', 'city')
) AS a (id, source_id, precision)
JOIN atlas.sources s ON s.id = a.source_id;

INSERT INTO atlas.article_discoveries (article_id, provider, provider_source_id, discovered_at, asserted_published_at, publication_time_basis, first_fetched_at, last_fetched_at)
SELECT id, provider, provider_source_id, NULL, published_at, publication_time_basis, fetched_at, fetched_at FROM atlas.articles
WHERE provider_source_id = 'curated-seed-helene-asheville-2024';

INSERT INTO atlas.article_locations (article_id, location_id) VALUES
('art-usgs-alert-2024-09-30', 'loc-usgs-03451500'),
('art-usgs-news-helene-streamgages', 'loc-usgs-03451500'),
('art-nws-gsp-helene-flood-summary', 'loc-buncombe-county-nc'),
('art-nasa-eo-flash-floods-nc', 'loc-buncombe-county-nc'),
('art-nasa-eo-flash-floods-nc', 'loc-asheville-nc'),
('art-foxweather-rad-drone', 'loc-asheville-nc'),
('art-eenews-helene-flood-records', 'loc-usgs-03451500'),
('art-wlos-first-water-flow', 'loc-buncombe-county-nc'),
('art-wlos-boil-water-lifted', 'loc-asheville-nc'),
('art-wbtv-boil-water-lifted', 'loc-asheville-nc'),
('art-wlos-council-recovery-2025', 'loc-asheville-nc');

INSERT INTO atlas.article_themes (article_id, theme_id) VALUES
('art-usgs-alert-2024-09-30', 'flooding'), ('art-usgs-alert-2024-09-30', 'river-monitoring'),
('art-usgs-news-helene-streamgages', 'flooding'), ('art-usgs-news-helene-streamgages', 'river-monitoring'), ('art-usgs-news-helene-streamgages', 'hurricanes'),
('art-nws-gsp-helene-flood-summary', 'flooding'), ('art-nws-gsp-helene-flood-summary', 'hurricanes'),
('art-nasa-eo-flash-floods-nc', 'flooding'), ('art-nasa-eo-flash-floods-nc', 'hurricanes'), ('art-nasa-eo-flash-floods-nc', 'drinking-water'),
('art-foxweather-rad-drone', 'flooding'),
('art-eenews-helene-flood-records', 'flooding'), ('art-eenews-helene-flood-records', 'river-monitoring'),
('art-wlos-first-water-flow', 'drinking-water'), ('art-wlos-first-water-flow', 'infrastructure'),
('art-wlos-boil-water-lifted', 'drinking-water'),
('art-wbtv-boil-water-lifted', 'drinking-water'),
('art-wlos-council-recovery-2025', 'drinking-water'), ('art-wlos-council-recovery-2025', 'infrastructure');

INSERT INTO atlas.article_entities (article_id, entity_id) VALUES
('art-usgs-alert-2024-09-30', 'ent-usgs'), ('art-usgs-alert-2024-09-30', 'ent-french-broad-river'), ('art-usgs-alert-2024-09-30', 'ent-hurricane-helene-2024'),
('art-usgs-news-helene-streamgages', 'ent-usgs'), ('art-usgs-news-helene-streamgages', 'ent-french-broad-river'), ('art-usgs-news-helene-streamgages', 'ent-hurricane-helene-2024'),
('art-nws-gsp-helene-flood-summary', 'ent-hurricane-helene-2024'), ('art-nws-gsp-helene-flood-summary', 'ent-french-broad-river'), ('art-nws-gsp-helene-flood-summary', 'ent-swannanoa-river'),
('art-nasa-eo-flash-floods-nc', 'ent-hurricane-helene-2024'), ('art-nasa-eo-flash-floods-nc', 'ent-french-broad-river'), ('art-nasa-eo-flash-floods-nc', 'ent-swannanoa-river'),
('art-foxweather-rad-drone', 'ent-french-broad-river'), ('art-foxweather-rad-drone', 'ent-hurricane-helene-2024'),
('art-eenews-helene-flood-records', 'ent-usgs'), ('art-eenews-helene-flood-records', 'ent-french-broad-river'), ('art-eenews-helene-flood-records', 'ent-hurricane-helene-2024'),
('art-wlos-first-water-flow', 'ent-asheville-water-resources'), ('art-wlos-first-water-flow', 'ent-hurricane-helene-2024'),
('art-wlos-boil-water-lifted', 'ent-asheville-water-resources'), ('art-wlos-boil-water-lifted', 'ent-hurricane-helene-2024'),
('art-wbtv-boil-water-lifted', 'ent-asheville-water-resources'), ('art-wbtv-boil-water-lifted', 'ent-hurricane-helene-2024'),
('art-wlos-council-recovery-2025', 'ent-asheville-water-resources'), ('art-wlos-council-recovery-2025', 'ent-hurricane-helene-2024');

-- Observation series (values are loaded from observations.csv by load.sql) --------------------------------------
INSERT INTO atlas.observation_series (id, location_id, metric, unit, statistic, expected_interval, source_id, provider_series_ref, description, missing_data_rule, license, attribution, coverage_from, coverage_to, retrieved_at) VALUES
('usgs-03451500-discharge', 'loc-usgs-03451500', 'discharge', 'ft3/s', 'instantaneous', INTERVAL '15 minutes', 'src-usgs-iv-03451500-00060', 'USGS:03451500:00060:00000',
 'Instantaneous streamflow (discharge) of the French Broad River at Asheville, NC, USGS parameter 00060, 15-minute readings.',
 'Gaps are missing rows (never interpolated). Provider no-data (-999999) would be stored as NULL. Qualifiers: A approved, e estimated.',
 'U.S. Public Domain', 'U.S. Geological Survey, National Water Information System', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', '2026-10-17T11:46:34Z'),
('usgs-03451500-gage-height', 'loc-usgs-03451500', 'gage_height', 'ft', 'instantaneous', INTERVAL '15 minutes', 'src-usgs-iv-03451500-00065', 'USGS:03451500:00065:00000',
 'Instantaneous gage height (stage above the gage datum) of the French Broad River at Asheville, NC, USGS parameter 00065, 15-minute readings.',
 'Gaps are missing rows (never interpolated). Provider no-data (-999999) would be stored as NULL. Stage is relative to the gage datum, not depth or elevation.',
 'U.S. Public Domain', 'U.S. Geological Survey, National Water Information System', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', '2026-10-17T11:46:34Z'),
('usgs-03451000-discharge', 'loc-usgs-03451000', 'discharge', 'ft3/s', 'instantaneous', INTERVAL '15 minutes', 'src-usgs-iv-03451000-00060', 'USGS:03451000:00060:00000',
 'Instantaneous streamflow (discharge) of the Swannanoa River at Biltmore, NC, USGS parameter 00060, 15-minute readings.',
 'Gaps are missing rows (never interpolated); the flood period has multi-hour gaps. Qualifier e marks USGS-estimated values.',
 'U.S. Public Domain', 'U.S. Geological Survey, National Water Information System', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', '2026-10-17T11:46:35Z'),
('usgs-03451000-gage-height', 'loc-usgs-03451000', 'gage_height', 'ft', 'instantaneous', INTERVAL '15 minutes', 'src-usgs-iv-03451000-00065', 'USGS:03451000:00065:00000',
 'Instantaneous gage height of the Swannanoa River at Biltmore, NC, USGS parameter 00065, 15-minute readings.',
 'Gaps are missing rows (never interpolated). Readings are missing 17:15–19:00Z and 19:00–21:30Z on 2024-09-27 and from 2024-09-28T02:30Z to 2024-09-29T19:30Z.',
 'U.S. Public Domain', 'U.S. Geological Survey, National Water Information System', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', '2026-10-17T11:46:35Z'),
('usgs-03451500-annual-peak-discharge', 'loc-usgs-03451500', 'annual_peak_discharge', 'ft3/s', 'annual_peak', NULL, 'src-usgs-peak-03451500', 'USGS peak file 03451500 (peak_va)',
 'Annual peak streamflow per USGS water year (October 1 to September 30) for the French Broad River at Asheville, NC.',
 'One row per water year with a published discharge; years without one are absent. Peak dates/times are local standard time (EST); rows without a time have time_precision day. Qualifiers are USGS peak codes (e.g. 9 = due to hurricane).',
 'U.S. Public Domain', 'U.S. Geological Survey, National Water Information System', '1895-10-01T05:00:00Z', '2025-10-01T05:00:00Z', '2026-10-17T11:46:36Z');

-- Evidence -------------------------------------------------------------------------------------------------------
INSERT INTO atlas.evidence (id, evidence_type, title, description, limitations, source_id, observed_from, observed_to, location_id, series_id) VALUES
('ev-usgs-03451500-discharge', 'observation_series', 'French Broad River at Asheville: 15-minute discharge, September 20 to October 10, 2024',
 'Approved USGS instantaneous discharge. The series rises from 1,190 ft3/s at 2024-09-20T00:00Z to a crest of 113,000 ft3/s at 2024-09-27T21:38Z (17:38 EDT), then recedes.',
 'Discharge is computed by USGS from stage and may still be revised. The record has one missing 15-minute reading (2024-09-28T20:30Z) and one extra crest reading at 21:38Z; gaps are not interpolated.',
 'src-usgs-iv-03451500-00060', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', 'loc-usgs-03451500', 'usgs-03451500-discharge'),
('ev-usgs-03451500-gage-height', 'observation_series', 'French Broad River at Asheville: 15-minute gage height, September 20 to October 10, 2024',
 'Approved USGS instantaneous gage height. It reads 24.67 ft at 2024-09-27T21:30Z (17:30 EDT) and peaks at 24.82 ft at 21:38Z (17:38 EDT).',
 'Gage height is stage above the gage datum, not water depth or flood extent. It cannot be compared directly with 1916 because the gage datum changed that year (USGS peak code 6).',
 'src-usgs-iv-03451500-00065', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', 'loc-usgs-03451500', 'usgs-03451500-gage-height'),
('ev-usgs-03451500-annual-peaks', 'observation_series', 'French Broad River at Asheville: annual peak discharge, water years 1896 to 2025',
 'USGS annual peak streamflow file (130 water years with a discharge). The 2024 peak of 113,000 ft3/s exceeds the July 1916 peak of 110,000 ft3/s, the largest previously listed.',
 'Annual peaks summarize one value per water year; older entries lack a time of day. Peak discharges at extreme floods carry larger uncertainty than routine flows.',
 'src-usgs-peak-03451500', '1895-10-01T05:00:00Z', '2025-10-01T05:00:00Z', 'loc-usgs-03451500', 'usgs-03451500-annual-peak-discharge'),
('ev-usgs-03451000-gage-height', 'observation_series', 'Swannanoa River at Biltmore: 15-minute gage height, September 20 to October 10, 2024',
 'Approved USGS instantaneous gage height. The highest stored reading is 27.33 ft at 2024-09-27T19:00Z (15:00 EDT).',
 'Readings are missing before (17:15Z to 19:00Z) and after (19:00Z to 21:30Z) the highest stored value, and from 2024-09-28T02:30Z to 2024-09-29T19:30Z. The true crest may differ; Atlas does not claim one.',
 'src-usgs-iv-03451000-00065', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', 'loc-usgs-03451000', 'usgs-03451000-gage-height'),
('ev-usgs-03451000-discharge', 'observation_series', 'Swannanoa River at Biltmore: 15-minute discharge, September 20 to October 10, 2024',
 'Approved USGS instantaneous discharge, including USGS-estimated values during and after the flood.',
 'Values flagged e are estimates. Readings are missing for multi-hour periods on September 27 to 29, 2024; no crest discharge is claimed.',
 'src-usgs-iv-03451000-00060', '2024-09-20T00:00:00Z', '2024-10-10T00:00:00Z', 'loc-usgs-03451000', 'usgs-03451000-discharge'),
('ev-nws-gsp-helene-flood-summary', 'report', 'NWS Greenville-Spartanburg summary of the September 26–27, 2024 flash flood event',
 'Official NWS event summary describing the predecessor rain, Helene''s rainbands, record crests, and impacts across the western Carolinas and northeast Georgia.',
 'Regional summary; it does not give a publication date on the page. Rainfall and impact figures are as reported by NWS and are not stored in Atlas.',
 'src-nws-gsp-helene-flood-summary', NULL, NULL, 'loc-buncombe-county-nc', NULL),
('ev-usgs-alert-2024-09-30', 'report', 'USGS project alert (September 30, 2024): provisional peak at French Broad River at Asheville',
 'Early USGS field report giving a provisional peak gage height of 24.67 ft at 5:30 PM on September 27, 2024 and noting that the 1916 record was 23.10 ft.',
 'Provisional; the approved record now lists a later crest reading of 24.82 ft at 17:38 EDT. The 1916 stage was measured on a different gage datum.',
 'src-usgs-alert-2024-09-30', NULL, NULL, 'loc-usgs-03451500', NULL);

-- Dated satellite evidence: aligned HLS L30 before/after pair (same MGRS tile 17SLV, same 30 m grid, same request bounds).
INSERT INTO atlas.evidence (id, evidence_type, title, description, limitations, source_id, observed_from, observed_to, location_id,
  bounds_west, bounds_south, bounds_east, bounds_north, asset_path, layer_ref, legend, attribution, license, resolution_m, comparison_group, comparison_role) VALUES
('ev-hls-l30-asheville-2024-08-30', 'imagery', 'Asheville rivers before Helene: Landsat 8 (HLS L30), August 30, 2024',
 'Natural-colour Harmonized Landsat Sentinel-2 reflectance over the French Broad River, its confluence with the Swannanoa River, and central Asheville, 28 days before the flood. Rivers sit within their channels.',
 'About 30 m pixels (asset resampled to about 15 m display pixels): individual buildings and damage cannot be identified, and no building or parcel recognition is possible. Granule tile cloud cover is 17%; the cropped area is clear apart from a few masked pixels. This is not the Mapbox basemap.',
 'src-hls-l30-granule-2024-08-30', '2024-08-30T16:05:34.646Z', '2024-08-30T16:05:58.537Z', 'loc-asheville-nc',
 -82.62, 35.54, -82.52, 35.62, 'assets/evidence/helene-asheville-2024/hls-l30-2024-08-30-before.png',
 'NASA GIBS WMS layer HLS_L30_Nadir_BRDF_Adjusted_Reflectance, TIME=2024-08-30, EPSG:4326',
 'Natural-colour surface reflectance (GIBS default rendering). Green: vegetation. Grey/white: roads, roofs and paved areas. Dark green-brown ribbons: rivers. Transparent: masked or no-data pixels.',
 'NASA LP DAAC HLS L30 v2.0 (doi:10.5067/HLS/HLSL30.002); Landsat 8 courtesy of NASA/USGS; imagery via NASA GIBS',
 'CC0 (EOSDIS data use guidance)', 30, 'helene-asheville-hls-l30', 'before'),
('ev-hls-l30-asheville-2024-10-09', 'imagery', 'Asheville rivers after Helene: Landsat 9 (HLS L30), October 9, 2024',
 'Natural-colour Harmonized Landsat Sentinel-2 reflectance on the same grid and bounds as the August 30 image, 12 days after the crest. Broad tan-brown bands line the French Broad and Swannanoa rivers and cover floodplain fields south-west of the confluence, where the August image shows green vegetation.',
 'Taken 12 days after the crest, so it shows deposits and scoured ground left behind, not the peak flood extent. About 30 m pixels: it cannot show individual building damage, depths, or ownership. Colour change alone does not quantify damage. A few small bright spots may be cloud; about 0.1% of pixels are masked.',
 'src-hls-l30-granule-2024-10-09', '2024-10-09T16:05:41.056Z', '2024-10-09T16:06:04.951Z', 'loc-asheville-nc',
 -82.62, 35.54, -82.52, 35.62, 'assets/evidence/helene-asheville-2024/hls-l30-2024-10-09-after.png',
 'NASA GIBS WMS layer HLS_L30_Nadir_BRDF_Adjusted_Reflectance, TIME=2024-10-09, EPSG:4326',
 'Natural-colour surface reflectance (GIBS default rendering). Tan/brown along river corridors: bare sediment or scoured ground not present on August 30. Green: vegetation. Grey/white: roads, roofs and paved areas. Transparent: masked or no-data pixels.',
 'NASA LP DAAC HLS L30 v2.0 (doi:10.5067/HLS/HLSL30.002); Landsat 9 courtesy of NASA/USGS; imagery via NASA GIBS',
 'CC0 (EOSDIS data use guidance)', 30, 'helene-asheville-hls-l30', 'after');

INSERT INTO atlas.evidence_sources (evidence_id, source_id)
SELECT id, source_id FROM atlas.evidence
UNION ALL VALUES
('ev-hls-l30-asheville-2024-08-30', 'src-hls-l30-v2-dataset'),
('ev-hls-l30-asheville-2024-10-09', 'src-hls-l30-v2-dataset'),
('ev-usgs-03451500-discharge', 'src-usgs-page-03451500'),
('ev-usgs-03451000-gage-height', 'src-usgs-page-03451000');

-- Investigation ---------------------------------------------------------------------------------------------------
INSERT INTO atlas.investigations (id, title, summary, primary_location_id, event_start_date, event_end_date, event_timezone, content_status, verification_status, reviewed_at) VALUES
('inv-helene-asheville-2024', 'Hurricane Helene''s record French Broad River flood in Asheville, NC (September 2024)',
 'On September 27, 2024, rain from Hurricane Helene fell on mountains already saturated by heavy rain on September 25–26 and sent the French Broad and Swannanoa rivers to record levels in and around Asheville, North Carolina. Approved USGS data for the French Broad River at Asheville show a crest of 113,000 cubic feet per second and 24.82 feet at 5:38 PM EDT, above the 1916 flood''s 110,000 cubic feet per second. Official accounts and local reporting describe destruction in part of the River Arts District, deaths and destroyed homes along the Swannanoa River, and a water outage for many city customers after flooding damaged transmission mains from the North Fork Water Treatment Plant; a boil-water advisory stayed in place until November 18, 2024. Each statement below links to its source, and measurements, reported effects and open questions are kept separate.',
 'loc-asheville-nc', '2024-09-25', '2024-09-27', 'America/New_York', 'curated_seed', 'reviewed', '2026-10-17T11:49:41Z');

INSERT INTO atlas.investigation_items (id, investigation_id, kind, position, text, exposure_basis) VALUES
('item-helene-wh-0', 'inv-helene-asheville-2024', 'what_happened', 0, 'A band of heavy rain on September 25–26, 2024 was followed early on September 27 by Helene''s tropical rainbands over the already-saturated mountains, producing record, catastrophic flash flooding across western North Carolina.', NULL),
('item-helene-wh-1', 'inv-helene-asheville-2024', 'what_happened', 1, 'The USGS streamgage on the French Broad River at Asheville (03451500) recorded a crest of 113,000 ft³/s and a gage height of 24.82 ft at 17:38 EDT (21:38 UTC) on September 27, 2024, in approved USGS data. Flow was 1,190 ft³/s on September 20.', NULL),
('item-helene-wh-2', 'inv-helene-asheville-2024', 'what_happened', 2, 'In the USGS annual peak-flow record for this gage, the 2024 peak discharge of 113,000 ft³/s exceeds the July 1916 peak of 110,000 ft³/s, previously the largest listed.', NULL),
('item-helene-wh-3', 'inv-helene-asheville-2024', 'what_happened', 3, 'Early USGS reports (September 30 and October 4, 2024) gave a provisional peak gage height of 24.67 ft, the figure repeated in news coverage. The approved series contains 24.67 ft at 17:30 EDT and a separate crest reading of 24.82 ft at 17:38 EDT.', NULL),
('item-helene-pi-0', 'inv-helene-asheville-2024', 'public_impact', 0, 'The National Weather Service reports that French Broad River flooding destroyed a portion of Asheville''s River Arts District; drone video published September 30 showed water up to the roofs of some buildings there.', NULL),
('item-helene-pi-1', 'inv-helene-asheville-2024', 'public_impact', 1, 'Along the Swannanoa River, from Black Mountain downstream to Asheville, the National Weather Service reports that dozens of people were killed and hundreds of structures destroyed.', NULL),
('item-helene-pi-2', 'inv-helene-asheville-2024', 'public_impact', 2, 'Flooding damaged key water mains and transmission lines to the North Fork Water Treatment Plant. A 2025 city staff report, as reported by WLOS, said many customers were without water for 14 days until the transmission mains were repaired.', NULL),
('item-helene-pi-3', 'inv-helene-asheville-2024', 'public_impact', 3, 'On October 12, 2024, Buncombe County officials said a city crew had activated a 36-inch bypass from the North Fork reservoir, letting water flow through Asheville''s pipes for the first time since September 26. The water carried sediment and a boil-water notice remained in effect.', NULL),
('item-helene-pi-4', 'inv-helene-asheville-2024', 'public_impact', 4, 'Asheville lifted its boil-water advisory on November 18, 2024 after sampling found no E. coli or coliform. Officials said customers with plumbing installed before 1988 should keep flushing cold water before drinking it.', NULL),
('item-helene-pi-5', 'inv-helene-asheville-2024', 'public_impact', 5, 'NASA Earth Observatory, citing PowerOutage.us, reported that 50 percent of power customers in Buncombe County were still without power on October 4, 2024.', NULL),
('item-helene-res-0', 'inv-helene-asheville-2024', 'resource', 0, 'USGS monitoring location page for the French Broad River at Asheville (03451500), with current and historical gage data.', NULL),
('item-helene-res-1', 'inv-helene-asheville-2024', 'resource', 1, 'USGS monitoring location page for the Swannanoa River at Biltmore (03451000).', NULL),
('item-helene-res-2', 'inv-helene-asheville-2024', 'resource', 2, 'National Weather Service Greenville-Spartanburg event summary, with a reports map and a table of record crests across the western Carolinas.', NULL),
('item-helene-q-0', 'inv-helene-asheville-2024', 'research_question', 0, 'Research suggestion: what was the true crest on the Swannanoa River at Biltmore? The approved 15-minute record has gaps on both sides of its highest stored reading (27.33 ft at 15:00 EDT), and NASA Earth Observatory reported 26.1 ft.', NULL),
('item-helene-q-1', 'inv-helene-asheville-2024', 'research_question', 1, 'Research suggestion: how would the planned North Fork Transmission Main No. 3, routed at a higher elevation away from the river corridor, change the water system''s exposure to flooding compared with the mains damaged in 2024?', NULL),
('item-helene-q-2', 'inv-helene-asheville-2024', 'research_question', 2, 'Research suggestion: the city staff report also cites a week-long outage in 2004 after Tropical Storms Frances and Ivan. Which failure points recurred in 2024?', NULL),
('item-helene-q-3', 'inv-helene-asheville-2024', 'research_question', 3, 'Research suggestion: USGS said provisional records would be verified or revised and that the count of new flood records would likely increase. How many records were confirmed at other western North Carolina gages?', NULL),
('item-helene-u-0', 'inv-helene-asheville-2024', 'uncertainty', 0, 'Gage heights are not directly comparable with 1916: the USGS peak file flags 1916 with code 6 (gage datum changed during the year). Atlas compares discharge, not stage, across those years.', NULL),
('item-helene-u-1', 'inv-helene-asheville-2024', 'uncertainty', 1, 'Figures in early reporting were provisional; USGS said they would be verified or revised.', NULL),
('item-helene-u-2', 'inv-helene-asheville-2024', 'uncertainty', 2, 'The Swannanoa River gage record has USGS-estimated discharge values and multi-hour gaps during the flood. Atlas does not interpolate missing readings.', NULL),
('item-helene-u-3', 'inv-helene-asheville-2024', 'uncertainty', 3, 'The after image was acquired on October 9, 2024, 12 days after the crest. At about 30 m resolution it shows deposits and scoured ground, not the peak flood extent or damage to individual buildings.', NULL),
('item-helene-u-4', 'inv-helene-asheville-2024', 'uncertainty', 4, 'The weather station at Asheville Regional Airport stopped working on the morning of September 27 after recording nearly 14 inches of rain, so it has no complete storm total. Atlas stores no rainfall series.', NULL),
('item-helene-u-5', 'inv-helene-asheville-2024', 'uncertainty', 5, 'Atlas records no company relationships for this investigation, so no business exposure is claimed.', NULL);

INSERT INTO atlas.investigation_item_sources (item_id, source_id) VALUES
('item-helene-wh-0', 'src-nws-gsp-helene-flood-summary'), ('item-helene-wh-0', 'src-nasa-eo-flash-floods-nc'),
('item-helene-wh-1', 'src-usgs-iv-03451500-00060'), ('item-helene-wh-1', 'src-usgs-iv-03451500-00065'),
('item-helene-wh-2', 'src-usgs-peak-03451500'),
('item-helene-wh-3', 'src-usgs-alert-2024-09-30'), ('item-helene-wh-3', 'src-usgs-news-helene-streamgages'), ('item-helene-wh-3', 'src-usgs-iv-03451500-00065'),
('item-helene-pi-0', 'src-nws-gsp-helene-flood-summary'), ('item-helene-pi-0', 'src-foxweather-rad-drone'),
('item-helene-pi-1', 'src-nws-gsp-helene-flood-summary'),
('item-helene-pi-2', 'src-nasa-eo-flash-floods-nc'), ('item-helene-pi-2', 'src-wlos-council-recovery-2025'),
('item-helene-pi-3', 'src-wlos-first-water-flow'),
('item-helene-pi-4', 'src-wlos-boil-water-lifted'), ('item-helene-pi-4', 'src-wbtv-boil-water-lifted'),
('item-helene-pi-5', 'src-nasa-eo-flash-floods-nc'),
('item-helene-res-0', 'src-usgs-page-03451500'),
('item-helene-res-1', 'src-usgs-page-03451000'),
('item-helene-res-2', 'src-nws-gsp-helene-flood-summary'),
('item-helene-q-0', 'src-usgs-iv-03451000-00065'), ('item-helene-q-0', 'src-nasa-eo-flash-floods-nc'),
('item-helene-q-1', 'src-wlos-council-recovery-2025'),
('item-helene-q-2', 'src-wlos-council-recovery-2025'),
('item-helene-q-3', 'src-usgs-news-helene-streamgages'),
('item-helene-u-0', 'src-usgs-peak-03451500'),
('item-helene-u-1', 'src-usgs-news-helene-streamgages'),
('item-helene-u-2', 'src-usgs-iv-03451000-00060'),
('item-helene-u-3', 'src-hls-l30-granule-2024-10-09'),
('item-helene-u-4', 'src-nasa-eo-flash-floods-nc');

INSERT INTO atlas.investigation_articles (investigation_id, article_id, position) VALUES
('inv-helene-asheville-2024', 'art-nws-gsp-helene-flood-summary', 0),
('inv-helene-asheville-2024', 'art-usgs-alert-2024-09-30', 1),
('inv-helene-asheville-2024', 'art-usgs-news-helene-streamgages', 2),
('inv-helene-asheville-2024', 'art-nasa-eo-flash-floods-nc', 3),
('inv-helene-asheville-2024', 'art-foxweather-rad-drone', 4),
('inv-helene-asheville-2024', 'art-eenews-helene-flood-records', 5),
('inv-helene-asheville-2024', 'art-wlos-first-water-flow', 6),
('inv-helene-asheville-2024', 'art-wlos-boil-water-lifted', 7),
('inv-helene-asheville-2024', 'art-wbtv-boil-water-lifted', 8),
('inv-helene-asheville-2024', 'art-wlos-council-recovery-2025', 9);

INSERT INTO atlas.investigation_locations (investigation_id, location_id, position) VALUES
('inv-helene-asheville-2024', 'loc-asheville-nc', 0),
('inv-helene-asheville-2024', 'loc-usgs-03451500', 1),
('inv-helene-asheville-2024', 'loc-usgs-03451000', 2),
('inv-helene-asheville-2024', 'loc-buncombe-county-nc', 3);

INSERT INTO atlas.investigation_evidence (investigation_id, evidence_id, position) VALUES
('inv-helene-asheville-2024', 'ev-usgs-03451500-discharge', 0),
('inv-helene-asheville-2024', 'ev-usgs-03451500-annual-peaks', 1),
('inv-helene-asheville-2024', 'ev-hls-l30-asheville-2024-08-30', 2),
('inv-helene-asheville-2024', 'ev-hls-l30-asheville-2024-10-09', 3),
('inv-helene-asheville-2024', 'ev-usgs-03451500-gage-height', 4),
('inv-helene-asheville-2024', 'ev-usgs-03451000-gage-height', 5),
('inv-helene-asheville-2024', 'ev-usgs-03451000-discharge', 6),
('inv-helene-asheville-2024', 'ev-nws-gsp-helene-flood-summary', 7),
('inv-helene-asheville-2024', 'ev-usgs-alert-2024-09-30', 8);

INSERT INTO atlas.investigation_series (investigation_id, series_id, position) VALUES
('inv-helene-asheville-2024', 'usgs-03451500-discharge', 0),
('inv-helene-asheville-2024', 'usgs-03451500-gage-height', 1),
('inv-helene-asheville-2024', 'usgs-03451500-annual-peak-discharge', 2),
('inv-helene-asheville-2024', 'usgs-03451000-discharge', 3),
('inv-helene-asheville-2024', 'usgs-03451000-gage-height', 4);

-- Key observations referenced by the brief (load.sql verifies that each one exists after the CSV load).
INSERT INTO atlas.investigation_observations (investigation_id, series_id, observed_at, role, position) VALUES
('inv-helene-asheville-2024', 'usgs-03451500-discharge', '2024-09-20T00:00:00Z', 'pre-storm reading', 0),
('inv-helene-asheville-2024', 'usgs-03451500-discharge', '2024-09-27T21:38:00Z', 'crest', 1),
('inv-helene-asheville-2024', 'usgs-03451500-gage-height', '2024-09-27T21:30:00Z', 'reading matching the provisional 24.67 ft report', 2),
('inv-helene-asheville-2024', 'usgs-03451500-gage-height', '2024-09-27T21:38:00Z', 'crest', 3),
('inv-helene-asheville-2024', 'usgs-03451500-annual-peak-discharge', '1916-07-16T05:00:00Z', 'previous largest annual peak (water year 1916)', 4),
('inv-helene-asheville-2024', 'usgs-03451500-annual-peak-discharge', '2024-09-27T21:38:00Z', 'annual peak, water year 2024', 5),
('inv-helene-asheville-2024', 'usgs-03451000-gage-height', '2024-09-27T19:00:00Z', 'highest stored reading (gaps on both sides)', 6);

-- Embeddable text: stored article titles (no excerpts) and Atlas-authored, source-linked brief items.
INSERT INTO atlas.text_chunks (source_id, chunk_id, article_id, text, embedding_permitted, permission_basis, content_hash)
SELECT source_id, 'article-text', id, title, true, 'stored article title; no publisher excerpt stored', '' FROM atlas.articles
WHERE provider_source_id = 'curated-seed-helene-asheville-2024';

INSERT INTO atlas.text_chunks (source_id, chunk_id, investigation_id, text, embedding_permitted, permission_basis, content_hash)
SELECT DISTINCT ON (i.id) s.source_id, i.id, i.investigation_id, i.text, true, 'Atlas-authored investigation passage', ''
FROM atlas.investigation_items i JOIN atlas.investigation_item_sources s ON s.item_id = i.id
WHERE i.investigation_id = 'inv-helene-asheville-2024'
ORDER BY i.id, s.source_id;
