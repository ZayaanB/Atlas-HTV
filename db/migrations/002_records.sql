-- 002_records — Person 4. Relational research records: sources, locations, entities, themes, articles,
-- investigations, evidence, their link tables, and news-ingestion refresh state.
-- Conventions (see db/README.md): stable text IDs; timestamptz stored and returned as UTC; explicit NULL for
-- unknown values (never 0 or ''); longitude before latitude; bounds are [west, south, east, north] in WGS84
-- degrees and never cross the antimeridian; every citation-bearing record carries source_id.
BEGIN;

-- Original evidence records (citation targets): a publisher article, a government report, a dataset, or an
-- imagery granule/product. Provider catalogs (GDELT, a feed) are NOT sources; provider provenance lives in
-- atlas.article_discoveries.
CREATE TABLE atlas.sources (
  id                  text PRIMARY KEY CHECK (atlas.valid_id(id)),
  url                 text NOT NULL UNIQUE CHECK (url ~ '^https://[^/@\s]+(/|$)' AND length(url) <= 2048),
  title               text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 1000),
  publisher           text NOT NULL CHECK (btrim(publisher) <> '' AND length(publisher) <= 300),
  source_type         text NOT NULL CHECK (source_type IN ('news_article', 'government_report', 'dataset', 'imagery', 'web_page')),
  license             text CHECK (license IS NULL OR btrim(license) <> ''),
  license_url         text CHECK (license_url IS NULL OR license_url ~ '^https://'),
  attribution         text CHECK (attribution IS NULL OR btrim(attribution) <> ''),
  published_at        timestamptz,
  -- Date-only publications keep published_at NULL and record the calendar date here (publisher's local date).
  published_date      date,
  published_at_basis  text NOT NULL CHECK (published_at_basis IN ('page_metadata', 'document_text', 'feed_asserted', 'date_only', 'unavailable')),
  retrieved_at        timestamptz,
  verification_status text NOT NULL DEFAULT 'unreviewed' CHECK (verification_status IN ('unreviewed', 'reviewed')),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((verification_status = 'reviewed') = (reviewed_at IS NOT NULL)),
  CHECK (published_at_basis <> 'date_only' OR (published_at IS NULL AND published_date IS NOT NULL)),
  CHECK (published_at_basis <> 'unavailable' OR (published_at IS NULL AND published_date IS NULL))
);

CREATE TABLE atlas.locations (
  id                  text PRIMARY KEY CHECK (atlas.valid_id(id)),
  name                text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 300),
  precision           text NOT NULL CHECK (precision IN ('address', 'facility', 'city', 'region')),
  longitude           double precision CHECK (longitude BETWEEN -180 AND 180),
  latitude            double precision CHECK (latitude BETWEEN -90 AND 90),
  -- Where the point comes from, e.g. 'usgs_site_file_nad83' or 'census_internal_point'. Required with a point.
  coordinates_basis   text,
  bounds_west         double precision CHECK (bounds_west BETWEEN -180 AND 180),
  bounds_south        double precision CHECK (bounds_south BETWEEN -90 AND 90),
  bounds_east         double precision CHECK (bounds_east BETWEEN -180 AND 180),
  bounds_north        double precision CHECK (bounds_north BETWEEN -90 AND 90),
  bounds_basis        text,
  source_id           text REFERENCES atlas.sources (id),
  verification_status text NOT NULL DEFAULT 'unreviewed' CHECK (verification_status IN ('unreviewed', 'reviewed')),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((longitude IS NULL) = (latitude IS NULL)),
  CHECK ((longitude IS NULL) = (coordinates_basis IS NULL)),
  CHECK (num_nulls(bounds_west, bounds_south, bounds_east, bounds_north) IN (0, 4)),
  CHECK ((bounds_west IS NULL) = (bounds_basis IS NULL)),
  CHECK (bounds_west IS NULL OR (bounds_west <= bounds_east AND bounds_south <= bounds_north)),
  -- Broad places need their geometry; point-precision places need a point. No invented pins.
  CHECK (precision NOT IN ('city', 'region') OR bounds_west IS NOT NULL),
  CHECK (precision NOT IN ('address', 'facility') OR longitude IS NOT NULL),
  CHECK ((verification_status = 'reviewed') = (reviewed_at IS NOT NULL))
);

