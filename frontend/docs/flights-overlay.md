# Global airline traffic integration

Implements the **Global airline snapshot** section of the [authoritative backend handoff](../../backend/docs/flights-area-handoff.md). The older area interface remains supported for compatible servers. Flights starts off. The initial frontend delivery used synthetic checks; the subsequent separately authorized live result is recorded below. No frontend credentials, migrations or deployment were added.

## Shared contracts and discovery

`@atlas/contracts` exports strict `FlightGlobalResponse`, the compatible `AircraftState` extensions, and optional `WorkspaceResponse.capabilities.flight_global`. Global responses allow 25,000 aircraft and 25,000 histories, with at most eight real points each. Every response property is required, including nullable snapshot/fetch/retry/error fields and `pause_reason`. UTC, longitude–latitude, closed objects, units and enums are validated through the normal registry/build.

AirLabs records carry meters, unknown altitude reference, `direction_kind: direction`, airline/flight identifiers, reported airport codes and `AirLabs-terms`. Speed and operator names remain unavailable unless actually supplied. Legacy ADSB.lol payloads remain valid with feet, barometric altitude and Ground track; added identifiers remain optional.

`resolveFlightMode` prefers `flight_global === true`, independently of legacy flags. Otherwise, explicit `flight_areas === true` uses areas; absent area capability plus legacy flights/configured regions uses region controls. Explicit false does not enable legacy fallback. Global failures never switch mode, region, provider or fixtures. A capability/API mode change cancels work, clears the previous mode's cache, and exits aircraft selection.

`flightGlobal(signal)` calls only `GET /api/flights/global` without parameters, with abort propagation and shared-schema output validation. HTTP errors retain their structured envelope and Retry-After timing.

## Scheduling, freshness and trails

Global server responses stay in TanStack Query under `[api.mode, 'flight-global']`; the last ready response is also retained under its `snapshot` child key. Neither key depends on camera, bounds, zoom or selected aircraft. UI selection remains separate in browser state. Query retry/focus/reconnect mechanisms cannot bypass the explicit scheduler.

When enabled and visible, fetch immediately, then wait for the later of 60 seconds or server `retry_at`. Waiting responses have a five-second minimum. Retryable HTTP failures wait at least 60 seconds and honor a longer Retry-After. Hidden/off cancels the viewer request and rejects late results, including adapters that ignore cancellation. Retry gates and pauses survive hidden/off cycles. A non-null pause with null retry stops polling. **Check again** makes one Atlas request while paused; the backend still enforces its provider pause and quota. It cannot bypass an active HTTP retry gate.

Only aircraft in the newest ready snapshot can become global markers, and observations expire at ten minutes. HTTP failures preserve the last ready snapshot; a newer snapshot immediately removes absent aircraft. Snapshot age over six minutes or a refresh failure marks it stale. A local clock and expiry timer enforce expiration while polling is paused, and visibility/toggle restoration immediately recomputes eligibility. Age-only updates keep aircraft/trail references stable and do not rewrite GeoJSON.

Global mode uses server observations directly, without browser accumulation or the regional 500-aircraft/1,000-history caps. Trails keep the last 30 minutes, need two points, and break across gaps over 11 minutes, changed callsign/flight identifier, or implied speed above 1,200 knots. Geometry splits at the date line. `observationsConnect` is shared with the renderer so animations obey the same rules. Drawing boundary vertices do not become historical observations.

Missing or expired selection keeps only that aircraft's last-known details until leaving the panel. Missing aircraft never return as retained global markers. Selection and Back preserve research/news/evidence and the camera. Local search requires two characters, matches callsign/flight identifier/registration/hex ID, caps results at 50, and prompts refinement. It makes no network request.

Controls show Global airline traffic, displayed count, snapshot age, incomplete coverage, attribution/link, stale/paused state and explicit truncation. Empty samples do not establish empty airspace. Details use actual units, provider source links and honest unknown values. Airport codes do not generate lines or route claims. Trails are labeled **Observed positions · last 30 minutes**.

## Map boundary and compatibility

`AtlasMapProps` retains aircraft/trail/selection props and adds optional `flightMode: 'global' | 'area' | 'region'`. Global passes null coverage, no missing-marker IDs, and every eligible current aircraft. Map internals never fetch or accumulate history. Shared GeoJSON sources draw yellow aircraft, a neutral dot for unknown direction, subtle dashed trails and stronger selected features. Global mode never creates or restores a circle source/layer.

One-second observed-to-observed transitions use shortest longitude/track paths, interrupt from the drawn position, snap across continuity breaks/reduced motion, and stop at the reported endpoint. Animation source updates are capped at 30 per second; no idle flight frame loop remains. Style replacement restores sources, trails and selection; disable/unmount cancels work. See [map handoff](map-handoff.md) for performance evidence.

Area/legacy compatibility remains separate: 300 ms camera settling, canonical 0.1-degree centers and upward five-mile circles capped at 100 nm, ready polling ≥60 seconds, waiting/unavailable ≥1 second, HTTP capacity backoff, the preceding successful circle while another area loads, and bounded session history. Regional history retains 30 minutes/60 samples/1,000 aircraft histories, displays at most 500 within coverage for five minutes, and uses the original two-minute continuity rule. Off clears regional caches/history; server backoff survives toggles. Old region controls and source labels remain available only under the discovery rules above.

## Validation and runtime handoff

