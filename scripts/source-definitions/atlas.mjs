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
