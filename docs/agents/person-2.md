# Person 2 — Map and visuals

Read root `AGENTS.md` and `atlas_prd.md`. The approved frontend implementation plan now authorizes dark cartography, responsive globe framing, sourced location layers, evidence and bounded aircraft rendering.

## First step

Use the agreed map interface and preserve the root no-provider-call/no-deployment boundaries. Keep map/data validation and external setup claims distinct.

Own `frontend/src/features/map/`. Implement Mapbox GL JS as the sole geographic renderer with an original Atlas style, globe/local zoom, clusters, boundaries, source-backed pins, satellite labels/toggle, evidence overlays, and aircraft symbols. Review any 21st.dev source/license before reuse; it is inspiration, not a second renderer.

Consume Person 1's shared state/contracts and emit selection/camera events. Person 1 owns dependencies/global styles/contracts; request changes there instead of editing concurrently. Person 3 provides locations, flights, and validated camera actions. Person 4 supplies imagery bounds/dates/legends/attribution and verified geographic content.

Preserve camera/selection/custom layers during basemap-style changes. Map/Satellite/Auto honors manual choice. Broad city/region stories keep broad geometry; arbitrary map clicks show coordinates, not invented building identity. Source-backed facility pins may use precise locations.

Flights are a bounded layer with visible freshness/coverage; keep aircraft and investigation selection separate. Rotate aircraft by available heading; no guessed future positions, routes, or delay claims. Exit optional follow mode on manual navigation.

Verify globe-to-local transition, style reload/restoration, date-layer alignment, precision labels, attribution, keyboard access, and reduced motion when implemented. Decorative effects are cut before useful evidence exploration.
