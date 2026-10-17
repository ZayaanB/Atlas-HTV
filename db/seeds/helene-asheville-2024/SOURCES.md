# Seed provenance: Hurricane Helene at Asheville, NC (2024)

This is a curated seed, researched by Person 4's workstream on 2026-10-17. It is neither a live feed nor a synthetic fixture. Every value comes from the files and pages listed below, and every URL returned HTTP 200 when it was checked; the UTC check times are stored as `retrieved_at`. Statements in the investigation brief were checked against each page's own text or against the USGS data files.

A human spot-check by a team member before the demo is still recommended. Rows are marked `reviewed` because they passed this source check, not because an editor signed them off.

## Time conventions

| Time | Meaning in this seed |
| --- | --- |
| Event period | Local calendar dates 2024-09-25 to 2024-09-27 in `America/New_York` (investigation `event_start_date`/`event_end_date`). No clock time is invented. |
| Publication | `published_at` comes from page metadata (`datePublished`/`article:published_time`) or from the document's own dateline (USGS alert: "Mon, 30 Sep 2024 21:46:06 EDT" = 2024-10-01T01:46:06Z). The USGS news release shows only "October 4, 2024", so it is stored as `published_date` with `published_at` NULL (`date_only`). The NWS summary shows no date (`unavailable`). |
| Observation | USGS instantaneous timestamps carry an explicit offset (−04:00, EDT) and are converted to UTC. Annual-peak dates and times in the peak file are in local **standard** time (EST, −05:00). This was checked against the overlap: the peak file's 2024-09-27 16:38 equals the instantaneous crest at 17:38 EDT = 21:38 UTC. |
| Retrieval | When Atlas downloaded or checked the file or page (`fetched_at`/`retrieved_at`). Never used as an event or observation time. |

## Indicator datasets (USGS, U.S. Public Domain)

License: USGS-authored data are U.S. Public Domain; USGS asks for credit ([copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)). Attribution: "U.S. Geological Survey, National Water Information System".

| Series ID | File / exact URL | Retrieved (UTC) | sha256 | Rows | Unit | Cadence and period |
| --- | --- | --- | --- | --- | --- | --- |
| `usgs-03451500-discharge` | `iv_03451500_00060.json` — https://nwis.waterservices.usgs.gov/nwis/iv/?format=json&sites=03451500&parameterCd=00060&startDT=2024-09-20T00:00Z&endDT=2024-10-10T00:00Z | 2026-10-17T11:46:34Z | `2ae9859d0d4817d39e880dc9e7b42ca5d7fc93b532bbfa20b478823fa6329e50` | 1921 | ft³/s (`ft3/s`) | 15-min instantaneous, 2024-09-20T00:00Z–2024-10-10T00:00Z inclusive |
| `usgs-03451500-gage-height` | `iv_03451500_00065.json` — same URL with `parameterCd=00065` | 2026-10-17T11:46:34Z | `8e415cf15f5080a32a405eb46cac74436af8f269d5bae81f0ef0fd1789d33d37` | 1921 | ft | same |
| `usgs-03451000-discharge` | `iv_03451000_00060.json` — `sites=03451000&parameterCd=00060` | 2026-10-17T11:46:35Z | `433a95c01bad5fc6e204576a1eb8df2090b034751ab5efdc5d5048648bb98a51` | 1752 | ft³/s | same, with gaps and `e` (estimated) values |
| `usgs-03451000-gage-height` | `iv_03451000_00065.json` — `sites=03451000&parameterCd=00065` | 2026-10-17T11:46:35Z | `ea920f1106d8a7c00ca2381852e5ceefa23b1c9711733301f1ca9bc7db3d078f` | 1743 | ft | same, with gaps |
| `usgs-03451500-annual-peak-discharge` | `peak_03451500.rdb` — https://nwis.waterdata.usgs.gov/nwis/peak?site_no=03451500&agency_cd=USGS&format=rdb | 2026-10-17T11:46:36Z | `6d97a8ec53c9f49c8d6150240569e9b86dfb8c8234226a2855e3135b50fd82dc` | 130 | ft³/s | One peak per USGS water year (Oct 1–Sep 30), WY1896–WY2025 |

All instantaneous values in this window carry USGS qualifier `A` (approved); some Swannanoa discharge values are also `e` (estimated). `observations.csv` is produced from these five files by `build-observations.mjs`, which is offline and deterministic. To reproduce it, download the five URLs into one folder with the file names above, run the script, and diff the result.

The legacy `waterservices`/`nwis.waterservices` endpoints are being modernized by USGS (to `api.waterdata.usgs.gov`) and could stop resolving. The committed CSV and these checksums keep the seed reproducible from the archived responses.

### Known data facts the seed relies on

