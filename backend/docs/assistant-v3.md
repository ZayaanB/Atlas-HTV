# Context-aware assistant v3

V3 replaces the mandatory intent-classification round and English command-verb gate with one bounded research/tool loop. V1/v2 retain their existing behavior. The production frontend sends v3 JSON or SSE to the existing `POST /api/assistant`; it does not retry generation automatically or downgrade when v3 is unavailable.

`AI_DEMO_MODE=true` removes round and tool-call caps for all assistant protocols, even when an older `.env` still specifies six rounds/eight calls. It raises the request budget to at least ten minutes, serialized model context to at least 1 MiB, output to 65,536 tokens, concurrent questions to at least eight, and model content blocks to 512 KiB. The output budget matches the [configured Gemini 3.1 Pro model's documented allowance](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview). The assistant route bypasses the twelve-requests-per-minute throttle and uses its extended deadline rather than the shorter manual-query deadline. Workspace detail pages can use 64 KiB. Research tools stay available until the model finishes or the final fifteen-second synthesis window begins; context compaction still removes whole old blocks as needed. The prompt reports uncapped counters explicitly as null and follows the requested depth.

The local ignored `backend/.env` and the fresh-checkout example enable this demo profile. Restart the backend after changing it. Set `AI_DEMO_MODE=false` to restore ordinary configured budgets; setting `AI_MAX_ROUNDS=0` and/or `AI_MAX_TOOL_CALLS=0` also independently removes those counters outside demo mode. The deadline can be raised up to one hour and serialized context up to 16 MiB through their existing settings. These byte budgets are not token counts. Stop, disconnect, shutdown and deadline cancellation remain effective. Shared schema/action/source validation, parameterized queries, provider quotas/backoff and honest coverage remain enforced. No additional provider, URL-fetching or SQL/code-execution capability is introduced.

## Context and tools

`AssistantRequestV3` includes a stable turn ID, optional opaque conversation ID, timezone, audience, bounded text history, and `AssistantWorkspaceSnapshotV3`. The snapshot carries the settled viewport, actual filter values, selected record IDs, originating content panel/tab, displayed article IDs in order, exact active timeline, basemap, enabled flight/wind layers, optional evidence-overlay ID/opacity, capability hints and flight freshness metadata. No screenshots, image URLs, article arrays or full flight samples enter the initial prompt. Selected names come from server retrieval. Client state and history are untrusted references, never evidence or authorization supplied by a source.

Research tools reuse `ResearchTools`, `Retrieval`, shared schemas, source provenance resolution, query caching, whole-block prompt compaction and bounded excerpts. Existing manual query semantics are unchanged. V3 tools are:

- `search_news`, `get_article`, `search_locations`, `search_catalog`, `get_investigation`, `get_sources`, `compare_observations`, `read_history`.
- `get_workspace_context`, `set_research_scope`, `resolve_dates`, `suggest_timeline`.
- `update_workspace` stages a complete validated action batch; no browser state changes during research. Final draft actions are forbidden. An exact unquoted current-task excerpt establishes the action basis; negations, quotes, read-only requests and standalone confirmations without a current pending task are rejected. Semantic action relevance is decided by Gemini, not a command-word list.
- `resolve_pending` resolves the one current question/proposal, checks its identity and actual reply, and revalidates proposed targets. A clarification answer resumes the original task; ordinary old history does not grant action permission.
- `get_aircraft_in_view` and `get_wind_in_view` are exposed for enabled layers and use existing services/caches. Aircraft replies contain at most five positions, timestamps, partial-coverage limits, attribution and stale/replay state. Area reads cover a reported bounded circle, not an unlimited viewport. Disabled capabilities cannot be activated through a model claim.

Research scope is independent of screen filters. Follow-ups inherit their research scope; a new subject replaces unrelated restrictions through `set_research_scope`. “Here” means the submitted viewport, “this story” the selected article, “these results” the displayed ordered IDs, and numbered conversational references use the server ledger. Relative dates use server calendar resolution in the user's timezone. The current manual query contract rejects crossing-antimeridian bounds; read searches can split them, while a single display-filter action must still use supported bounds. Empty corpus coverage is not proof that no event happened.

`UIActionV3` retains filters, sourced focus and exact timeline opening, and adds article/investigation/aircraft opening, existing basemap/layer controls, zoom and globe navigation. `GET /api/articles/:id` exposes the same validated canonical article read so a recommended story can open without replacing feed filters.

The common SDK request builder projects model hints to [Gemini's JSON Schema subset](https://ai.google.dev/gemini-api/docs/generate-content/structured-output#json-schema-support) after protocol-specific action restrictions. It converts `oneOf` hints to `anyOf`, gives scalar enums explicit types, and omits unsupported constraints. Parameterless tools omit their parameter declaration. The final draft retains `actions.maxItems: 0` and replaces its unreachable element union with a null item schema; actual actions still go through `update_workspace`. Prompt accounting uses this same projected request. The authoritative shared contracts remain unchanged and enforce all limits, exclusive unions, extra-property rejection and action validation at runtime.

HTTP 400 errors use fixed diagnostics for recognizable empty schemas, schema complexity, function declarations, structured answers, thinking configuration or invalid API keys. Raw provider messages, request content and credentials are never forwarded. Unknown rejections retain a generic configuration error; no provider call is automatically retried.

## Conversation, cancellation and browser application

Process-local conversation state stores references/scope for six completed turns and one pending task, including that task's initiating question. It stores no transcript history or evidence bodies. Pending tasks expire after 10 minutes; inactive conversations expire after 30 minutes. The map is capped at 1,000 sessions and cleanup occurs on demand. Restarting the backend loses continuation references. IDs are opaque and unguessable. Retries replace the same turn's reference entry. A version check prevents concurrent older completions from overwriting a newer conversation.

The browser retains the transcript for the visit and sends at most six eligible complete exchanges within the existing 65,536-byte envelope. Refresh and New conversation clear browser continuation identity. No persistent chat database is added.

Browsing, changing selection or closing chat preserves v3 generation against its submitted snapshot. Stop, New conversation, disconnect, timeout and unmount still cancel it. The browser checks the echoed snapshot, request ID and final schema before acceptance. Stale actions are held, not applied; a user can explicitly request revalidation/application against the current workspace. Action-target failure preserves the answer and applies no part of the batch. Success is announced only after the browser commits. Manual controls and assistant actions share state. Undo restores the preceding assistant workspace state and expires after a subsequent manual change. Existing filter-only Undo remains for v2.

## Offline verification and evaluation

Build contracts before starting/restarting either server:

```sh
npm --prefix contracts run build
npm --prefix backend run typecheck
npm --prefix frontend run typecheck
npm --prefix backend test
NODE_OPTIONS=--no-experimental-webstorage npm --prefix frontend test -- --maxWorkers=4
```

The Node option avoids Node 25's native storage conflicting with jsdom; it is for tests only. Real loopback HTTP tests require socket permission but use injected repositories/models. V3-specific tests exercise captured views/filter values, source re-reads, independent scopes, ordered references, pending replies, expiration, negation/read-only rejection, preflight, stale handling, Undo, record opening and v3 SSE. These do not measure Gemini's live understanding.

An SDK transport regression test now runs the production v3 loop through the official SDK with a local stubbed fetch: workspace context, staged basemap action, then a streamed final answer. It inspects the serialized declarations/response schema, retains thought signatures between rounds, and checks strict runtime rejection. This catches request-shape regressions without claiming provider acceptance.

An evaluator scores recorded traces without loading `.env`, creating a model/database client, or making network calls:

```sh
npm --prefix backend run evaluate:assistant -- /absolute/path/to/recorded-v3-scenarios.json
```

Input is a JSON array. Each entry has `request` (`AssistantRequestV3`), `response` (`AssistantResponseV3`) and `expected` containing `clarification` (boolean), `reference_ids` (ordered IDs), `research_scope` (complete `NewsQuery`), and `actions` (complete `UIActionV3[]`, including exact targets/values). Output is counts only: task completion, unnecessary clarifications, correct ordered references, scope correctness and action correctness. A scenario completes only when context/request identity and every expected behavior match and the response is not fallback. Scores evaluate only the supplied recordings; they do not establish factual truth, unrecorded model intent quality or production latency. Review curated cases before collecting separately authorized provider recordings.

`frontend/test/browser/assistant-v3.html` is an explicitly labeled offline UI harness with historical records and a map placeholder. It cannot invoke Gemini or fetch map tiles. See its browser README for review steps.

No migrations, imports, indexing, provider/database probes, credential edits, deployment or publishing were performed for v3. Provider acceptance of the new declarations, live intent quality and real latency still require a separately authorized smoke/evaluation run.
