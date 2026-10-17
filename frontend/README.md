# Frontend foundation — Persons 1 and 2

React/TypeScript/Vite, Zustand, TanStack Query, native fetch, and shared JSON Schema/Ajv validation. TanStack Router is deliberately deferred. Mapbox GL JS is installed for Person 2; no map instance or provider access is implemented by this slice.

## Start from the repository root

Requires Node >=22.12 and npm. Build contracts before frontend consumers:

```bash
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix frontend ci
npm --prefix frontend run dev:fixture
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Fixture mode is explicitly selected and always labeled. It uses the committed 2024 Helene records, never fetches current news, and needs no credentials or backend. The temporary map preview lists sourced locations; development-only buttons exercise area/coordinate events without claiming geographic rendering.

For the actual backend, run `npm --prefix frontend run dev` and start Person 3's backend separately on `127.0.0.1:3001` using its README. `/api` is proxied locally and remains same-origin in production. The default data mode is `api`; `.env.local` may explicitly set `VITE_DATA_MODE=api|fixture`. The fixture launch command overrides that setting. There is no automatic failure fallback and no configurable arbitrary API origin.

Only a future restricted public Mapbox token belongs in `VITE_MAPBOX_ACCESS_TOKEN`. Never place Gemini/database credentials in Vite configuration. All `VITE_` settings are public build inputs.

## State and data ownership

- `src/app/state.ts`: canonical filters, selection IDs, viewport snapshots, basemap preference, inspected coordinates, and acknowledged camera commands. No fetched records or query loading flags. Nothing is persisted yet; saved collections are deferred.
- `src/lib/api.ts`: shared-schema validation, comma-separated GET array/bounds serialization, numeric pagination, structured errors, and fetch cancellation.
- `src/lib/queries.ts`: shared query keys/options and location batching. News defaults to 50 items; both map and feed consume that same page. Filter changes reset pagination/selection. New query keys show loading instead of stale results from a different filter.
- `src/app/map-interface.ts`: Person 2's frontend-only props/events. Domain records come exclusively from `@atlas/contracts`.

Query freshness defaults to 30 seconds with no window-focus refetch. Transient GET failures retry once; invalid payloads/ordinary client errors do not. Successful cached records may remain during a failed refresh, with an explicit notice. Location IDs are resolved in batches of 100 and paged until resolved or empty, within the existing offset limit. Unresolved IDs remain visible as limitations. Empty ID sets never issue an unrestricted location query.

Panning publishes a viewport only. **Search this area** applies bounds while preserving other filters. This slice supports ordered bounds within longitude/latitude ranges; antimeridian-spanning searches are disabled. Return to globe changes only the camera. Broad locations use sourced bounds; precise locations may use sourced coordinates.

Pagination has no matching total or fabricated end detection. Next remains available until an empty page or the backend offset cap; a short page does not prove completeness. Stored-corpus counts are labeled separately. Coverage and timestamps retain their original meaning.

## Checks

```bash
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix contracts run typecheck
npm --prefix contracts test
npm --prefix contracts run test:backend
```

An explicit fixture production build is available with `npm --prefix frontend run build -- --mode fixture`; it remains labeled. Ordinary builds use API mode unless explicitly configured otherwise.

## Remaining handoffs

Person 2 starts with [the map interface guide](docs/map-handoff.md). Map, satellite transitions, flights, imagery, assistant/actions, full investigations, timeline, saves, URL navigation, and deployment are not implemented here. Feature placeholders in their owned directories remain untouched.

News/location schemas now match the backend protocol, but 16 of its 24 required domain schemas remain missing. Overall backend readiness still fails until its remaining contracts and external setup are supplied. No live database/provider integration is claimed by the frontend tests.
