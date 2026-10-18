# Person 2 map handoff

The full frontend is runnable independently in explicit historical fixture mode. Follow `../README.md` for startup. This is the Person 1 integration boundary; the implemented map subtree remains owned by Person 2.

## Component contract

Implement `AtlasMap` using `AtlasMapProps` from `../src/app/map-interface.ts`, importing `Article`/`Location` types from `@atlas/contracts`. Mapbox GL JS and its types are already installed. Person 2 can import `mapbox-gl/dist/mapbox-gl.css` within the map feature. Person 1 wires the finished component into `App` through its `MapComponent` prop, replacing `MapSlotPreview`.

The component receives current-page articles and resolved locations, selection IDs, `auto|map|satellite` preference, status/coverage, missing-location IDs, and an optional camera command. Render only supplied records and retain article/location ID associations for selection. A location may represent several articles. Broad geometry must not become a precise event pin. The preview does not prescribe styling or geographic rendering.

The map must not fetch Atlas records or import Zustand. `App` supplies the canonical data once through TanStack Query. Status distinguishes loading, ready, empty, and error, plus refreshing/cached data. Show coverage limitations and honor explicit null geometry/timestamps.

## Events and lifecycle

- `onSelect({articleId, locationId})`: stable current-page IDs, with null for absent selections. When both are supplied, the article must reference that location. `App` rejects unknown IDs and creates a sourced camera command.
- `onInspectCoordinates([longitude, latitude])`: coordinates from a map click. This does not assert building identity or replace investigation selection.
- `onViewportChange({bounds,center,zoom})`: publish at movement end, including programmatic movement. Keep animation-frame state and the Mapbox instance local. Bounds use `[west,south,east,north]`; preserve crossing/out-of-range values so the shell can disable unsupported searches. Never silently reorder or clamp a crossing viewport into a different region.
- `onCameraCommandHandled(id)`: acknowledge once when a command is accepted/handled, including a no-op. Dedupe command IDs locally. The store clears only a matching outstanding ID, so a delayed acknowledgement cannot clear a newer command. User navigation interrupts any active camera animation; report its resulting viewport without issuing a new command.

Camera intents are `fit_bounds`, `focus_point`, and `return_to_globe`, each with a unique ID. Prefer bounds when supplied; city/region focus must preserve its extent. Choose point zoom from the map's supported precision and visual context; no arbitrary backend zoom or generated coordinates are accepted. Honor reduced motion. Return-to-globe preserves filters and selection.

Keep one map instance. Data, selection, and camera-command acknowledgement updates must not recreate it or reset its camera. Reattach custom sources/layers after style changes while preserving data/selection. Dispose listeners and the map on unmount, including React StrictMode remounts.

Aircraft selection remains separate in the store; aircraft/evidence data inputs will be added with their future schemas/hooks. Do not create private API types or enable provider requests to fill those gaps.

## First integration verification

Run fixture mode, verify map and feed use the same page, select in both directions, focus a sourced city extent, pan without changing the feed, and return to globe without clearing filters. The Search this area button has been removed. Verify the renderer tolerates missing locations, loading/empty/error states, and repeated React renders. Actual Mapbox navigation, attribution, precision, reduced motion, style restoration, and token restrictions remain Person 2's checks when rendering is implemented.

## Implemented interface additions

The map accepts measured `overlayInsets`, a validated local `evidenceOverlay`, typed `aircraft`, `selectedAircraftId` and `onSelectAircraft`. The browser may send a bounded relative `zoom` camera command. Viewport snapshots identify user-initiated navigation so the shell does not offer area search after every programmatic move. Multi-article locations emit a null article ID with the location ID, opening the associated current-page news list.

Home framing preserves a complete centered globe on desktop and accounts for bottom-sheet occlusion on smaller screens. No-token mode does not instantiate Mapbox or contact its servers. Basemap rendering, style restoration and image placement still need provider-backed smoke verification with separately authorized access.

## Yellow flight overlay

