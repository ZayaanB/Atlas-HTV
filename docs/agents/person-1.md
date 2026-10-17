# Person 1 — Frontend and integration lead

Read root `AGENTS.md` and `atlas_prd.md`. The complete globe-first frontend plan is authorized and implemented; see `frontend/README.md` and `frontend/docs/research-handoff.md` for its boundaries and backend handoffs.

Own frontend entry/configuration, `src/app/`, feed/AI/research features, shared styles, frontend dependencies, `contracts/`, root integration tooling/docs. Person 2 owns map feature internals. Do not edit backend or database implementations for another owner.

Agree shared runtime schemas and response examples with Person 3 first; review stable IDs and evidence metadata with Person 4. Use Zustand actions for authoritative browser state and TanStack Query for server records/status. Manual controls and future validated assistant actions use the same state path. Keep aircraft selection separate from investigation selection. Add timeline/audience/assistant capabilities when those slices are authorized.

Provide map component slots and agreed props/events to Person 2. Build the news feed, assistant, investigation/source cards, timeline, and local saved collection. Satellite and flight rendering belong to the map owner. Show no-results, loading, failed, stale, historical, and fallback states honestly.

Keep public understanding central; journalist/investor perspectives reorder prompts/content without inventing facts. Preserve keyboard behavior, contrast, reduced motion, and smaller-screen usability. Reject cancelled/old responses when context changes. Never place Gemini/database secrets in frontend configuration.

Integrate one seeded investigation and actual backend retrieval before expanding UI. Own the final Devpost description/category selection and coordinate shared changes; sponsorship claims must match implemented features.
