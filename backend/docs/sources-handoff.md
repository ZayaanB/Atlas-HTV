# Required source/provider handoff — Person 4

No source definitions, imported records, or approved flight profiles existed at implementation start. The backend does not guess feeds, licenses, geographic mappings or fixtures. Supply a reviewed module under `scripts/source-definitions/`, e.g. `atlas.mjs`, exporting `sources` and `regions`; configure its path in `ATLAS_SOURCES_MODULE`. This is trusted local configuration, never assistant/user input.

## News definition interface

Each item in `sources` is a record with:

- `id`: stable reviewed provider/source configuration ID.
- `provider`: `gdelt` or `rss`.
- `permitted: true`: human review of provider access and permitted retained fields completed.
- `license_url`: actual applicable license/terms/permission reference.
- For GDELT, `query`: reviewed bounded query (1–512 chars), not passed from a browser/model.
- For RSS, `url`: a reviewed public HTTPS hostname/feed URL; `publisher`: actual publisher.
- `excerpts_permitted`: true only when storage/use of feed-provided excerpts is permitted; default false.
- For permitted RSS excerpts, `max_excerpt_chars`: reviewed 1–500 character bound; default stores no excerpt.

Keep a human-readable rights/attribution/retention/review-date record next to each definition. `permitted` is a configuration acknowledgement, not legal verification by code. GDELT discovery access does not grant article/image republication rights. No full-page scraping, images, or automatic summaries are imported. Source URLs with unsupported protocols are skipped; current normalization requires HTTPS article links. If a verified source legitimately needs HTTP links, agree the shared Source contract and URL policy explicitly.

GDELT uses only the fixed DOC artlist endpoint, at most 100 results for one day. Its seendate is discovery time, not verified publication; titles are title-only evidence. RSS/Atom supports bounded items with pubDate/published; Atom updated is not used as publication. Undated/ambiguous-time records have null publication. Source-defined issue/geographic queries are not proof of actual article theme/location: newly imported verified arrays are empty until reviewed/enriched by an agreed workflow.

RSS requests reject redirects, DTD/entities, IP-literal/private-style URL forms and oversized bodies. Only reviewed hostnames may be configured; no arbitrary URL execution route/tool exists. Feed host DNS/egress must be reviewed by deployment configuration. Provider timeout defaults to 8 seconds. A failed/429 refresh retains stored news and records a retry no sooner than 15 minutes (respecting longer Retry-After, capped at 24 hours). Scheduled ingestion is deliberately not enabled; current execution is manual by approved source ID.

## Flight regions and access

Each `regions` record must validate through shared `FlightRegion`: `id`, center `latitude`, `longitude`, integer `radius_nm` 1–100. IDs are the only HTTP/model flight request selectors. These are configured geographic exploration regions, not claims of verified airports/facilities. Person 2 consumes shared `AircraftState` and region metadata; do not duplicate it in map code.

Before setting `FLIGHTS_ENABLED=true`, verify ADSB.lol production access expectations, attribution, current acceptable polling, receiver coverage and ODbL obligations. [Their API documentation](https://api.adsb.lol/docs) requests contact for production use and identifies the data/API as ODbL. Current docs do not establish a polling entitlement; 60 seconds is this backend's default safety bound, not a provider guarantee. [Open-data reference](https://www.adsb.lol/docs/open-data/api/).

The adapter uses only `/v2/point/{lat}/{lon}/{radius}` and independently rejects positions outside the selected radius. The v2 envelope epoch is milliseconds; seen_pos is seconds, as described in [readsb's v2 format](https://github.com/wiedehopf/readsb/blob/dev/README-json.md). Positions older than five minutes at import are dropped; shared cache settings additionally mark stale/hide expired positions. Invalid/missing coordinates and missing age are excluded. Units remain feet (barometric) and knots; missing values stay null. There is no aircraft route, delay, destination, emergency-status inference, global feed, trail extrapolation, or history storage.

One process shares all viewers' samples. At most three active region entries by default; all regions share one provider refresh gate, so a new region can temporarily return 503 during another region's refresh window. Concurrent requests for one region coalesce. Failure applies exponential delay plus Retry-After (max one hour header; max 15-minute exponential component); cached positions remain explicitly stale until expiry. Empty samples still carry partial-coverage attribution. No requests means no polls; no background timers or paid flight services are used. Do not scale to multiple backend workers without coordinating a shared quota/cache strategy.

No provider fixtures are presented as live. A future licensed replay requires a separate shared payload/config mode; currently unavailable flight access returns a controlled error rather than fabricated/replayed positions. No OpenSky substitution is implemented.