CREATE TABLE atlas.entities (
  id          text PRIMARY KEY CHECK (atlas.valid_id(id)),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  entity_type text NOT NULL CHECK (entity_type IN ('government_agency', 'organization', 'company', 'infrastructure', 'waterbody', 'event')),
  source_id   text NOT NULL REFERENCES atlas.sources (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Controlled theme vocabulary so filters cannot drift into free text.
CREATE TABLE atlas.themes (
  id    text PRIMARY KEY CHECK (atlas.valid_id(id)),
  label text NOT NULL
);

CREATE TABLE atlas.articles (
  id                     text PRIMARY KEY CHECK (atlas.valid_id(id)),
  source_id              text NOT NULL REFERENCES atlas.sources (id),
  url                    text NOT NULL UNIQUE CHECK (url ~ '^https://[^/@\s]+(/|$)' AND length(url) <= 2048),
  title                  text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 1000),
  publisher              text NOT NULL CHECK (btrim(publisher) <> ''),
  -- Only a provider/publisher excerpt whose storage is permitted. Never an Atlas-written summary.
  excerpt                text CHECK (excerpt IS NULL OR (btrim(excerpt) <> '' AND length(excerpt) <= 500)),
  published_at           timestamptz,
  published_date         date,
  publication_time_basis text NOT NULL CHECK (publication_time_basis IN ('feed_asserted', 'page_metadata', 'document_text', 'date_only', 'unavailable')),
  -- When the reported event happened. NULL unless an exact instant is sourced; investigations carry event periods.
  event_at               timestamptz,
  -- GDELT seendate (provider discovery). Never substituted for publication.
  discovered_at          timestamptz,
  fetched_at             timestamptz NOT NULL,
  provider               text NOT NULL CHECK (provider IN ('gdelt', 'rss', 'curated')),
  provider_source_id     text NOT NULL,
  verification_status    text NOT NULL DEFAULT 'unreviewed' CHECK (verification_status IN ('unreviewed', 'reviewed')),
  geographic_precision   text CHECK (geographic_precision IN ('address', 'facility', 'city', 'region')),
  content_hash           text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((verification_status = 'reviewed') = (reviewed_at IS NOT NULL)),
  CHECK (publication_time_basis <> 'date_only' OR (published_at IS NULL AND published_date IS NOT NULL)),
  CHECK (publication_time_basis <> 'unavailable' OR (published_at IS NULL AND published_date IS NULL)),
  CHECK (publication_time_basis NOT IN ('feed_asserted', 'page_metadata', 'document_text') OR published_at IS NOT NULL)
);
CREATE INDEX articles_published_order_idx ON atlas.articles (published_at DESC NULLS LAST, id);

-- Every provider/feed that discovered a URL, kept separately so a second discovery never rewrites the first.
CREATE TABLE atlas.article_discoveries (
  article_id             text NOT NULL REFERENCES atlas.articles (id) ON DELETE CASCADE,
  provider               text NOT NULL CHECK (provider IN ('gdelt', 'rss', 'curated')),
  provider_source_id     text NOT NULL,
  discovered_at          timestamptz,
  asserted_published_at  timestamptz,
  publication_time_basis text NOT NULL,
  first_fetched_at       timestamptz NOT NULL,
  last_fetched_at        timestamptz NOT NULL,
  PRIMARY KEY (article_id, provider_source_id)
);

-- Reviewed links only. Imports never write these (query configuration is not proof of place/theme/entity).
CREATE TABLE atlas.article_locations (
  article_id  text NOT NULL REFERENCES atlas.articles (id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES atlas.locations (id),
  PRIMARY KEY (article_id, location_id)
);
CREATE INDEX article_locations_location_idx ON atlas.article_locations (location_id);

CREATE TABLE atlas.article_entities (
  article_id text NOT NULL REFERENCES atlas.articles (id) ON DELETE CASCADE,
  entity_id  text NOT NULL REFERENCES atlas.entities (id),
  PRIMARY KEY (article_id, entity_id)
);
CREATE INDEX article_entities_entity_idx ON atlas.article_entities (entity_id);

CREATE TABLE atlas.article_themes (
  article_id text NOT NULL REFERENCES atlas.articles (id) ON DELETE CASCADE,
  theme_id   text NOT NULL REFERENCES atlas.themes (id),
  PRIMARY KEY (article_id, theme_id)
);
CREATE INDEX article_themes_theme_idx ON atlas.article_themes (theme_id);

CREATE TABLE atlas.investigations (
  id                  text PRIMARY KEY CHECK (atlas.valid_id(id)),
  title               text NOT NULL CHECK (btrim(title) <> ''),
  -- Atlas-authored plain-language summary; every factual statement is repeated as a sourced item below.
  summary             text NOT NULL CHECK (btrim(summary) <> '' AND length(summary) <= 2000),
  primary_location_id text NOT NULL REFERENCES atlas.locations (id),
  -- Event period as local calendar dates in event_timezone; no invented clock times.
  event_start_date    date NOT NULL,
  event_end_date      date NOT NULL,
  event_timezone      text NOT NULL,
  -- curated_seed: researched and source-linked by the team; prepared_fixture: synthetic/demo content (must be labeled in UI).
  content_status      text NOT NULL CHECK (content_status IN ('curated_seed', 'prepared_fixture')),
  verification_status text NOT NULL CHECK (verification_status IN ('unreviewed', 'reviewed')),
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (event_start_date <= event_end_date),
  CHECK ((verification_status = 'reviewed') = (reviewed_at IS NOT NULL))
);

-- One sourced statement per row. Citations resolve through item id + source_ids.
CREATE TABLE atlas.investigation_items (
  id               text PRIMARY KEY CHECK (atlas.valid_id(id)),
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('what_happened', 'public_impact', 'resource', 'research_question', 'uncertainty', 'business_exposure')),
  position         integer NOT NULL CHECK (position >= 0),
  text             text NOT NULL CHECK (btrim(text) <> '' AND length(text) <= 1200),
  -- business_exposure must say whether the exposure is direct or a broad sector association.
  exposure_basis   text CHECK (exposure_basis IN ('direct', 'sector_association')),
  UNIQUE (investigation_id, kind, position),
  CHECK ((kind = 'business_exposure') = (exposure_basis IS NOT NULL))
);

CREATE TABLE atlas.investigation_item_sources (
  item_id   text NOT NULL REFERENCES atlas.investigation_items (id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES atlas.sources (id),
  PRIMARY KEY (item_id, source_id)
);

CREATE TABLE atlas.investigation_articles (
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  article_id       text NOT NULL REFERENCES atlas.articles (id),
  position         integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (investigation_id, article_id)
);

CREATE TABLE atlas.investigation_locations (
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  location_id      text NOT NULL REFERENCES atlas.locations (id),
  position         integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (investigation_id, location_id)
);

CREATE TABLE atlas.evidence (
  id                   text PRIMARY KEY CHECK (atlas.valid_id(id)),
  evidence_type        text NOT NULL CHECK (evidence_type IN ('report', 'article', 'observation_series', 'imagery')),
  title                text NOT NULL CHECK (btrim(title) <> ''),
  description          text NOT NULL CHECK (btrim(description) <> '' AND length(description) <= 1500),
  limitations          text NOT NULL CHECK (btrim(limitations) <> '' AND length(limitations) <= 1500),
  source_id            text NOT NULL REFERENCES atlas.sources (id),
  -- Observation/acquisition period (UTC). For imagery: sensing start/end, never the download date.
  observed_from        timestamptz,
  observed_to          timestamptz,
  location_id          text REFERENCES atlas.locations (id),
  -- observation_series evidence: the series it summarizes (FK added in 003).
  series_id            text,
  -- Imagery metadata (all required for evidence_type = 'imagery').
  bounds_west          double precision,
  bounds_south         double precision,
  bounds_east          double precision,
  bounds_north         double precision,
  asset_path           text CHECK (asset_path IS NULL OR asset_path ~ '^assets/evidence/[a-z0-9._/-]+$'),
  layer_ref            text,
  legend               text,
  attribution          text,
  license              text,
  resolution_m         double precision CHECK (resolution_m > 0),
  comparison_group     text,
  comparison_role      text CHECK (comparison_role IN ('before', 'after')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (observed_from IS NULL OR observed_to IS NULL OR observed_from <= observed_to),
  CHECK (evidence_type <> 'imagery' OR (num_nulls(bounds_west, bounds_south, bounds_east, bounds_north, asset_path,
    layer_ref, legend, attribution, license, resolution_m, observed_from, observed_to) = 0)),
  CHECK (bounds_west IS NULL OR (bounds_west <= bounds_east AND bounds_south <= bounds_north)),
  CHECK ((comparison_group IS NULL) = (comparison_role IS NULL)),
  CHECK (evidence_type <> 'observation_series' OR series_id IS NOT NULL)
);

CREATE TABLE atlas.evidence_sources (
  evidence_id text NOT NULL REFERENCES atlas.evidence (id) ON DELETE CASCADE,
  source_id   text NOT NULL REFERENCES atlas.sources (id),
  PRIMARY KEY (evidence_id, source_id)
);

CREATE TABLE atlas.investigation_evidence (
  investigation_id text NOT NULL REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  evidence_id      text NOT NULL REFERENCES atlas.evidence (id),
  position         integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (investigation_id, evidence_id)
);

-- News refresh state, keyed by the reviewed source-definition ID in scripts/source-definitions/atlas.mjs
-- (e.g. 'gdelt-french-broad-flooding'), not by atlas.sources.id. A failed refresh never clears last_successful_at.
CREATE TABLE atlas.ingestion_state (
  source_id            text PRIMARY KEY CHECK (atlas.valid_id(source_id)),
  status               text NOT NULL CHECK (status IN ('success', 'failed')),
  attempted_at         timestamptz NOT NULL,
  last_successful_at   timestamptz,
  next_retry_at        timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  -- Imported news is unreviewed until a person reviews individual records.
  verification_status  text NOT NULL DEFAULT 'unreviewed' CHECK (verification_status IN ('unreviewed', 'reviewed')),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'success' OR (last_successful_at IS NOT NULL AND next_retry_at IS NULL))
);

-- Same algorithm as the backend's normalizeArticle: sha256 hex of JSON.stringify([title, excerpt]).
CREATE FUNCTION atlas.article_content_hash(title text, excerpt text) RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN encode(sha256(convert_to('[' || to_json(title)::text || ',' || COALESCE(to_json(excerpt)::text, 'null') || ']', 'UTF8')), 'hex');

-- Flat article rows with reviewed link arrays, shared by the news and semantic_news plans.
CREATE VIEW atlas.article_records AS
SELECT a.*,
  COALESCE((SELECT array_agg(l.location_id ORDER BY l.location_id) FROM atlas.article_locations l WHERE l.article_id = a.id), '{}') AS location_ids,
  COALESCE((SELECT array_agg(e.entity_id ORDER BY e.entity_id) FROM atlas.article_entities e WHERE e.article_id = a.id), '{}') AS entity_ids,
  COALESCE((SELECT array_agg(t.theme_id ORDER BY t.theme_id) FROM atlas.article_themes t WHERE t.article_id = a.id), '{}') AS themes
FROM atlas.articles a;

-- True when a location lies wholly inside [west,south,east,north]: broad places by their bounds, points by their point.
CREATE FUNCTION atlas.location_within(l atlas.locations, w double precision, s double precision, e double precision, n double precision)
  RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE
  RETURN CASE
    WHEN l.bounds_west IS NOT NULL THEN l.bounds_west >= w AND l.bounds_east <= e AND l.bounds_south >= s AND l.bounds_north <= n
    WHEN l.longitude IS NOT NULL THEN l.longitude BETWEEN w AND e AND l.latitude BETWEEN s AND n
    ELSE false
  END;

INSERT INTO atlas.schema_migrations (version) VALUES ('002_records');
COMMIT;
