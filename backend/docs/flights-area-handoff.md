# Global airline snapshot — shared live refresh verified; browser gaps recorded

This global design supersedes the **area-only frontend instructions below**.
Person 3 has implemented the global adapter, service, persistent quota ledger,
route and optional workspace capability. Persons 1/2 have delivered the shared
schemas, global frontend and map integration. Actual shared-schema compatibility
and synthetic browser verification are complete. The authorized live check now
verifies runtime discovery and two shared refreshes across desktop/mobile viewers;
Back navigation and dated-evidence preservation remain unverified live. See the
[live result](#live-result--october-18-2026) for the scope and cleanup deviation.
A loaded registry missing the global exports
still returns 503 `CONTRACTS_UNAVAILABLE` before any ledger/provider access. No
parallel domain schemas were added to the backend. Existing regional endpoints remain available
when ADSB.lol is selected; they never cause AirLabs or global fallback calls.

## Shared contracts — delivered authoritative interface

`contracts/schemas/workspace.ts`, exports, generated types and compatibility
tests now supply this interface and retain old payloads. Optional `capabilities.flight_global` is a boolean;
the backend emits it only when the workspace schema declares it. `flight_areas`
remains false for AirLabs. The legacy `flights` flag also remains false; global
clients must enable the toggle independently from `flight_global`. Global clients must prefer `flight_global` and must not
silently fall back to regional coverage after a global failure.

`AircraftState` includes these compatible extensions:
- `provider`: `adsb.lol | airlabs`; `license`: `ODbL-1.0 | AirLabs-terms`.
- `altitude_unit`: `ft | m`; `altitude_reference`: `barometric | unknown`.
- Optional nullable strings, maximum 32: `flight_iata`, `airline_icao`,
  `airline_iata`, `departure_iata`, `arrival_iata`.
- Optional `direction_kind`: `direction | ground_track`. AirLabs supplies
  `direction`; absent on old ADSB.lol records means legacy ground track.
- Existing identity/null/time/coordinate fields remain unchanged. AirLabs altitude
  is meters, reference unknown; speed is null with the existing `kn` unit because
  the reviewed documentation describes speed ambiguously as “km”. `operator` is
  null; display the explicit airline code fields rather than inventing a name.

Strict `FlightGlobalResponse` requires every property below:

| Field | Exact wire shape |
| --- | --- |
| `snapshot_id` | string or null; successful values `airlabs-<fetch Unix ms>` |
| `items` | `AircraftState[]`, maximum 25,000 |
| `trails` | array, maximum 25,000; entries `{ aircraft_id: string, points: [...] }` |
| trail point | `{ coordinates: Coordinates, observed_at: UTC, callsign: string|null, flight_iata: string|null }`; maximum eight points per entry |
| `fetched_at` | UTC timestamp or null |
| `status` | `ready | waiting | unavailable`; current backend awaits its bounded initial refresh, so emits ready/unavailable |
| `stale`, `truncated` | booleans |
| `mode`, `replay` | literal `live`, literal false |
| `attribution` | string |
| `retry_at` | UTC timestamp or null when paused |
| `pause_reason` | `quota | authentication | configuration | null` |
| `error` | safe string or null |

`GET /api/flights/global` accepts **no query parameters**. Errors use the existing
structured error envelope. Responses use `Cache-Control: no-store`; the shared
application cache controls freshness. Times use UTC; coordinates use longitude,
latitude. All records must pass shared output validation. A ready response can be
empty/stale: absence does not establish empty airspace. `truncated` means the safety
bound omitted data and must be visible in UI. No claim of every worldwide flight.

## Persons 1/2 — delivered frontend and map behavior

The implemented behavior and verification are recorded in
[frontend integration](../../frontend/docs/flights-overlay.md) and
[map integration](../../frontend/docs/map-handoff.md), with this interface linked
from `frontend/docs/research-handoff.md`. The frontend polls Atlas every
60 seconds when enabled and visible, respecting a later `retry_at`; use five
seconds for any initial waiting response. Null retry plus pause_reason stops
polling until an explicit user retry or capability/configuration reload. Off/hidden
cancels viewer requests; late responses cannot overwrite current UI state.
Panning/zooming causes no flight requests, resets or area filtering. Remove the
circle, 500-aircraft cap, “Zoom in” message, and area-capacity UI in global mode.
Use server-provided history directly, not a second browser history accumulator.

The adapter admits only en-route positions at most five minutes old (30 seconds
future clock tolerance). Current markers expire at observation age ten minutes;
frontend must also enforce expiry between polls, so hidden/paused caches cannot
leave markers indefinitely. Backend excludes aircraft absent from its newest
snapshot. Snapshot becomes stale after six minutes or refresh failure. Keep
selected missing/expired details with their last observation time and unavailable
explanation. First snapshot can have no drawable trails. Last-known details are
not retained current markers.

Keep Flights off by default, yellow toggle, single side panel/Back, mobile bottom
sheet, no camera movement on selection, and news/evidence layers visible. Show
snapshot and observation times, AirLabs attribution/link and partial coverage.
Label “Global airline traffic” and “Observed positions · last 30 minutes”. Reported
departure/arrival airport codes are not observed route endpoints. No additional
airport database, route interpolation, delay/emergency or schedule lookup calls.

### Map behavior

Render every returned current aircraft using shared Mapbox GeoJSON sources/layers;
no DOM marker per aircraft or zoom sampling. Render subtle yellow dashed trails
for all displayed aircraft, with brighter/thicker selected marker/trail. At least
two real points are needed; server points are observations, not a complete path.
Break across gaps >11 minutes, changed callsign or flight_iata, and implied speed
>1,200 knots; split date-line crossings. Do not use the old two-minute gap rule.
Keep one-second shortest-path transitions, snap across broken segments/reduced
motion, and restore custom sources/layers after style changes. No predictive
movement or airport-to-aircraft lines. Test 7,500 aircraft and the 25,000-record
safety boundary on desktop/mobile; backend batch checks do not prove browser FPS.

## Person 3 — runtime and safety

Private `backend/.env` now selects `FLIGHTS_PROVIDER=airlabs`; existing private
`AIRLABS_API_KEY` is preserved. Set `FLIGHTS_ENABLED=true` explicitly; restart to
reload configuration. The committed example remains disabled with ADSB.lol as its
default. AirLabs does not require `FLIGHTS_CONTACT`; ADSB.lol still does. No provider
calls occur at startup, before schemas exist, or without HTTP demand.

Every due request shares one five-minute refresh. The provider adapter requests
only needed fields, has a 16 MB body bound and normalizes up to 25,000 aircraft
from at most 50,000 upstream rows, reporting truncation. Deduplication uses latest
observation per hex ID. History is shared process memory, 30 minutes, at most eight
points per aircraft and 25,000 histories. A restart clears snapshots/history.
Single-process operation is required; no migration or external cache was added.

A persistent ledger defaults to `backend/.flight-budget/` (stable for source/build
and working directory), ignored by Git. Optional `FLIGHTS_BUDGET_DIRECTORY` should
be an absolute durable private path. Each attempt reserves budget atomically before
fetching, including failed/timed-out attempts. The cap is 900 total demo attempts,
not a monthly auto-reset. Reusing a backend after restart reuses the ledger. Never
delete/reset it as routine troubleshooting. Other uses of the key also consume the
provider's allowance; this guard counts this Atlas deployment only.

Ledger corruption, I/O failure or an existing writer lock pauses access without a
provider call. A crash can leave a lock: inspect the ledger and ensure no writer
is running before manual recovery; never discard attempt counts. Directory/file
permissions are restricted. The lock prevents concurrent ledger writes; running
multiple processes remains unsupported because their snapshots are independent.

Provider authentication/quota/envelope-configuration rejection pauses the process;
fix underlying setup before restarting. Other failures retain the previous sample,
mark it stale, and back off from five minutes to one hour, honoring a longer
Retry-After. Shutdown cancels shared work; cancellation by one viewer does not.
No raw provider envelope, account details, credential URL, or error body is exposed.

## Evidence and verification

Two earlier authorized free-key diagnostics returned HTTP 200. The unfiltered
snapshot had 7,221 unique IDs: 6,717 en-route, 259 scheduled, 245 landed. The account
reported type free and a 1,000-request monthly limit. Those diagnostics were not
run through this new adapter and are not an end-to-end integration claim. Five
minutes costs 288 calls/day; this is a capped hackathon demo, not continuous free
monthly operation. Initial history is empty; five-minute samples cannot establish
the complete flown path. No additional live request was made during implementation.

Implementation validation: backend typecheck and production build passed; all
204 backend tests passed, including localhost HTTP/shutdown checks. Global tests
cover normalization at 7,500/25,000 aircraft and explicit truncation, 30-minute
history, coalescing, cancellation, restart-persistent budget, corruption/locks,
HTTP query rejection/no-store and fail-closed shared-contract access.

Backend behavioral tests use injected synthetic provider data and an explicitly
opaque contract port. The 13 checks in `contracts/test/backend.test.mjs` additionally
exercise the actual compiled registry and backend loader. Its global case runs the
real AirLabs normalizer, GlobalFlights service and Fastify routes with injected
responses: discovery advertises global with both legacy flags false; two viewers
share one refresh; a second snapshot adds shared observations; ready, unavailable,
paused and nullable output validates. It also checks no-query/no-store behavior,
credential/account exclusion and missing-contract rejection before budget access.
These are synthetic integration checks, separate from the earlier provider diagnostics.

Frontend verification covers camera-independent scheduling, retry/pause persistence,
cancellation and late responses, local expiry, retained missing details, bounded
keyboard search, provider units/attribution, continuity and style lifecycle. The
recorded local browser checks use real App/AtlasMap/Mapbox with synthetic data and
external requests blocked at desktop/mobile viewports, including 7,500/25,000
aircraft. They do not establish live provider/browser operation.

## Runtime reconciliation — October 18, 2026

At `2026-10-18T05:17:39Z`–`05:17:56Z`, local-only inspection confirmed AirLabs
selection, explicit flight enablement, an existing backend-only key, and the
absolute default persistent budget directory. No configuration or credential value
was printed or changed. The rebuilt registry loads `FlightGlobalResponse`, AirLabs
`AircraftState` fields and optional `flight_global` through the actual backend loader.

The default `.flight-budget/` directory, `usage.json` and writer lock were absent.
The ledger-accounted baseline is therefore zero; this says nothing about earlier
diagnostic or other account usage. Inspection did not initialize a ledger, reserve
an attempt or reset anything. Recheck immediately before a live run and preserve
whatever ledger then exists.
The final read-only check at `2026-10-18T05:19:53Z` again found no ledger or lock;
this reconciliation added zero ledger-accounted attempts.

One listener was observed on the configured local backend port, with the frontend
also listening. No additional application server was started and no explicit
runtime restart or provider/database request was made. On-disk configuration and
fresh-process contract loading do not establish what that existing process loaded.
At this preflight stage, runtime workspace discovery and live browser acceptance
were **not run — awaiting separate live-check authorization**. The authorized
result below supersedes that status.

Reverification on this date: 28 contract tests, 13 actual backend compatibility
checks and 153 frontend tests passed, with contracts/frontend typechecks and builds.
Backend typecheck/build and all 204 backend tests passed. The initial sandboxed
run could not bind sockets for nine localhost lifecycle tests (`EPERM`); rerunning
with localhost socket permission passed the entire suite. Tests use injected responses;
no automated check accesses a provider or database. The existing frontend bundle
size warning remains.

### Bounded live acceptance procedure

The user separately authorized this procedure after reviewing the preflight.

1. Inspect the persistent ledger read-only and record its attempt count (zero only
   when absent), lock state and UTC timestamp. Preserve counts and configuration.
   Confirm one backend process; do not start a second worker. Keep Flights off in
   existing viewers, then restart that backend once to load the rebuilt contracts.
2. Confirm runtime workspace discovery reports `flight_global: true`, `flights:
   false` and `flight_areas: false`. A discovery request must not spend flight
   budget. If discovery/configuration fails, stop and record it.
3. Open two visible browser windows against that backend, one desktop and one
   mobile viewport. Record the start time and a deadline eight minutes later
   before enabling Flights in both. Capture only normalized response metadata:
   UTC times, snapshot IDs, item/trail counts, status, retry/pause fields and safe
   failures. Never capture the upstream envelope or credential-bearing URL.
4. Confirm the initial snapshot ID/data agree in both viewers and the ledger
   increased by exactly one attempt. Verify yellow markers, source details/units,
   unchanged selection camera, Back, and preserved news/research/evidence.
5. Wait for the server's next permitted refresh, approximately five minutes after
   success. Confirm one additional upstream attempt serves both viewers with the
   same next snapshot. For persisting aircraft, inspect whether shared real
   observations yield drawable trails. Missing trails are inconclusive when no
   aircraft has two usable observations.
6. **At most two upstream attempts total, including failures; stop within eight
   minutes.** Disable Flights in both windows as soon as the second attempt is
   accounted for. If paused, unavailable or deferred beyond the deadline, record
   the result and stop without another attempt. Do not use extra flight curl
   probes, bypass retries, reset quota, switch providers or provision resources.
7. Compare the final ledger with the baseline (delta at most two). Check normalized
   browser responses and backend logs for absence of credentials, account metadata,
   raw provider envelopes and credential-bearing URLs without printing sensitive
   matches. Record both window toggle states and any failures here and in the
   frontend handoff. Route map defects to Person 2 with sanitized payloads and
   exact reproduction steps; do not claim a live pass from synthetic evidence.

### Live result — October 18, 2026

**Shared-refresh acceptance passed; complete live browser acceptance is partial.**
One existing backend watcher was stopped and one built backend process started
with the preserved private environment and rebuilt contracts. At
`2026-10-18T05:23:46.171Z`, runtime `/api/workspace` returned HTTP 200 with
`flight_global: true`, `flights: false`, and `flight_areas: false`. Discovery spent
no flight budget. Two separate visible Chrome windows used the ordinary API entry
at 1440×960 and 390×844, with the configured Mapbox style, not the synthetic harness.
Mobile is viewport emulation on the same host, not a physical-device result.

| Refresh | Attempt reserved UTC | Snapshot / fetched UTC | Aircraft / histories | Histories with two observations |
| --- | --- | --- | ---: | ---: |
| Initial | `05:26:19.876Z` | `airlabs-1792301181259` / `05:26:21.259Z` | 6,391 / 6,391 | 0 |
| Next permitted | `05:31:23.733Z` | `airlabs-1792301485057` / `05:31:25.057Z` | 6,310 / 6,310 | 5,831 |

Both viewers received identical snapshot IDs and complete normalized payload
SHA-256 digests on each refresh (`f917c9b8a0c9…` initially, `b4b50738458c…` next).
The second response reached the mobile query cache at `05:31:25.330Z` and desktop
at `05:31:25.457Z`. The initial response permitted the next refresh at
`05:31:21.259Z`; neither viewer bypassed that gate. Both responses were ready,
fresh, unpaused and untruncated. Each viewer's browser resource entries contained
exactly two flight requests, both `/api/flights/global`, with no regional or fixture
fallback. Response observation read validated Query data without extra flight probes.

The ledger baseline at `05:22:44.068Z` was absent (zero Atlas-accounted attempts).
At `05:36:43.791Z`, it contained **2 attempts, delta +2**, last modified at the
second reservation above, with no lock present. Directory/file modes were 0700 /
0600. The ledger was never reset or replaced; earlier account diagnostics are
outside this deployment ledger.

Browser evidence:

- Yellow markers rendered against the configured dark Mapbox globe. Desktop's
  initial source retained all 6,391 aircraft, with 1,988 rendered features at the
  inspected camera; normal globe clipping applies. Global mode had no coverage
  circle. Camera changes and local aircraft search added no flight requests.
- Both viewers selected live aircraft `006019` / `LAM130` through local search.
  Details showed AirLabs attribution/source, meters with reference unknown,
  unavailable groundspeed, Direction, reported airport codes, observation/fetch
  times and the route/status limitations. Selection preserved exact center/zoom
  in both viewers. Desktop news source data remained unchanged.
- Mobile used a bottom sheet, retained its news source, and had document width
  390 at viewport width 390. The news list remained usable with Flights enabled.
- After provider access stopped, cached second-snapshot inspection on mobile at
  `05:35:10.875Z` found all 6,310 aircraft, **5,808 actual map trail segments** and
  291 rendered trail features at that camera, with no coverage circle. Thus shared
  observations produced drawable trails; this later inspection made no API request.
- Normalized payload scans found no credential-field/account/envelope patterns or
  credential-bearing URLs. The backend's local log was separately checked against
  the actual private key and for credential URLs/account envelopes; all checks
  were negative. No raw upstream envelope or credential value was printed or saved
  as a check artifact. HTTP no-store/query-rejection coverage remains the separately
  passing automated route check; live response headers were not captured.

**Interruption and cleanup:** native Chrome control intermittently rejected actions
after another browser window became active. After the ledger reached two, the
backend was terminated cleanly to guarantee no further provider calls. It was
confirmed stopped before `05:34:13Z` (under eight minutes from the first attempt;
the exact shutdown UTC was not captured). Cached browser inspection and UI cleanup
continued afterward. The temporary desktop cutoff switched Flights off; the
temporary mobile cutoff could not find its checkbox after the popover closed.
Mobile was then disabled manually. This was a check-script limitation, not an
observed product defect, and the entire UI cleanup did not finish within eight minutes.

Flights off, removal of aircraft/trail sources, and preservation of news sources
were verified at `05:35:38.736Z` mobile and `05:36:24.350Z` desktop. Both dedicated
test tabs were then closed. **The backend is left stopped**, and the persistent count remains
2. Back navigation into an existing investigation and dated-evidence preservation
were not completed before the interruption; their synthetic tests remain passing,
but they are not claimed as live passes. No map-specific defect was established.
No additional attempts, restarts, provider substitution or quota reset were used
to fill these gaps.

Synthetic checks remain authoritative for induced failures, expiry, continuity
breaks, reduced motion and the 7,500/25,000-aircraft load cases. No migration,
import, deployment, new provider or frontend credential is included in this check.

References: [AirLabs flights](https://airlabs.co/docs/flights),
[AirLabs terms](https://airlabs.co/terms-of-service). Provider response terms prohibit
reselling data as-is. Keep attribution; do not add a bulk export/resale product.

---

# Previous area implementation (retained compatibility reference)

# Live aircraft area queries — backend implementation and owner handoff

Person 3 implemented the backend consumer, ADSB.lol adapter and behavioral tests.
Person 1 has now supplied the shared area schemas; Person 1 owns frontend
integration and Person 2 owns map layers. Full live browser operation has not been
verified by this backend workstream. A direct Node diagnostic on October 18 verified
that a contact-bearing User-Agent receives HTTP 200 with 40 aircraft, whereas the
default Node User-Agent received HTTP 403 requesting valid contact information.
After applying the fix, the actual adapter loaded private configuration and the
shared contracts and received HTTP 200 with 34 normalized aircraft. The running
server separately returned an unavailable sample; restart it after updating the
environment to reload configuration and clear cached failures.
No database change, import, resource provisioning or deployment was performed.
`FLIGHTS_ENABLED` remains false in the example; actual contact is configured only
in the ignored private backend environment.

## Implemented backend

`GET /api/flights/area?latitude=43.71&longitude=-79.41&radius_nm=97`

The endpoint validates with the authoritative `FlightAreaQuery`, calls the same
flight cache service used by existing region queries and validates output with
`FlightAreaResponse`. Until those two exports exist it returns the normal 503
`CONTRACTS_UNAVAILABLE` envelope before calling a provider. There is no backend
copy of a production domain schema. Existing `/api/flights` and `/api/flights/find`
HTTP/Gemini interfaces retain their current schemas and response shapes.

Area centers round to the nearest 0.1 degree; +180 longitude canonicalizes to -180.
Radii round upward to the next 5 nautical miles, capped at 100. The example above
queries and returns the circle centered at 43.7, -79.4 with radius 100 nautical
miles and ID `area-43.7--79.4-100`. Near-identical viewer requests share that sample.
The reported circle is authoritative: rounding does not promise coverage of the
entire input viewport. Points outside the queried circle are rejected locally.

The two active cache slots and global provider budget are shared by area queries
and legacy configured regions. Due requests queue fairly by request age. Any
incoming flight request can start the oldest queued refresh; no background timer
exists. A cancelled viewer cannot cancel a shared provider request. Requesting a
third active area returns 429 `FLIGHT_REGION_CAPACITY` and a `Retry-After` header.
An entry unused for two minutes can be replaced; age/expiry still apply to retained
positions. Panning through several areas quickly can therefore temporarily exhaust
capacity. A moving viewer should keep its last result visibly stale and honor retries.

| Setting | Default | Meaning |
| --- | --- | --- |
| `FLIGHTS_ENABLED` | `false` | Provider activation remains explicit |
| `FLIGHTS_CONTACT` | unset | Required when enabled: contact email or HTTPS URL |
| `FLIGHTS_REFRESH_INTERVAL_MS` | `60000` | Successful refresh interval per area |
| `FLIGHTS_GLOBAL_INTERVAL_MS` | `30000` | Minimum time between any provider requests |
| `FLIGHTS_MAX_ACTIVE_REGIONS` | `2` | Total configured-region/area cache slots |
| `FLIGHTS_AREA_IDLE_MS` | `120000` | Idle replacement / queued-demand expiry |
| `FLIGHTS_STALE_AFTER_MS` | `120000` | Sample or position stale threshold |
| `FLIGHTS_CACHE_TTL_MS` | `300000` | Sample/position expiry |

Set `FLIGHTS_CONTACT` in private `backend/.env` to a real email or HTTPS contact
URL. The adapter sends `User-Agent: Atlas/0.1 (contact: VALUE)` on both region and
area requests. Missing contact when enabled, invalid contacts, non-ASCII/control
characters and malformed header-comment syntax fail configuration validation.
Contact is not returned in API responses or included in application logs. No
flight API key is used. Keep real contact details out of committed examples.
Restart the backend after changing the setting to reload the environment and clear
cached failure backoff. A provider timeout remains distinct from a 403 rejection.

Provider requests have the existing deadline and 2 MB response bound. Failure
preserves a good sample, marks it stale and applies shared exponential backoff plus
Retry-After. A bounded sample has at most 500 aircraft. Area responses report
`truncated` when normalization or upstream counts indicate omitted rows. Legacy
responses retain their existing 500-item shape and cannot express truncation;
new map consumers must use the area endpoint. Aircraft are deduplicated by ICAO
address using the latest observation, with stable ID ordering for the bounded list.

## Person 1: authoritative contracts to supply

Integrate the following into `contracts/`, rebuild its runtime export, and then
restart the backend. These are interface requirements, not an alternate schema.

- `FlightAreaQuery`: strict object; required finite number `latitude` (-90..90),
  finite number `longitude` (-180..180), and integer `radius_nm` (1..100). No extra
  fields. HTTP normalizes ordinary signed decimal coordinates and unsigned integer
  radius; blank, exponential, hexadecimal and repeated values remain invalid.
- `AircraftState`: preserve all existing fields. Add optional nullable
  `registration` (trimmed string, maximum 32), `aircraft_type` (trimmed string,
  maximum 16), `operator` (nullable string), and `on_ground` (nullable boolean).
  They must be optional so existing region payloads and fixtures remain valid.
  The area adapter always emits all four, with explicit nulls when unknown.
- `FlightAreaResponse`: strict object with every field below required.
- `WorkspaceResponse.capabilities`: add optional boolean `flight_areas`. The
  backend emits it only when this property is declared in the authoritative
  workspace schema. Its value requires enabled flights, an area adapter, and the
  new query/response schemas. Existing `flights` and `flight_regions` stay intact;
  area availability does not require any predefined regions.

| Response field | Type / semantics |
| --- | --- |
| `area` | Existing `FlightRegion`, the actual canonical queried circle |
| `items` | `AircraftState[]`, at most 500 |
| `fetched_at` | UTC `Z` timestamp or null when no successful sample exists |
| `status` | `waiting`, `unavailable`, or `ready` |
| `stale` | Boolean; true when missing, old, or affected by a provider failure |
| `truncated` | Boolean; true means this is a limited subset |
| `mode` | Literal `live`, identifying the provider mode, not freshness |
| `replay` | Literal false |
| `attribution` | Provider/license/partial-coverage text |
| `retry_at` | UTC `Z` timestamp; earliest next useful attempt, not a guarantee |
| `error` | Safe string or null |

`waiting` means no successful sample yet and the request is queued behind the
shared gate. `unavailable` means its initial provider attempt failed. `ready` means
there has been a successful sample, possibly stale or expired; consumers must also
inspect `stale`, timestamps and `items`. An empty array does not establish empty
airspace. HTTP errors use the existing structured envelope; capacity and legacy
no-sample errors additionally include `Retry-After`. Responses use `Cache-Control:
no-store`; the application cache owns freshness.

Registration uses provider `r`, aircraft type uses `t`, and operator is currently
always null: no operator data source has been integrated. Callsigns are not verified
passenger flight numbers. Numeric altitude, including zero, implies `on_ground:
false`; `alt_baro: "ground"` implies true and a null numeric altitude; missing
altitude implies null. Existing `heading` contains provider `track`: label it
**Ground track**, not aircraft heading. Units remain feet and knots.

## Persons 1 and 2: frontend and map integration

- Add an aircraft toggle, off by default, enabled via `flight_areas`. Keep legacy
  region controls only for old servers. Use a separate API method/query key for
  area payloads and no automatic fallback to fixtures.
- After map movement settles (300 ms), request the map-center circle sized to the
  viewport, rounded up to an integer and capped at 100 nautical miles. At globe
  scale show only this actual circle with “Zoom in for aircraft coverage”. If the
  capped circle does not cover the viewport, keep the boundary visible.
- Poll ready samples at max(60 seconds, server `retry_at`); waiting/unavailable
  samples retry at max(1 second, server `retry_at`). Honor HTTP `Retry-After` for
  429/503. Stop polling when disabled or the document is hidden. Abort obsolete
  requests; never apply an old area's response to the new area.
- Keep server responses in TanStack Query. Maintain bounded derived observation
  history in the flight hook, outside persisted Zustand state: 30 minutes,
  60 samples per aircraft, 1,000 aircraft maximum; evict least recently observed
  histories. Use provider + aircraft ID, deduplicate repeated observation times,
  and do not append old samples. Turning the layer off clears history; reload
  starts fresh. A hidden tab adds no samples and retains only bounded history.
- Draw one GeoJSON line source for trails of **all currently displayed aircraft**,
  plus the existing symbol source. At least two valid observations are needed for
  a line. Label these “Observed session trails”, with no promise of flight start.
  Break segments when observation gaps exceed two minutes, callsign changes, or
  movement exceeds 1,200 knots. Split date-line crossings to prevent a line across
  the globe. Do not extrapolate across missing coverage.
- Transition markers between new samples over one second, using shortest-path
  longitude/track rotation. A new observation interrupts an existing transition
  from the currently drawn point. Disable transitions for reduced motion and
  across segment breaks. Details and trail vertices always use actual observations;
  animation does not create evidence points. No continuous predictive motion.
- Extend the existing aircraft panel with registration, type, operator/unknown,
  ground state, ground track, observation/fetch times and attribution. Preserve
  aircraft selection separately from investigation selection. Expired aircraft
  disappear from the current layer; explain unavailable details honestly.
- Restore the circle, markers and trail layers after style changes. Keep flight
  histories independent of map style lifecycle. Mobile rendering must retain the
  same sample limits; no DOM marker per aircraft and no trails for expired points.

## Verification and activation

Behavioral tests use injected provider results and an opaque contract port for
pending area payloads. They cover queue fairness, coalescing, capacity/idle
replacement, cancellation/shutdown, backoff, stale observations, bounded batches,
identity/ground values, duplicate IDs, truncation, provider clocks and HTTP retry
headers. The actual existing shared schemas are exercised for legacy normalization
and fail-closed activation. The actual shared schemas now validate synthetic legacy
and enriched area samples, including explicit null metadata. A registry without
area schemas still rejects access before any provider request. Header tests verify
that both adapter methods send the configured contact identity and do not return
that contact in aircraft data.

Validation after the contact fix: backend typecheck and production build passed.
All 192 backend tests passed in the approved full regression run, including the
localhost HTTP/server tests. No external provider was called by these tests;
the live adapter verification above was a separate bounded diagnostic.

After Person 1 integrates schemas, run a compatibility test using those actual
exports for valid/error area responses, nullable metadata, optional legacy fields
and workspace capabilities. After Persons 1 and 2 integrate the UI, verify toggle,
visibility, polling/retries, late-response rejection, trail breaks, memory limits,
style restoration and reduced motion in browser tests. A separately authorized,
bounded live-provider smoke check is still required before claiming live operation.
No provider access is triggered at process startup.

Provider review references:
[ADSB.lol API license](https://www.adsb.lol/docs/open-data/api/),
[published usage terms](https://raw.githubusercontent.com/adsblol/api/main/src/adsb_api/app.py),
[public endpoints](https://raw.githubusercontent.com/adsblol/api/main/src/adsb_api/utils/api_v2.py),
[response fields](https://raw.githubusercontent.com/adsblol/api/main/src/adsb_api/utils/models.py),
[readsb timestamp/track definitions](https://github.com/wiedehopf/readsb/blob/dev/README-json.md),
[ODbL license](https://opendatacommons.org/licenses/odbl/1-0/).
Access is free with dynamic limits; no fixed availability or refresh SLA is assumed.
No public all-aircraft snapshot was found in the reviewed route definitions, so this
implementation uses the agreed explore-anywhere bounded-area fallback.
