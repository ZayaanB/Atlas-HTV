// Reviewed source definitions — Person 4. Loaded by the backend through ATLAS_SOURCES_MODULE
// (scripts/source-definitions/atlas.mjs). Configuration only: no fetch or import logic lives here.
// Rights, attribution, retention and review notes for every entry: scripts/source-definitions/README.md.
// Review date for all entries: 2026-10-17. No credentials, keys or tokens belong in this file.

// News discovery definitions. `permitted: true` records the human terms review in README.md; it is not legal
// verification by code. Query text is discovery configuration and never proves an article's theme or place:
// imported rows stay unreviewed with empty location/entity/theme arrays.
export const sources = [
  {
    id: 'gdelt-asheville-flooding',
    provider: 'gdelt',
    permitted: true,
    license_url: 'https://www.gdeltproject.org/about.html',
    query: '(Asheville OR "French Broad") (flood OR flooding OR "boil water")'
  },
  {
    id: 'gdelt-asheville-water-system',
    provider: 'gdelt',
    permitted: true,
    license_url: 'https://www.gdeltproject.org/about.html',
    query: 'Asheville ("water system" OR "boil water" OR "water main")'
  },
  {
    id: 'gdelt-ontario-flooding',
    provider: 'gdelt',
    permitted: true,
    license_url: 'https://www.gdeltproject.org/about.html',
    query: '(Ontario OR Toronto) (flood OR flooding)'
  },
  {
    id: 'rss-nasa-earth-observatory',
    provider: 'rss',
    permitted: true,
    license_url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
    // Final URL (no redirect) of the Earth Observatory "Image of the Day" feed as of 2026-10-17.
    url: 'https://science.nasa.gov/feed/?science_org=19791%2C22453',
    publisher: 'NASA',
    excerpts_permitted: true,
    max_excerpt_chars: 300
  },
  {
    // Live disaster alerts with provider-published event points (README.md, reviewed 2026-10-18). Imported items stay
    // unreviewed; their GDACS point/bounding box becomes an unreviewed region-precision location (migration 006).
    id: 'rss-gdacs-alerts',
    provider: 'rss',
    profile: 'gdacs',
    permitted: true,
    url: 'https://www.gdacs.org/xml/rss.xml',
    publisher: 'GDACS',
    source_type: 'government_report',
    license: 'CC BY 4.0 (European Union), as stated in each GDACS RSS item',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Source: GDACS — Global Disaster Alert and Coordination System (European Commission JRC, UN OCHA), CC BY 4.0',
    excerpts_permitted: true,
    max_excerpt_chars: 300,
    // Green wildfire notices were 181 of 211 items on 2026-10-17; other event types import at every alert level.
    min_alert_level: { WF: 'Orange' }
  }
];

// Live observation series (migration 006), refreshed by `npm --prefix backend run ingest -- --all` or by ID.
// Each is a separate series beside the curated 2024 archive of the same gauge: same location and metric, different
// source (USGS Water Data OGC API), its own provider unit string, and live = true. Values are mostly Provisional.
const usgsWaterData = {
  provider: 'usgs_waterdata',
  permitted: true,
  license: 'U.S. Public Domain (USGS-authored data)',
  license_url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  attribution: 'U.S. Geological Survey, Water Data for the Nation (api.waterdata.usgs.gov)',
  statistic_id: '00011',
  expected_interval_seconds: 900,
  backfill_days: 7,
  missing_data_rule: 'Absent 15-minute readings are gaps and are never interpolated. A null value means USGS published the time without a value. Recent values are provisional (qualifier P) and may be revised; the last two hours are re-read on every refresh.',
  // Shown beside the 2024 flood record as current context for the same gauges; it is not part of the 2024 event.
  investigation_id: 'inv-helene-asheville-2024'
};
export const observation_sources = [
  {
    ...usgsWaterData,
    id: 'usgs-waterdata-03451500-discharge',
    series_id: 'usgs-03451500-discharge-live',
    monitoring_location_id: 'USGS-03451500', parameter_code: '00060',
    location_id: 'loc-usgs-03451500', metric: 'discharge', unit: 'ft^3/s',
    title: 'USGS continuous discharge, French Broad River at Asheville, NC (03451500) — current readings',
    description: 'Current 15-minute discharge readings at USGS 03451500 (French Broad River at Asheville, NC), refreshed from the USGS Water Data API. Live context for the gauge, separate from the curated September–October 2024 flood record.'
  },
  {
    ...usgsWaterData,
    id: 'usgs-waterdata-03451500-gage-height',
    series_id: 'usgs-03451500-gage-height-live',
    monitoring_location_id: 'USGS-03451500', parameter_code: '00065',
    location_id: 'loc-usgs-03451500', metric: 'gage_height', unit: 'ft',
    title: 'USGS continuous gage height, French Broad River at Asheville, NC (03451500) — current readings',
    description: 'Current 15-minute gage height readings at USGS 03451500 (French Broad River at Asheville, NC), refreshed from the USGS Water Data API. Live context for the gauge, separate from the curated September–October 2024 flood record.'
  },
  {
    ...usgsWaterData,
    id: 'usgs-waterdata-03451000-discharge',
    series_id: 'usgs-03451000-discharge-live',
    monitoring_location_id: 'USGS-03451000', parameter_code: '00060',
    location_id: 'loc-usgs-03451000', metric: 'discharge', unit: 'ft^3/s',
    title: 'USGS continuous discharge, Swannanoa River at Biltmore, NC (03451000) — current readings',
    description: 'Current 15-minute discharge readings at USGS 03451000 (Swannanoa River at Biltmore, NC), refreshed from the USGS Water Data API. Live context for the gauge, separate from the curated September–October 2024 flood record.'
  },
  {
    ...usgsWaterData,
    id: 'usgs-waterdata-03451000-gage-height',
    series_id: 'usgs-03451000-gage-height-live',
    monitoring_location_id: 'USGS-03451000', parameter_code: '00065',
    location_id: 'loc-usgs-03451000', metric: 'gage_height', unit: 'ft',
    title: 'USGS continuous gage height, Swannanoa River at Biltmore, NC (03451000) — current readings',
    description: 'Current 15-minute gage height readings at USGS 03451000 (Swannanoa River at Biltmore, NC), refreshed from the USGS Water Data API. Live context for the gauge, separate from the curated September–October 2024 flood record.'
  }
];

// Flight exploration regions (FlightRegion: latitude/longitude centre, integer radius_nm 1–100). A region is an
// area to look at, not a claim about an airport or facility. Flights stay disabled (FLIGHTS_ENABLED=false) until
// the ADSB.lol production-use contact and polling expectations in README.md are resolved.
export const regions = [
  {
    id: 'region-asheville',
    // Census 2020 internal point of Asheville city (GEOID 3702140), the same point as loc-asheville-nc.
    latitude: 35.5709722,
    longitude: -82.5527255,
    radius_nm: 25
  }
];
