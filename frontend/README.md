# Atlas frontend

A full-screen dark Mapbox workspace with on-demand panels. The design follows the approved Night Earth · Dark reference using dark cartography instead of night imagery. Search, News and AI are the dock actions; all content uses one floating panel or a responsive bottom sheet. The robot/AI button opens the existing assistant. Map controls sit above attribution, and above the dock on narrow screens. Coverage remains available from News; explicit historical fixture labels remain visible in fixture mode.

## Run locally

Requires Node >=22.12 and npm. From the repository root:

```sh
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix frontend ci
npm --prefix frontend run dev:fixture
```

Fixture mode is explicitly labeled and works without a backend or AI credentials. It uses the committed Helene articles, source-linked investigation, dated imagery and 7,467 archived observations. The globe needs a restricted public `VITE_MAPBOX_ACCESS_TOKEN`; without it, the map has an explicit unavailable state and the reporting/research panels remain usable. No automatic fallback from API mode to fixture mode occurs.

For the backend, use `npm --prefix frontend run dev` and start Person 3's backend independently on port 3001. Same-origin `/api` is proxied locally. See [research integration handoff](docs/research-handoff.md) for the existing assistant/research endpoint contracts and exact remaining service setup. Optional catalog discovery does not gate assistant or timeline access. The frontend always uses v2/intent, with no protocol downgrade. See [assistant v2 delivery](docs/assistant-v2.md) for activation, limits, actions and verification.

## Implemented experience

- First-visit “How will you use Atlas?” onboarding offers General public, Journalist, Community organization and Investor, plus Skip for now (general public). The choice and completion flag live in `atlas.audience.v1` local storage. Returning visitors enter directly; invalid preferences show a fresh prompt, and blocked storage keeps the choice for the current visit with a short notice. No login or account is used.
- The visible Audience selector, assistant Perspective selector and investigation Perspective selector all use the existing workspace store. Modal/fullscreen panels retain an Audience control. Switching changes suggested questions and brief-section order while preserving filters, camera, selected investigation, conversation and draft. Pending assistant requests are cancelled so older actions cannot apply under a new perspective. Facts, sources and access stay identical. Community organization maps to `general_public` on the current API; see [the audience handoff](docs/audience-handoff.md).
- Centered globe/home framing, map/satellite/auto preferences, sourced markers/extents and geographic selection; one Mapbox instance.
- A high-contrast ATLAS title remains readable over map labels and imagery. After three seconds without input, the globe rotates slowly below zoom 3 (slowing above zoom 2). Pointer, wheel and keyboard input pause it; local views, inspected locations, evidence, modal panels, typing, hidden tabs and reduced-motion settings keep it still. A visible browser can rotate while focus is in the adjacent chat. Return to globe permits idle rotation again. Decorative camera frames do not trigger news retrieval or report user navigation.
- Search and News share event types, broad topics, stored topic tags, known places/entities, keyword, UTC publication dates, review status, linked-location availability and page-size filters. News exposes them through **Filters**; **Refine reporting** contains the additional options. Apply resets pagination; chips remove individual constraints and Clear filters resets them together. Map/feed/assistant use the same active filters.
- News starts with compact headline rows; the chevron expands details for one article at a time. The News header's fullscreen button expands the panel; Escape restores its size before closing it.
- One-panel Back/Close navigation, retained search drafts and scroll positions, Cmd/Ctrl+K, Escape and responsive sheet controls.
- Investigation GET integration, known-ID access, sources/local saved IDs, paged raw timeline GET integration with units/precision/nulls, chart gaps/table alternatives, and verified dated imagery overlays.
- Assistant v2 POST integration with intent-based commands, a retained in-memory conversation, numbered dated citations, atomic workspace actions, exact timeline navigation, coverage/fallback diagnostics, cancellation and stale-request rejection. Fixture mode never generates an AI answer.
- Minimal Gemini-branded chat with a separately scrolling conversation, pinned composer/perspective controls, expandable sources and response details, prompt menus, and a Latest response shortcut. Enter sends; Shift+Enter adds a line. AI, News, and Search slide in from the right on opening or switching without remounting their contents; reduced-motion preferences disable the animation. On narrow screens, chat opens taller with expansion in the header and map controls stay out of the panel.
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
