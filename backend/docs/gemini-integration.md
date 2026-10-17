# Gemini and research integration — 2026-10-17

Main `9b592cd` supplies the authoritative research/assistant/flight schemas and frontend. This backend branch consumes those definitions directly. Core contract readiness is complete; no private domain schemas or changes to frontend, contracts, migrations, seed definitions or provider-source definitions were needed.

## Live verification

The existing Tiger DEV connection passes verified TLS and `/api/health` returns 200 `ready`. Read-only HTTP checks returned the complete Helene investigation (10 articles, 9 evidence records, 7 linked key observations, 5 series, 4 locations, 23 sources), raw observations and a compatible endpoint comparison. One UTC-day discharge query returned 98 readings; the returned endpoint difference was 81,800 ft3/s. These are historical stored observations, not a current flood reading or a complete-period aggregate.

The production `POST /api/assistant` now returned real Gemini `mode:live`, no errors and server-resolved original citations:

- A narrow headline question returned a one-sentence WBTV attribution in about 3.1 seconds, citing `art-wbtv-boil-water-lifted` / `src-wbtv-boil-water-lifted`.
- A full selected Helene investigation with Asheville constraints and journalist perspective returned a short explanation in about 4.1 seconds, with four validated original WLOS/WBTV source/record pairs and zero actions.

The browser also displayed a real answer with six original source links, and loaded all 1,921 raw readings in the French Broad discharge series. Two subsequent consented map/filter action requests returned labeled `GEMINI_UNAVAILABLE` fallbacks with no workspace changes. Action authorization/validation and stale-request rejection pass injected-model tests; successful real-provider action execution remains unverified because those live calls failed.

These are separate from automated model doubles and the earlier two-turn `verify:gemini` diagnostic. `mode:live` identifies real model generation; the accompanying coverage remains `mode:stored`, `live:false`. Citation validation proves retrieved source/record relationships and original URLs; it does not automatically prove every sentence or inference. Research suggestions must remain distinct from established facts.

Earlier smoke attempts encountered model truncation, opaque configuration rejection, provider 503 high demand, and a premature socket disconnect. Invalid/failed synthesis returned a labeled fallback with no actions. Final smoke results above were obtained after the configuration/schema/socket fixes; provider availability and quota can still vary.

## Configuration and runtime fixes

Private `backend/.env` retains the existing credentials and handoff paths; only bounded AI/HTTP settings were updated. Matching non-secret example values:

```dotenv
AI_MAX_CONTEXT_BYTES=128000
AI_REQUEST_TIMEOUT_MS=50000
REQUEST_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=8192
# Set only when the chosen model supports this option:
GEMINI_THINKING_LEVEL=low
```

Person 1's complete investigation exceeds the default 64 KB context budget. The deliberate 128 KB setting includes original source metadata plus tool declarations; larger context still fails closed. Output tokens remain bounded (512–16,384 configurable; default 8,192), automatic continuation/retries are disabled, and thinking levels use the official SDK enum. Google documents that [thinking consumes the output-token limit](https://ai.google.dev/gemini-api/docs/generate-content/thinking.md); the former 2,048 cap truncated a real answer.