The shared interface now includes enabled state, authoritative coverage circle, attribution, oversized-view status, retained-position IDs and readonly observed trail segments. Fetching/history stay in `useFlightOverlay`; Mapbox owns symbols, dashed lines and one-second transitions. See [flight integration](flights-overlay.md) for the implemented boundary and synthetic verification.

## Global airline snapshot integration

The **Global airline snapshot** section of the [backend handoff](../../backend/docs/flights-area-handoff.md) supersedes area-only behavior when `flight_global` is true. `AtlasMapProps.flightMode` is optional (`global | area | region`); existing aircraft, trails, selected ID and selection callback remain the interface. Global supplies null coverage and empty retained-marker IDs. Map internals neither fetch nor accumulate observations. All current aircraft and supplied trail segments enter shared sources without sampling or caps; natural globe clipping still applies.

`observationsConnect(a,b,mode)` in `src/lib/flight-observations.ts` is the shared continuity authority: global allows 11-minute gaps and requires unchanged callsign/flight identifier; regional keeps two minutes. Both reject >1,200-knot implied motion. Trails split at the date line. One-second marker transitions interrupt from the currently drawn position and snap across breaks/reduced motion. They stop at observations, with no predictive movement. Selected aircraft/trails stay stronger; unknown direction uses a neutral dot. Aircraft click membership uses a cached Set and wins over overlapping news features.

Global never installs a coverage circle, including after style changes. Style reload restores both sources, all data and selection. Disable/unmount removes flight sources/layers and cancels animation. Source updates skip unchanged geometry and age/attribution-only renders. Trails update only with their geometry or selection; marker animation writes at most 30 times per second and leaves no idle flight frame loop.

### Measured synthetic browser evidence — October 18, 2026

Actual App/AtlasMap/Mapbox with a local empty style, all external requests blocked. Each aircraft had eight real synthetic observations spaced four minutes apart within 30 minutes. Counts below are GeoJSON input counts; globe occlusion is expected. The safety boundary retained every record. Desktop and mobile are Chromium viewport sizes on the same host, without CPU throttling.

| Viewport | Aircraft / trails | Shared-schema validation | Generate → sources loaded | Marker writes during 1 s transition | Idle flight source writes (1.1 s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1440×960 | 7,500 / 7,500 | 31 ms | 313 ms | 24 | 0 |
| 1440×960 | 25,000 / 25,000 | 87 ms | 814 ms | — | 0 |
| 390×844 | 7,500 / 7,500 | 29 ms | 280 ms | 23 | 0 |
| 390×844 | 25,000 / 25,000 | 79 ms | 668 ms | — | 0 |

Animation frame intervals at 7,500 averaged 20.8 ms desktop / 20.7 ms mobile, with p95 17.6 / 17.5 ms (initial generation contributes a long frame). Mobile input-to-next-frame samples at 25,000 were 14.6 and 2.0 ms. Search never rendered more than 50 matches. Mobile details used the existing 374×321 px bottom sheet with 390 px document width, and its body remained scrollable. Source replacement restored all 7,500 markers/trails and selected ID with no circle. Keyboard selection preserved exact center/zoom, missing selection retained details while source counts dropped to zero, panning added zero flight requests, and disabling retained news sources.

An additional real canvas click with a news point drawn above the same aircraft selected the aircraft and preserved exact center/zoom. With browser reduced motion enabled, a five-minute snapshot update made one marker-source write and snapped to its observed coordinate.

These measurements verify synthetic/local operation, not a browser FPS guarantee on physical devices, remote style loading, provider operation or continuous free quota. See [browser harness](../test/browser/README.md) for reproduction. Unit checks additionally cover interrupted/reduced-motion animation, gap/identity/speed breaks, date lines, 7,500/25,000 counts, style restoration and absence of idle updates. Person 3's subsequent [bounded live result](../../backend/docs/flights-area-handoff.md#live-result--october-18-2026) verifies shared refreshes, yellow markers, source details, unchanged selection cameras and actual server trails; it records browser-control/cleanup deviations and incomplete live Back/dated-evidence acceptance. No map-specific defect was established.
