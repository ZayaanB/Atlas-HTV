# Person 2 — Map and visuals

Read root `AGENTS.md` and `atlas_prd.md`. Current phase is scaffold/docs only; implementation needs a later explicit start instruction.

## First step

Until implementation is explicitly authorized, review the existing map scaffold and shared contracts, then list the map inputs and events needed from Persons 1, 3, and 4. Once authorized, begin by confirming those interfaces before implementing the map feature.

Own `frontend/src/features/map/`. Implement Mapbox GL JS as the sole geographic renderer with an original Atlas style, globe/local zoom, clusters, boundaries, source-backed pins, satellite labels/toggle, evidence overlays, and aircraft symbols. Review any 21st.dev source/license before reuse; it is inspiration, not a second renderer.

Consume Person 1's shared state/contracts and emit selection/camera events. Person 1 owns dependencies/global styles/contracts; request changes there instead of editing concurrently. Person 3 provides locations, flights, and validated camera actions. Person 4 supplies imagery bounds/dates/legends/attribution and verified geographic content.

Preserve camera/selection/custom layers during basemap-style changes. Map/Satellite/Auto honors manual choice. Broad city/region stories keep broad geometry; arbitrary map clicks show coordinates, not invented building identity. Source-backed facility pins may use precise locations.

Flights are a bounded layer with visible freshness/coverage; keep aircraft and investigation selection separate. Rotate aircraft by available heading; no guessed future positions, routes, or delay claims. Exit optional follow mode on manual navigation.

Verify globe-to-local transition, style reload/restoration, date-layer alignment, precision labels, attribution, keyboard access, and reduced motion when implemented. Decorative effects are cut before useful evidence exploration.
