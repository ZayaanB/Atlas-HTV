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

Run fixture mode, verify map and feed use the same page, select in both directions, focus a sourced city extent, pan without changing the feed, apply Search this area, and return to globe without clearing filters. Verify the renderer tolerates missing locations, loading/empty/error states, and repeated React renders. Actual Mapbox navigation, attribution, precision, reduced motion, style restoration, and token restrictions remain Person 2's checks when rendering is implemented.

## Implemented interface additions

The map accepts measured `overlayInsets`, a validated local `evidenceOverlay`, typed `aircraft`, `selectedAircraftId` and `onSelectAircraft`. The browser may send a bounded relative `zoom` camera command. Viewport snapshots identify user-initiated navigation so the shell does not offer area search after every programmatic move. Multi-article locations emit a null article ID with the location ID, opening the associated current-page news list.

Home framing preserves a complete centered globe on desktop and accounts for bottom-sheet occlusion on smaller screens. No-token mode does not instantiate Mapbox or contact its servers. Basemap rendering, style restoration and image placement still need provider-backed smoke verification with separately authorized access.
