# UI/backend integration — 2026-10-17

Pulled `origin/main` through `e6eeb59` into `feat/zayaan/backend-live-setup` with a fast-forward. Existing uncommitted backend work, private environment and the user's certificate file were preserved. No teammate source files were edited, and no commits/pushes were performed.

## Verified against the actual database

Run separately from the repository root:

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

Open `http://127.0.0.1:5173/` in ordinary API mode. Do not use `dev:fixture` for this check. Dependencies are installed and the frontend build passes.

Browser checks:

- Initial feed: 10 stored articles with original source links and distinct publication/date-only/unknown-time labels.
- Search reporting `water`: 4 stored articles.
- Find known place `Asheville`: actual city and streamgage search results.
- Select `Asheville, North Carolina · city` while keeping `water`: 3 stored articles, one resolved city location, both filter chips visible.
- Coverage remains stored/historical and explicitly not live; no fixture fallback occurred.

Same-origin proxy check:

```bash
curl 'http://127.0.0.1:5173/api/news?bounds=-83,35,-82,36&limit=100'
```

Returned 10 stored articles with `coverage.live:false`.

The user subsequently supplied the public Mapbox token. It is configured in ignored `frontend/.env.local` with API mode and owner-only permissions. Vite restarted, and browser checks verified the rendered globe and feed selection focusing Asheville's sourced city extent. Auto mode switched to satellite at local zoom; the city extent and streamgage overlay were visible after the style change. This basemap is geographic context, not dated evidence of Helene. No frontend source files were changed.

## Backend fix

Spatial post-filtering previously resolved candidate locations with the default 50-row location page. It could discard valid articles later in a larger result set, or reject a news page referencing more than 100 distinct location IDs. It also queried unrestricted locations when no articles matched.

The canonical retrieval service now resolves location IDs in bounded batches of 100 with explicit pagination, validates each Location using the shared schema, skips empty lookups and reads coverage once for the response. Manual and assistant news use that same service. Regression tests cover 75 locations, 153 locations across linked articles, empty results and manual/tool parity. All 71 backend tests, typecheck and production build pass.

## Remaining owner handoffs

**Person 1:** `contracts/dist/index.js` still lacks the 16 schemas listed by `npm --prefix backend run check`: InvestigationQuery/Response, ObservationsQuery/Response, CompareObservationsArgs, FlightsQuery/Response, FindAircraftArgs, FlightRegion, FocusLocationArgs, UIAction, AssistantRequest/Draft/Response, Observation and AircraftState. The current App exposes feed/map UI; selected stories still explicitly say that deeper investigations are unavailable. Assistant, research/timeline and saves are not wired in this pull. Complete those authoritative contracts/UI against the existing backend interfaces in `backend/docs/contracts-handoff.md`; no backend-local replacement schemas were created.

**Person 1 / Person 2:** `npm --prefix frontend test` reports 14 passes and one failure in `frontend/test/workspace.test.tsx`, test `labels the fixture preview and acknowledges its camera command`. It mounts the default renderer but expects `Preview search area: Asheville` and `Camera preview: return to globe.` The default is now AtlasMap. Update this test to use the existing injectable MapComponent boundary for camera acknowledgements, or provide Mapbox mocks for a renderer integration test. This failure is separate from backend retrieval.

**Person 2:** the local public Mapbox token is now configured, and globe rendering, feed-driven city focus, Auto satellite switching and overlay restoration passed browser checks. Shared flight schemas/provider review are still required before enabling aircraft requests. The existing frontend preview test described above still needs updating by its owner.

**Person 4:** migrations 001–005 and the committed curated seed loaded successfully into the existing Tiger DEV service. Runtime reads work with verified TLS and the separate `atlas_runtime` role. No migration changes or additional data imports were made during this UI integration. The timeline API awaits contracts; its underlying 7,467 observations are already stored.

The certificate remains at the path recorded in private `backend/.env`; keep it available or update `DATABASE_CA_FILE`. Stage only the backend workstream when committing. Gemini model metadata is verified; grounded generation, embeddings and flights have not been executed.
