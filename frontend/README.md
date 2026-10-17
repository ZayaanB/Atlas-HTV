# Frontend scaffold — Persons 1 and 2

Comment-only React/TypeScript/Vite placeholders; no manifest, installed packages, or runnable entrypoint yet. Person 1 owns configuration, shell/state, feed/AI/research UI, and shared styles. Person 2 owns `src/features/map/`.

- `src/main.tsx`: future browser mount; `src/app/App.tsx`: workspace composition.
- `src/app/state.ts`: future authoritative UI state and validated actions.
- `src/features/feed/`: news list, filters, saved investigations.
- `src/features/ai/`: assistant UI and action/source presentation.
- `src/features/research/`: brief, source cards, and timeline.
- `src/features/map/`: Mapbox lifecycle, markers, satellite/evidence/flight layers.
- `src/lib/api.ts`: future typed backend boundary using shared contracts.
- `src/styles/global.css`: shared tokens/layout owned by Person 1.

Read root/nested AGENTS instructions and the matching role guide. All data schemas are agreed through `contracts/`; no independent frontend copies. Gemini and database secrets never belong here.
