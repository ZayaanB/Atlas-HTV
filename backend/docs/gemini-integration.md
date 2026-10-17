# Gemini backend integration — 2026-10-17

Work is on `feat/zayaan/gemini-grounded-assistant`, based on main `1962b2a`. Backend changes only; shared contracts, frontend, migrations, credentials and provider definitions are preserved.

## What is now verified live

```bash
AI_REQUEST_TIMEOUT_MS=60000 npm --prefix backend run verify:gemini
```

This explicitly consumes Gemini generation quota; it is not run on app startup or by the test suite. The diagnostic made two real model turns using the configured official Google Gen AI SDK client:

1. Gemini called `search_news` against canonical stored retrieval, with active Asheville + `water` constraints. Arguments were validated with the existing shared NewsQuery schema. Manual and tool results matched.
2. Gemini selected a source/record pair through diagnostic-only `cite_record`, using the existing shared CitationReference schema. The server checked that the article was returned, the source belonged to it, and its URL/title resolved from the stored Source record. The final Citation passed the shared schema.

Verified citation: `art-wbtv-boil-water-lifted` → `src-wbtv-boil-water-lifted`, [Asheville boil water advisory lifted nearly 2 months after Helene](https://www.wbtv.com/2024/11/18/asheville-boil-water-advisory-lifted-nearly-2-months-after-helene/).

The result reports `generation_verified:true`, `canonical_tool_verified:true`, `manual_filter_parity:true`, `citation_verified:true`, `data_mode:stored`, and **`assistant_api_verified:false`**. The diagnostic does not generate a narrative briefing, apply UI actions, verify the timeline, or bypass missing AssistantRequest/Draft/Response contracts. `cite_record` is not a production assistant tool or public endpoint. Historical source data remains historical.

The diagnostic ran with a 60-second overall CLI deadline. Production defaults remain a 20-second AI deadline and 30-second HTTP deadline; no production-latency claim is made from this probe. It performs read-only SQL, makes at most two generation calls, prints no credentials/raw provider errors, and closes its pool. Missing configuration exits 2, failed checks exit 1, success exits 0.

## Backend behavior improved

- The model can finish through `respond`, whose arguments use Person 1's authoritative AssistantDraft schema. It is a structured finalization step, not a retrieval/action executor. It must be the only call in its turn. The old JSON-text path remains validated for compatibility; neither path bypasses citation/action checks.
- Missing output contracts are rejected before retrieval/provider work. Retrieval tools are advertised only when their required schemas are available. Disabled flight tools and unauthorized workspace actions are not offered.
- Active keyword and semantic constraints are preserved alongside location/theme/entity/bounds/publication constraints. Equivalent ID sets, case/whitespace-equivalent keywords, and equivalent UTC instants do not produce false conflicts. Empty filters remain unconstrained. Changing an existing constraint requires an authorized `set_filters` action.
- Model-facing schemas are derived from the shared draft-07 definitions: metadata is removed, local references are inlined, and tuple arrays become prefixItems. No remote schema references are fetched. Recursive/unknown references fail safely. Runtime validation continues against the original shared schemas, without coercion or stripping unknown fields.
- Original model content and thought signatures are retained for tool-response round trips. Thought text is excluded from answer text. Truncated/blocked responses fail safely. Context limits include tool definitions, and returned model content has a byte bound.
- Auth/model/request/quota failures return sanitized diagnostics. A 429 starts a 60-second backoff shared by requests to that Assistant instance; manual results remain available and no pending actions are returned. This is process-local, not a distributed quota service.
- Repeated actions are deduplicated before enforcing the eight-action cap. Every distinct action still receives shared validation and known-location checks.
- Valid HTTP POST bodies now reach the assistant. The pinned Fastify request signal aborted when IncomingMessage.close fired after body completion. Atlas now uses its own lifecycle deadline and actual request/response disconnect events. Real socket tests verify successful JSON POSTs, structured 503 deadlines and cancellation after body upload. The local endpoint now reports the actual missing AssistantRequest schema with 503, rather than a false 408 cancellation.

## Remaining Person 1 handoff

Main still exports only the news/location/source/citation foundation. The public assistant route returns an explicit missing-schema 503 until the authoritative contracts arrive. Prioritize these 11 names:

`AssistantRequest`, `AssistantDraft`, `AssistantResponse`, `UIAction`, `FocusLocationArgs`, `InvestigationQuery`, `InvestigationResponse`, `ObservationsQuery`, `ObservationsResponse`, `CompareObservationsArgs`, `Observation`.

Their existing field requirements are in [contracts handoff](contracts-handoff.md); database envelope details are in `db/README.md` and the frozen `db/handoff/database.mjs` projections. AssistantRequest supports request_id/message/timezone and optional filters/selected_investigation_id/allow_ui_actions/audience. Citation references contain source_id/record_id; the backend supplies URLs/titles. UI actions support only set_filters and focus_location. No private replacement contracts were added to backend.

Person 1 should wire the assistant/investigation/timeline UI, cancel obsolete requests, discard stale IDs before applying actions, and show fallback/coverage/source labels. Flight schemas can follow separately. A full generated explanation and UI-action integration remain unverified until these handoffs arrive; citation provenance validation alone does not prove every generated sentence.

## Tests

All **94 backend tests pass**, plus source/test typechecks and the production build. Behavioral tests cover SDK request configuration, retained signatures, thought-text exclusion, truncated/blocked/API failures, schema projection without mutation/network access, filter preservation/equivalence, structured finalization, missing-contract preflight, quota backoff, citation rejection, diagnostic tool allowlisting, context bounds, action deduplication and real HTTP POST/deadline/disconnect behavior. Test model/provider data is synthetic; the real diagnostic above is separate.

The copy-paste request for Person 1's AI is saved in [person-1-ai-request.md](person-1-ai-request.md). No teammate messages, commits, pushes, provisioning or deployment were performed during this slice.
