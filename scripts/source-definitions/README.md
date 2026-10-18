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

### `rss-gdacs-alerts` (added 2026-10-18)

| Item | Record |
| --- | --- |
| Feed | `https://www.gdacs.org/xml/rss.xml`, read with the backend's `gdacs` RSS profile. |
| Verified 2026-10-17/18 | HTTP 200 `application/xml`, no redirect, no DOCTYPE/ENTITY, a leading UTF-8 BOM (stripped by the adapter), ~650 KB, 211 items. Each item carries `geo:Point`, `gdacs:bbox` (lonmin lonmax latmin latmax), `gdacs:eventtype`/`eventid`/`alertlevel`/`country` and `gdacs:fromdate`. Item links are HTTPS `www.gdacs.org/report.aspx?eventtype=…&eventid=…`. |
| Publisher | GDACS (Global Disaster Alert and Coordination System: European Commission JRC and UN OCHA). |
| Terms | Every item says: "Copyright notice: European Union (CC BY 4.0), reuse is allowed, provided appropriate credit to GDACS is given." The channel element says `<copyright>public domain</copyright>`; Atlas follows the stricter CC BY 4.0 notice. The site's [disclaimer](https://www.gdacs.org/About/termofuse.aspx) says the information "is purely indicative and should not be used for any decision making without alternate sources of information". |
| Attribution (UI) | "Source: GDACS, CC BY 4.0. Alerts are indicative; check official sources before acting." It appears next to every GDACS item, with the publisher name and a link to the GDACS report. |
| Stored fields | Title, link, feed `pubDate` (publication), a description excerpt of at most 300 characters, and, for earthquakes only, `fromdate` as `event_at`. Other event types publish day-level dates (00:00 or 01:00), so they keep `event_at = null` rather than gaining a false time. No images. |
| Locations | The item's `geo:Point` and `gdacs:bbox` become an **unreviewed** `region` location (`loc-gdacs-<type>-<eventid>`), linked as `provider_asserted`. The box is GDACS's display extent around the point, not an affected-area footprint. The map draws these as amber provisional points and never fills the box. A box crossing the antimeridian, or a point outside its own box, stores no location. |
| Selection | `min_alert_level: { WF: 'Orange' }`. On 2026-10-17, 181 of 211 items were Green wildfire notices, which would crowd out every other event type. Earthquakes, cyclones, floods, droughts and volcanoes import at every level. The 100 most recently published selected items are kept per refresh (30 on 2026-10-17). |
| Retention | Kept until removed; refreshes update an event's title, excerpt, point and box in place (same URL and location ID). |

### Live observation series (`observation_sources`, added 2026-10-18)

| Item | Record |
| --- | --- |
| Provider | USGS Water Data for the Nation OGC API, `continuous` collection: `https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items`. It replaces the legacy `waterservices` IV service the 2024 seed was archived from. |
| Verified 2026-10-17/18 | HTTP 200 GeoJSON, no API key. `time=<UTC>/..` returns readings ascending; `properties=` narrows fields. Values are strings in the provider's unit (`ft^3/s` for 00060, `ft` for 00065); recent values have `approval_status: Provisional`. Both gauges and both parameters returned current 15-minute data. No rate-limit headers were returned; the documented per-key limits were not checked. |
| Series | `usgs-03451500-discharge-live`, `usgs-03451500-gage-height-live`, `usgs-03451000-discharge-live`, `usgs-03451000-gage-height-live`. Each is a separate `live = true` series beside the curated 2024 series of the same gauge (migration 006), with its own source `src-usgs-waterdata-<site>-<parameter>-00011`. |
| Terms | USGS-authored data are U.S. Public Domain; USGS asks for credit ([copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)). Attribution: "U.S. Geological Survey, Water Data for the Nation". |
| Refresh | A new series backfills 7 days. Later refreshes resume two hours before the newest stored reading, so revised provisional values replace the stored ones. Gaps are never interpolated. At most 1,000 readings are read per refresh, and a longer gap fills over several refreshes. If the provider's unit string changes, the refresh fails and nothing is written. |
| Investigation link | Each live series is attached once to `inv-helene-asheville-2024` as current context for the same gauges. Its description says it is not part of the 2024 event. |

### Worldwide GDELT queries: not added (pending verification)

The worldwide candidates in `backend/docs/global-discovery-handoff.md`, plus two narrower variants (`(theme:NATURAL_DISASTER_FLOODS OR theme:NATURAL_DISASTER_EARTHQUAKE OR theme:WILDFIRE) sourcelang:english` and `("power outage" OR blackout OR "water shortage" OR "boil water") sourcelang:english`), were tried on 2026-10-18. Four of five requests answered HTTP 429 "Please limit requests to one every 5 seconds", including the first request after an 18-minute pause. The one query that answered (`("public transit" OR "drinking water" OR housing)`) returned 100 low-precision hits across 30 countries and 8 languages. None is added until a query answers reliably from the deployment host and its precision is reviewed. Live, mappable worldwide coverage comes from GDACS meanwhile.

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

### Draft production-use message to ADSB.lol (not sent)

A team member sends this through the contact route listed in the [ADSB.lol API documentation](https://api.adsb.lol/docs), then records the date, the contact and the reply in the table above. Nothing has been sent, and flights stay disabled until a reply is recorded.

> Subject: Atlas (hackathon project) — production use of the ADSB.lol point API
>
> Hello,
>
> We are building Atlas, a student hackathon research map, and would like to show a small live aircraft layer from your API. Following your documentation's request to get in touch before production use, here is exactly what we plan:
>
> - Endpoint: only `/v2/point/{lat}/{lon}/{radius}`, for at most three configured regions of ≤25 nm radius (the first is Asheville, NC).
> - Polling: one shared server-side cache for all viewers. At most one request per region every 60 seconds, only while someone is viewing that region, with exponential backoff and `Retry-After` respected. No polling without viewers.
> - Storage: positions stay only in process memory for a few minutes. No history, no redistribution of raw data, no route/delay/status inference.
> - Attribution: "Aircraft data © ADSB.lol contributors, ODbL 1.0", shown on the layer even when it is empty.
>
> Is this acceptable, and is there a polling interval, API-key requirement or attribution wording you would like us to use instead?
>
> Thank you,
> The Atlas team

## Datasets used by the curated seed

The curated seed's datasets (USGS NWIS, U.S. Census TIGERweb, NASA HLS/GIBS) are recorded with exact URLs, licenses, units, cadence, retrieval times and checksums in [`db/seeds/helene-asheville-2024/SOURCES.md`](../../db/seeds/helene-asheville-2024/SOURCES.md). They are static curated imports, not live feeds.