Production requests use ANY mode with only declared tools, including shared-schema `respond` finalization. Model-facing schema projection omits cumulative `maxItems` hints to avoid a [reported Gemini grammar-compiler rejection](https://github.com/googleapis/python-genai/issues/2170). Authoritative schemas are untouched; every actual tool argument, citation/action array and final response retains runtime bounds. No values are silently clamped into a successful response.

The socket inactivity timeout now exceeds Atlas's whole-request processing deadline. Previously the fixed 10-second socket timeout could close a valid non-streaming Gemini response before the 50/60-second deadlines. The structured deadline and real client-disconnect cancellation remain in place. For this test handoff the built backend runs via `npm --prefix backend start`, avoiding watcher restarts when contracts are rebuilt; frontend runs on Vite at port 5173.

## Workspace discovery

`GET /api/workspace` validates `WorkspaceResponse` from the shared registry and returns stored theme/entity labels, explicit investigation/article links and reviewed flight regions. It makes no provider calls. The optional backend-owned SQL read uses Person 4's frozen tables from `002_records.sql`, caps each list at 100 and infers no links from titles. It never alters or hides missing core query plans. Capability flags describe implemented/configured interfaces, not provider health; flights remain false and `series_filter` remains false (queries use location + metric).

## Backend behavior improved

- The model can finish through `respond`, whose arguments use Person 1's authoritative AssistantDraft schema. It is a structured finalization step, not a retrieval/action executor. It must be the only call in its turn. The old JSON-text path remains validated for compatibility; neither path bypasses citation/action checks.
- Missing output contracts are rejected before retrieval/provider work. Retrieval tools are advertised only when their required schemas are available. Disabled flight tools and unauthorized workspace actions are not offered.
- Active keyword and semantic constraints are preserved alongside location/theme/entity/bounds/publication constraints. Equivalent ID sets, case/whitespace-equivalent keywords, and equivalent UTC instants do not produce false conflicts. Empty filters remain unconstrained. Changing an existing constraint requires an authorized `set_filters` action.
- Model-facing schemas are derived from the shared draft-07 definitions: metadata is removed, local references are inlined, and tuple arrays become prefixItems. No remote schema references are fetched. Recursive/unknown references fail safely. Runtime validation continues against the original shared schemas, without coercion or stripping unknown fields.
- Original model content and thought signatures are retained for tool-response round trips. Thought text is excluded from answer text. Truncated/blocked responses fail safely. Context limits include tool definitions, and returned model content has a byte bound.
- Auth/model/request/quota failures return sanitized diagnostics. A 429 starts a 60-second backoff shared by requests to that Assistant instance; manual results remain available and no pending actions are returned. This is process-local, not a distributed quota service.
- Repeated actions are deduplicated before enforcing the eight-action cap. Every distinct action still receives shared validation and known-location checks.
- Valid HTTP POST bodies reach the assistant. The pinned Fastify request signal aborted when IncomingMessage.close fired after body completion. Atlas uses its own lifecycle deadline and actual request/response disconnect events. Real socket tests verify successful JSON POSTs, structured 503 deadlines and cancellation after body upload. The merged AssistantRequest schema now loads normally.

## Test locally

Start from the repository root. Build contracts before consumers and preserve the populated private environment:

```bash
npm --prefix contracts run build
npm --prefix backend run check
npm --prefix backend run build
npm --prefix backend start
# In another terminal:
npm --prefix frontend run dev
```

At http://127.0.0.1:5173/: News → select the WBTV Asheville story → Open investigation. Timeline reads raw USGS observations; Ask about this opens the assistant with the selected investigation. Select General public, Journalist or Investor for emphasis. Permit workspace changes only when testing an intentional filtering/focus request; otherwise keep consent unchecked.

```bash
curl http://127.0.0.1:3001/api/assistant \
  -H 'Content-Type: application/json' \
  -d '{"request_id":"test-helene","message":"Explain the historical water outage with original sources and state a documented limitation.","timezone":"America/Toronto","filters":{"location_ids":["loc-asheville-nc"],"limit":10},"selected_investigation_id":"inv-helene-asheville-2024","audience":"general_public","allow_ui_actions":false}'
```

This consumes real generation quota. Provider failures are explicitly labeled and do not silently use fixture output. The optional diagnostic `AI_REQUEST_TIMEOUT_MS=60000 npm --prefix backend run verify:gemini` makes at most two model calls and verifies canonical search/manual parity plus citation resolution, without writing to the database.

## Validation and remaining setup

99 backend tests pass, including new catalog/shared-schema, SDK output/thinking, schema-bound enforcement and socket-deadline regressions. Source/test typechecks, production build and configuration check pass. Person 1's 10 actual backend-compatibility tests and 41 frontend tests pass; frontend build passes with its existing bundle-size warning. Test providers/models are injected doubles, not evidence of live provider integration.

Core handoff is no longer blocked on Person 1. Embedding generation is still unconfigured/unverified, flight activation still awaits ADSB.lol usage/polling review, and worldwide mapped coverage still needs reviewed sources and source-backed location links. Daily aggregation and deployment remain separate handoffs. No commits, pushes, provisioning or deployment were performed.