- French Broad River at Asheville: 1,190 ft³/s and 1.71 ft at 2024-09-20T00:00Z. The crest is 113,000 ft³/s and 24.82 ft at 2024-09-27T21:38Z (an extra reading between 21:30Z and 21:45Z). At 21:30Z the gage read 24.67 ft, the value given as the provisional peak in USGS's Sept 30 alert ("24.67 feet recorded on 09/27/2024 at 05:30 PM"). One reading is missing, at 2024-09-28T20:30Z.
- Peak file: 2024-09-27 16:38 EST, 113,000 ft³/s, code `9` (hurricane), gage height 24.82 ft. 1916-07-16: 110,000 ft³/s, gage height 23.10 ft with gage-height code `6` ("Gage datum changed during this year"), so the two stages are not comparable. 110,000 is the largest listed discharge before 2024.
- Swannanoa River at Biltmore gage height: readings are missing 17:15–19:00Z and 19:00–21:30Z on 2024-09-27, and from 2024-09-28T02:30Z to 2024-09-29T19:30Z. The highest stored reading is 27.33 ft at 19:00Z, whose discharge is flagged `e`. No crest is claimed.

## Locations

| Location | Source | Values |
| --- | --- | --- |
| `loc-usgs-03451500`, `loc-usgs-03451000` (facility) | USGS NWIS site file: https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=03451500,03451000&siteOutput=expanded | Decimal lat/lon, NAD83, accuracy code `S` (±1 second): 35.60888889, −82.5780556 and 35.5683333, −82.5447222 |
| `loc-asheville-nc` (city) | Census 2020 TIGERweb incorporated place GEOID 3702140 (layer 25, vintage January 1, 2020) | Extent from the boundary geometry, rounded outward to 5 decimals: [−82.67045, 35.41644, −82.46038, 35.65612]. Internal point 35.5709722, −82.5527255 (a Census representative point, not an event location) |
| `loc-buncombe-county-nc` (region) | Census 2020 TIGERweb county GEOID 37021 (layer 55) | Extent [−82.88811, 35.41644, −82.16904, 35.82411]; internal point 35.6093706, −82.5304234 |

Census TIGER data are U.S. Government works (public domain); attribution "Source: U.S. Census Bureau". Places named in the brief without an authoritative boundary (River Arts District, Biltmore Village, North Fork reservoir) have **no** location records, so no pin is invented for them.

## Reporting and official pages

| Source ID | Publisher | Published (UTC) | Supports |
| --- | --- | --- | --- |
| `src-nws-gsp-helene-flood-summary` | NWS Greenville-Spartanburg (public domain) | not shown on the page | Predecessor rain on Sept 25–26 and rainbands early Sept 27; French Broad above 1916 records; "destruction of a portion of the River Arts District"; Swannanoa deaths and destroyed structures |
| `src-usgs-alert-2024-09-30` | USGS SAWSC (public domain) | 2024-10-01T01:46:06Z | Provisional 24.67 ft at 5:30 PM; 1916 stage 23.10 ft; records back to October 1895 |
| `src-usgs-news-helene-streamgages` | USGS (public domain) | date only: 2024-10-04 | At least 34 provisional flood records; provisional 24.67 ft; data "will be verified or revised" |
| `src-nasa-eo-flash-floods-nc` | NASA Earth Observatory | 2024-10-05T16:00:00Z | Water mains and transmission lines to the North Fork plant damaged; 50% of Buncombe customers without power on Oct 4 (citing PowerOutage.us); Swannanoa 26.1 ft; airport station stopped at nearly 14 in |
| `src-foxweather-rad-drone` | FOX Weather | 2024-09-30T19:25:55Z | Drone video of the River Arts District, water up to some roofs |
| `src-eenews-helene-flood-records` | E&E News by POLITICO | 2024-10-04T20:14:22Z | Reporting of the provisional record |
| `src-wlos-first-water-flow` | WLOS | 2024-10-12T18:58:30Z | 36-inch bypass activated; first flow since Sept 26; sediment; boil-water notice |
| `src-wlos-boil-water-lifted` | WLOS | 2024-11-18T16:43:49Z | Advisory lifted Nov 18; tests clear of E. coli and coliform |
| `src-wbtv-boil-water-lifted` | WBTV | 2024-11-18T19:15:44.305Z | Advisory lifted; pre-1988 plumbing flushing caveat |
| `src-wlos-council-recovery-2025` | WLOS | 2025-08-27T22:14:26Z | Staff report: water outage for many customers for 14 days; 2004 week-long outage; North Fork Transmission Main No. 3 at a higher elevation |

Publisher articles are stored as **title and link only** (`excerpt` NULL), and Atlas never presents a summary of them as if the article had been read. Government pages are public domain, but their text is still not copied into the database, apart from the statements written in Atlas's own words in the brief.

## Imagery

See [`assets/evidence/helene-asheville-2024/README.md`](../../../assets/evidence/helene-asheville-2024/README.md).
