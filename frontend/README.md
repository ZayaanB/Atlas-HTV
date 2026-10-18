# Atlas frontend

A full-screen dark Mapbox workspace with on-demand panels. The design follows the approved Night Earth · Dark reference using dark cartography instead of night imagery. Search and News are the two dock actions; all content uses one floating panel or a responsive bottom sheet.

## Run locally

Requires Node >=22.12 and npm. From the repository root:

```sh
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix frontend ci
npm --prefix frontend run dev:fixture
```

Fixture mode is explicitly labeled and works without a backend or AI credentials. It uses the committed Helene articles, source-linked investigation, dated imagery and 7,467 archived observations. The globe needs a restricted public `VITE_MAPBOX_ACCESS_TOKEN`; without it, the map has an explicit unavailable state and the reporting/research panels remain usable. No automatic fallback from API mode to fixture mode occurs.

For the backend, use `npm --prefix frontend run dev` and start Person 3's backend independently on port 3001. Same-origin `/api` is proxied locally. See [research integration handoff](docs/research-handoff.md) for the existing assistant/research endpoint contracts and exact remaining service setup. Optional catalog discovery does not gate assistant or timeline access.

## Implemented experience

- Centered globe/home framing, map/satellite/auto preferences, sourced markers/extents and geographic selection; one Mapbox instance.
- Search and News share event types, broad topics, stored topic tags, known places/entities, keyword, UTC publication dates, review status, linked-location availability and page-size filters. News exposes them through **Filters**; **Refine reporting** contains the additional options. Apply resets pagination; chips remove individual constraints and Clear filters resets them together. Map/feed/assistant use the same active filters.
- News starts with compact headline rows; the chevron expands details for one article at a time. The News header's fullscreen button expands the panel; Escape restores its size before closing it.
- One-panel Back/Close navigation, retained search drafts and scroll positions, Cmd/Ctrl+K, Escape and responsive sheet controls.
- Investigation GET integration, known-ID access, sources/local saved IDs, paged raw timeline GET integration with units/precision/nulls, chart gaps/table alternatives, and verified dated imagery overlays.
- Assistant POST integration with explicit action consent, validated citations, coverage/fallback diagnostics, audience emphasis, cancellation and stale-request rejection. Fixture mode never generates an AI answer.
- Bounded aircraft layer/details with heading/unknown states, timestamps, expiry, visibility-aware polling and provider backoff.
- Persistent historical/coverage labels, missing data and recoverable error states, reduced motion and keyboard affordances.

Zustand owns browser state and IDs; TanStack Query owns server records. Domain schemas/types live only under `contracts/`. Public Vite inputs must never contain Gemini/database credentials.

Event types and broad topics are discovery aids matched against existing tags or whole English terms in the stored headline/excerpt. They can overlap and miss stories, especially non-English or sparsely described records. They do not write classifications, change review status, infer coordinates, or add sources. OR within each group, AND across groups. Publication presets mean UTC calendar days through today's end; they exclude unknown/date-only publication times. Coverage counts describe the stored collection, not a matching-result total.

## Verify

```sh
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix contracts run typecheck
npm --prefix contracts test
npm --prefix contracts run test:backend
```

An explicit historical production build is `npm --prefix frontend run build -- --mode fixture`. Ordinary builds default to API mode. Mapbox is lazily loaded; its geographic renderer accounts for the large vendor chunk. Existing provider/data setup and backend feature handoffs remain external dependencies; UI presence is not proof of a live integration.