- Contracts: 28 schema tests, typecheck/build, and 13 actual backend compatibility checks pass. Injected AirLabs normalization + GlobalFlights + Fastify discovery validate real shared schemas, ready/unavailable/paused/null/trail responses, no-store/no-query behavior, coalescing, missing-contract rejection before budget access, and absence of credential/account metadata. Existing ADSB.lol integration uses its required synthetic contact argument.
- Frontend: 153 tests cover scheduling, HTTP retry gates, hidden/off cancellation, late responses, pauses, freshness/expiry without requests, selection retention, local keyboard search, mode changes, continuity/date lines, style restoration, animation interruption/reduced motion, source counts, and idle work. Typecheck and production build pass. The existing large Mapbox bundle warning remains.
- Backend: typecheck/build and all 204 regression tests pass with injected providers. Local HTTP lifecycle tests require localhost socket permission. No provider/database calls were made by these checks.
- Browser: real App + AtlasMap + Mapbox, local empty style, synthetic data, external requests blocked, 1440×960 desktop and 390×844 mobile viewport. All 7,500/25,000 markers and eight-point trails survived; search, Back, unchanged selection camera, panning without flight requests, retained missing details, style restoration and disabling were checked. Local-only styles do not verify remote map/satellite imagery. Mobile is viewport emulation on the same host, without CPU throttling or physical-device evidence.

Reproduce with [the browser harness](../test/browser/README.md). Measured load/animation results are recorded in [map handoff](map-handoff.md). `NODE_OPTIONS=--no-experimental-webstorage` avoids this host's Node Web Storage/jsdom conflict; it does not alter the app.

Rebuild contracts before restarting the backend to activate the new exports. Synthetic tests and prior provider diagnostics remain distinct from the bounded live result below. AirLabs remains partial airline coverage, five-minute backend snapshots, shared 30-minute observations and a capped free demo, with no full-route reconstruction or continuous extrapolation.

### Runtime reconciliation — October 18, 2026

Rebuilt contracts and reran all 28 schema tests, 13 actual backend compatibility
checks, 153 frontend tests and 204 backend tests; typechecks and production builds
pass. The backend lifecycle tests passed with localhost socket permission. The frontend
acceptance cases above remain covered by injected responses. No frontend/map
implementation or synthetic browser measurements changed during this reconciliation.

Person 3's local preflight confirmed the global exports, AirLabs selection,
explicit enablement and an existing backend-only key without exposing settings or
calling a provider/database. The default persistent ledger and lock were absent;
that is zero ledger-accounted attempts, not total provider account usage. An
existing backend listener was observed; its loaded configuration has not been
verified or explicitly restarted. See the [backend runtime record and bounded
procedure](../../backend/docs/flights-area-handoff.md#runtime-reconciliation--october-18-2026).

The user subsequently authorized the two-attempt live check below. The preflight
alone did not establish live operation.

### Authorized live browser result — October 18, 2026

The ordinary API frontend ran in two separate visible Chrome windows at 1440×960
and 390×844 against one restarted backend and the configured dark Mapbox style.
Runtime discovery advertised global with both legacy flags false. Both viewers
received identical normalized payloads for `airlabs-1792301181259` (6,391 aircraft,
fetched `05:26:21.259Z`) and `airlabs-1792301485057` (6,310 aircraft, fetched
`05:31:25.057Z`). The persistent ledger increased from absent/zero to **2 attempts**,
including all attempts; each browser made exactly two global flight requests and
no regional requests or fixture fallback. Both snapshots were fresh, unpaused and
untruncated. The second had 5,831 two-point histories.

Yellow aircraft rendered; the first desktop source kept all 6,391 records with
1,988 rendered features at its camera and no circle. Both viewers searched for and
selected live `LAM130` / `006019`, displayed the AirLabs original-source link,
meters/reference unknown, unavailable speed, Direction and reported airport codes,
and preserved exact selection camera center/zoom. Desktop news source data stayed
unchanged; mobile retained a usable news list, its bottom sheet and 390-pixel
document width. Camera changes/search added no flight requests. Cached mobile
inspection after the backend stopped found 6,310 current source features, 5,808
actual trail segments and 291 rendered trail features at that camera. These are
observed-position trails, not complete routes.

Normalized response scans found no credential/account/envelope fields or
credential-bearing URL patterns. Backend log checks against the actual key and
credential/account patterns were negative. Full timestamps, snapshot comparisons,
quota/permissions and scoped leak checks are in the [backend live
record](../../backend/docs/flights-area-handoff.md#live-result--october-18-2026).

**Result: shared live refresh/rendering verified; full browser acceptance partial.**
Native browser-control interruptions prevented completing live Back navigation
into an existing investigation and dated-evidence preservation. No product/map
defect was established. Those paths retain their synthetic evidence only. The
backend was stopped after the second attempt within eight minutes of the first;
cached inspection and toggle cleanup finished later. The temporary mobile cutoff
could not act after its popover closed, so Flights was disabled manually after
control recovered. This is recorded as a check-script/cleanup deviation.

Both toggles were verified off, aircraft/trail sources removed and news sources
retained (mobile `05:35:38.736Z`, desktop `05:36:24.350Z`). Both dedicated check tabs
were then closed; the backend is left stopped, ledger preserved at 2. No additional live
attempts were made to obtain a complete pass. Mobile remains viewport emulation,
not physical-device evidence; the recorded synthetic stress/failure checks remain
authoritative for those cases.
