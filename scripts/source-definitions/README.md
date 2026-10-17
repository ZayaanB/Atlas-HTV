# Source and import definitions — Person 4

`atlas.mjs` is the reviewed definitions module the backend loads through `ATLAS_SOURCES_MODULE=scripts/source-definitions/atlas.mjs`. It holds configuration only. Person 3's backend owns fetching, normalization and imports (`npm --prefix backend run ingest -- <source-id>`), and nothing here runs on its own.

Every definition was reviewed on **2026-10-17**. "Verified" below means a request was actually made on that date and its answer was read. It is not a legal opinion. Re-review a definition before changing it, and at least before each public demo.

## News discovery definitions

### Shared GDELT terms (`gdelt-*`)

| Item | Record |
| --- | --- |
| Provider | GDELT Project DOC 2.0 API. The backend uses only the fixed `artlist` endpoint: at most 100 results, 1-day timespan. |
| Terms | [gdeltproject.org/about.html](https://www.gdeltproject.org/about.html): datasets are "available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee". Any use or redistribution "must include a citation to the GDELT Project and a link to this website". |
| What the terms do *not* cover | Publisher articles and images. GDELT supplies discovery metadata; the publishers keep copyright in their articles. Atlas stores only the title, URL, domain and timestamps (`excerpt` is always NULL for GDELT). |
| Attribution (UI / submission) | "News discovery via the GDELT Project (https://www.gdeltproject.org/)". This must appear wherever GDELT-discovered records are listed. |
| Time meaning | `seendate` is stored as `discovered_at`. `published_at` stays NULL with `publication_time_basis = 'unavailable'`, so publication-date filters exclude these rows by design. |
| Rate limit (observed) | GDELT answered HTTP 429: "Please limit requests to one every 5 seconds". Run manual imports one source at a time, at least 5 s apart. After a 429 the backend waits at least 15 minutes. |
| Retention | Metadata rows are kept until removed. No full text, images or summaries are fetched. Remove a record on a publisher's request. |
| Review status of imports | Always `unreviewed`, with empty location/entity/theme arrays. A query match does not show that an article is about the queried place or topic. |

| ID | Query | Verified 2026-10-17 | Notes |
| --- | --- | --- | --- |
| `gdelt-asheville-flooding` | `(Asheville OR "French Broad") (flood OR flooding OR "boil water")` | HTTP 200 with a valid JSON article list | The first hit was an unrelated national story: GDELT matches full text. |
| `gdelt-asheville-water-system` | `Asheville ("water system" OR "boil water" OR "water main")` | HTTP 200, 0 articles in the last day | An empty result is a valid empty refresh, not an outage. |
| `gdelt-ontario-flooding` | `(Ontario OR Toronto) (flood OR flooding)` | HTTP 200, 9 articles | Low precision: hits included an election story and a French-language lifestyle story. It supports the "Ontario flooding" demo prompt only as unreviewed discovery. |

Rejected: `"French Broad River" (flood OR flooding OR Helene)` returned HTTP 429 three times, even when spaced 20–45 s apart. It was left out because it could not be verified.

### `rss-nasa-earth-observatory`

| Item | Record |
| --- | --- |
| Feed | `https://science.nasa.gov/feed/?science_org=19791%2C22453`. This is where the Earth Observatory "Image of the Day" feed URL (`https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss`) redirects. The backend rejects redirects, so the final URL is configured directly. |
| Verified 2026-10-17 | HTTP 200 `application/rss+xml` with no redirect. RSS 2.0 with 10 items and no DOCTYPE/ENTITY. Item links are HTTPS on `science.nasa.gov`, and `pubDate` values carry `+0000`. The feed title is "NASA Science", and items include some NASA Photojournal posts as well as Earth Observatory stories. |
| Publisher | NASA. |
| Terms | [NASA images and media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA content is "generally not subject to copyright in the United States" and may be used "for educational or informational purposes"; "NASA should be acknowledged as the source of the material". Third-party material marked as copyrighted is excluded. |
| Excerpts | `excerpts_permitted: true`, `max_excerpt_chars: 300`. Only NASA-authored feed descriptions are stored, never images. Do not imply NASA endorsement. |
| Attribution | "Source: NASA" next to each item, with a link to the original page. |
| Retention | Title, link, feed-asserted `pubDate` and an excerpt of at most 300 characters, kept until removed. |
| Risks | The `science_org` query string is opaque and could change without notice. If the feed starts redirecting, imports fail safely and keep the stored rows. Re-check the redirect target in that case. |

## Flight regions and ADSB.lol (flights stay disabled)

| Item | Record |
| --- | --- |
| Region | `region-asheville`: centre 35.5709722, -82.5527255 (the Census 2020 internal point of Asheville city, GEOID 3702140), radius 25 nm. It is an area to explore, not an airport or facility. |
| Provider terms | The [ADSB.lol OpenAPI description](https://api.adsb.lol/api/openapi.json) (read 2026-10-17) says "You can use the API for free". It also says "In the future, you will require an API key which you can get by feeding to adsb.lol", and "If you want to use the API for production purposes, please contact me so I do not break your application by accident." |
| License | "The license for the API as well as all data ADSB.lol makes public is ODbL" ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)). |
| Polling | No polling allowance is published. The backend's 60 s minimum refresh is Atlas's own safety bound, not a provider entitlement. |
| Attribution | "Aircraft data © ADSB.lol contributors, ODbL 1.0". Show it on the flight layer even when it is empty. |
| Retention | None: positions live only in the backend's process cache. `db/migrations/005_aircraft.sql` deliberately creates no storage. |
| **Blocking before `FLIGHTS_ENABLED=true`** | A team member must contact ADSB.lol about production use and record the reply here: date, contact and any polling guidance. OpenSky is not a substitute: its terms require prior written agreement for operational live-product use. |

## Datasets used by the curated seed

The curated seed's datasets (USGS NWIS, U.S. Census TIGERweb, NASA HLS/GIBS) are recorded with exact URLs, licenses, units, cadence, retrieval times and checksums in [`db/seeds/helene-asheville-2024/SOURCES.md`](../../db/seeds/helene-asheville-2024/SOURCES.md). They are static curated imports, not live feeds.
