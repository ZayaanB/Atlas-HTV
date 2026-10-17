# Prompt for Person 1's AI

Implement the remaining shared contracts and frontend integration needed for Person 3's Gemini assistant and Tiger timeline. Implementation is authorized for your workstream.

Read AGENTS.md, your role guide, contracts/README.md, backend/docs/contracts-handoff.md, backend/docs/gemini-integration.md, backend/docs/ui-integration-handoff.md, and db/README.md. Inspect current files and preserve teammates' work.

Keep contracts/ as the single authority. Continue the existing JSON Schema + inferred TypeScript approach; do not create parallel frontend/backend schemas or permissive placeholders.

Prioritize these missing schemas:

- AssistantRequest, AssistantDraft, AssistantResponse
- UIAction, FocusLocationArgs
- InvestigationQuery, InvestigationResponse
- ObservationsQuery, ObservationsResponse
- CompareObservationsArgs, Observation

Match the existing backend payloads and frozen database projections. Preserve nulls, source IDs, units, geographic precision, and distinct timestamps. Include the investigation's evidence, observation series, and sources. Existing contracts already provide NewsQuery, Article, Location, Source, CitationReference, Citation, and Coverage.

AssistantRequest needs request_id, message, timezone, and optional filters, selected_investigation_id, allow_ui_actions, and audience: general_public | journalist | investor. Bound strings/arrays. AssistantDraft is the model-only answer/citation-reference/result-ID/action object; the backend derives its respond tool declaration from that schema. AssistantResponse includes resolved citations, coverage, errors and live/fixture/fallback mode. Preserve the current HTTP error envelope.

UIAction supports only:

- `{type: "set_filters", filters: NewsQuery}`
- `{type: "focus_location", location_id: string}`

Wire the assistant panel to POST /api/assistant, the investigation panel to GET /api/investigations/:id, and the timeline to GET /api/observations. Use shared validation and existing workspace state. Abort obsolete requests and discard stale request IDs before applying actions. Workspace changes require explicit allow_ui_actions. Show citations, original source links, fallback/error states, coverage, units, and historical-data labels. Audience changes explanation emphasis without silently changing filters or facts.

Add meaningful validation/UI tests and update the stale map-preview test. Keep Gemini/database credentials server-side. Do not modify backend/, migrations, or Person 2's map implementation.

Flight schemas can follow separately; do not add placeholders to force readiness. Report the branch/PR, schema names delivered, tests run, and exact remaining dependencies. Do not commit, push, or deploy without authorization.
