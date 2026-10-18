# Assistant v2 delivery — Person 1

**Superseded for the production frontend by [assistant v3](../../backend/docs/assistant-v3.md).** V2 remains available for legacy consumers and its regression tests. V3 includes actual viewport/filter/panel/result context, independent research scope, structured references and pending replies; browsing preserves answers and holds stale actions. Historical delivery notes below describe v2.

**Current citation behavior, per user request:** sources are optional. The backend preserves answer text/numbering and returns whichever original sources it can resolve; unavailable markers stay plain text. The frontend no longer rejects answers for missing, unused or unresolved references, uncited paragraphs or heading format. Source links match their explicit number, including gaps. Transport/HTTPS schemas, request IDs, cancellation and workspace action preflight remain checked. Earlier strict-citation descriptions below are delivery history, superseded by this policy. All builds/typechecks, 161 backend tests, 78 frontend tests, 26 schema tests and 11 backend compatibility checks pass after the simplification; no live provider/database request was made.

Current backend research is [tool-first and bounded](../../backend/docs/assistant-research.md). The browser still preserves full conversation text and sends up to six complete exchanges, while the backend initially includes at most two within 4,000 bytes and retrieves older supplied exchanges through `read_history`. Partial answers expose the existing response error/coverage UI. Returning from a timed-out writing phase to research clears abandoned preview text before the final streamed answer begins. No visual layout or public protocol change is needed.

Verification after this research update: 78 frontend tests, 161 backend tests, 26 shared schema tests and 11 actual contract/backend compatibility tests pass, with zero skips; all typechecks/builds pass. The local offline profile starts research at about 10–12 KB and peaks below 14 KB for its two scripted historical scenarios. New provider declarations and full live streamed research have not been smoke tested. The existing Mapbox bundle advisory remains.

Delivered 2026-10-17 against [Person 3’s handoff](../../backend/docs/assistant-v2-handoff.md). No backend implementation, database schema, provider adapter, deployment, or map internals were changed by this frontend work.

## Contracts and transport

The authoritative eight exports/types are `AssistantRequestV2`, `AssistantIntent`, `AssistantFilterPatch`, `OpenTimelineArgs`, `UIActionV2`, `AssistantDraftV2`, `CitationV2`, and `AssistantResponseV2`. Build `contracts/` first to emit the local registry, declarations and JSON Schema. Strict Ajv validation neither coerces nor removes unknown fields. V1 stays available to legacy consumers and continues rejecting v2 context.

The browser posts to `/api/assistant` with version 2 and intent mode on every question. It never sends `allow_ui_actions` and never downgrades. Catalog discovery/capability flags are optional and cannot establish v2 readiness. `CONTRACTS_UNAVAILABLE` exposes setup/manual-search recovery. Structured HTTP codes, request IDs, retryability and abort signals are retained. Generation and action requests are never retried automatically.

## Conversation and evidence

`useAssistantSession` lives in App above panel navigation. It owns drafts, audience, full completed responses and request state; Zustand contains workspace IDs/query intent only. Selection changes, closing the assistant, audience/context changes, cancellation and New conversation invalidate pending fetches and target resolution. Completed conversation/drafts survive panel navigation. Explicit suggestions have fresh prompt request IDs, including repeated identical selections. New conversation clears only session state. Retry replaces the failed/fallback attempt for the same user turn with a new request ID.

Requests capture current IDs even while browser records load. `selected_bounds` comes only from chosen search bounds, never the viewport. History contains a contiguous suffix of eligible complete exchanges: at most six, each message at most 4,000 Unicode characters, and a complete serialized request at most 65,536 UTF-8 bytes. Failed/cancelled/pending/fallback turns are excluded. Packing stops at the first oversized exchange; stored text is never truncated. The UI discloses omitted history. An oversized base request leaves the draft untouched and asks for simplification. Nothing force-scrolls a reader reviewing older content.

Answers are escaped plain text with a `[n]` tokenizer. Numbering and source relationships known to the browser are checked; backend-resolved records need not have loaded beforehand. Inline links and ordered source cards open original HTTPS URLs in new tabs. Three cards appear initially with an accessible expansion. Publication instants, date-only publications, observation instants/ranges and periods retain separate labels and honest missing values. Factual answers require supporting references; statuses and clarification are kind-aware. Fallbacks have no actions or invented explanation. Coverage and historical/fixture labels remain visible; live generation over stored evidence is labeled accordingly.

## Workspace and timeline

Every response is validated before preflight. All location IDs resolve through bounded typed queries; timeline IDs resolve through TanStack Query and verify linked series/source/location metadata. Any target failure rejects the whole action batch. After asynchronous work, request, abort and context/conversation revisions are checked again. The accepted request retires before one Zustand transaction publishes its revision, so an answer cannot cancel its own actions.

Filter actions replace the effective query through canonical normalization. Search summaries never act as filter changes and returned counts never derive from result IDs. Undo restores the prior filters alone and expires after a later manual filter change. Focus uses stored geometry, updates subsequent “here” context, and keeps only selections supported by stored relationships. Aircraft selection stays independent.

Timeline suggestions stay in chat until Open timeline is selected. Only explicit `open_timeline` actions navigate automatically. Both use the same validation and fresh navigation ID, preserve filters unless a filter action is present, open the Timeline tab and retain Back to the conversation. Timeline opening issues no camera command. A later chart failure leaves valid navigation/actions in place.

Exact assistant timestamps are stored and used verbatim in observation/comparison query keys and requests. The visible exact UTC range may include the backend’s timezone/label when it describes that range. Date inputs are separate replacement drafts; only valid explicit Apply replaces the active range with whole UTC days. Invalid/partial/blank edits retain the chart/range. Changing series restores its bounded default. Observation provenance, units, missing readings/gaps, table access, truncation and endpoint-only comparison limits remain intact. No selected-series request field was added.

## Activation

```sh
npm --prefix contracts run build
npm --prefix backend run build
AI_MAX_ROUNDS=6 npm --prefix backend run dev
npm --prefix frontend run dev
```

The backend needs `ATLAS_CONTRACTS_MODULE=contracts/dist/index.js` through its existing configuration. Restart it after the contract build. The existing local backend `.env` was updated only for `AI_MAX_ROUNDS=6`; populated credentials/other entries were preserved. No provider/database probe was run with those credentials. A built backend was started and stopped separately on loopback with a sanitized environment, no `.env`, and six rounds to confirm the v2 registry loads and accepts a validated v2 request before returning the expected structured `DATA_UNAVAILABLE` error. A disconnected database is reported as an HTTP error rather than an invented answer.

For offline exploration, `npm --prefix frontend run dev:fixture` returns a validated v2 fallback and makes no provider request. It is not a simulated chatbot.

## Verification

- Contracts: typecheck/build passed; 23 schema tests passed, preserving all v1 checks.
- Contract/backend integration: 11 tests passed, including all eight schemas and local model projection.
- Backend: source/test typechecks and build passed; 128 tests passed, zero skipped. The formerly skipped real-v2 compatibility test ran successfully. Local HTTP tests required loopback socket access beyond the restricted sandbox and passed with it.
- Frontend: typecheck/build passed; 67 tests passed across eight files. Coverage includes Unicode byte packing, long-answer retention, v2-only requests, missing contracts, citations, complete action preflight, late fetch/target cancellation, accepted-answer transaction ordering, focus context, retry/reset/Undo, exact DST ranges, explicit UTC Apply, reopening another series/range, Back and chart failure after navigation.
- Bounded native Chrome review at desktop (1440×960) and phone (393×852), using an injected local adapter and map preview: long answers, six sources, date-only/missing metadata, errors/recovery, clarification, and explicit timeline navigation. Impeccable detector returned no findings; independent finish review disposition: ship within this evidenced scope. The documenter confirmed the incumbent design needs no change; existing design-document format/sidecar drift was left untouched. Local captures are retained in `.impeccable/review/desktop.png` and `mobile.png`. Browser extensions and map-preview background are excluded from product UI review.
- Vite retains the existing Mapbox vendor chunk-size advisory; the map stays lazy loaded.

Live Gemini generation, actual database retrieval, source ingestion, production latency and deployed Mapbox behavior remain separately authorized verification. No migrations, imports, embeddings, flight activation, paid/provider calls, deployment or publishing were performed. Injected-model/fixture tests do not establish a live integration.

## Streaming and citation correction — 2026-10-17

The browser now requests `text/event-stream` on the existing v2 POST. `AssistantStreamEvent` is an additional authoritative shared schema and inferred type; the eight v2 definitions above remain intact. Status and `answer_delta` events update the pending turn. Partial text is escaped, has no active citation links, is excluded from history, and is removed after cancellation, interruption or rejection. A single validated `complete.response` replaces it; existing citation checks and atomic action preflight still run before acceptance. No action is applied from a delta, progress event or search summary. An adapter returning JSON can still supply the same validated v2 response without an additional request or protocol downgrade.

The stream parser handles UTF-8, CRLF and JSON boundaries across arbitrary network chunks, checks every event/request ID and final response, bounds the stream/frame/preview size, and requires a terminal response. Interrupted answers preserve the question for a manual retry with a fresh request ID. Generation requests are never retried automatically. Reading near the bottom follows the answer; scrolling up preserves the reading position. One persistent status region outside the busy answer announces phases, completion, clarification or fallback recovery; individual tokens stay silent. The independent review's sole accessible-completion finding was fixed and scored resolved in a scoped code verdict. Fixture mode remains the existing labeled fallback and makes no provider request.

The backend resolves every supplied source/record pair before normalizing references actually used. It removes unused valid entries, combines duplicate source/record pairs, numbers citations in first-use order, and rewrites the corresponding literal references. It never supplies a source for a missing reference. Explicit short headings can be uncited; factual paragraphs still require references. The browser retains strict sequential/used-number, provenance and known-URL contradiction checks. Citation rejection now permits manual retry.

Current verification: contracts typecheck/build and 24 schema tests; 11 real backend compatibility tests; backend typechecks/build and 142 tests; frontend typecheck/build and 77 tests, all passing with zero skips. New coverage includes the official SDK with a stubbed streaming transport, progressive real-loopback HTTP delivery, truncation, disconnect/deadline cancellation, Unicode/escape boundaries, rejected-preview removal, final action ordering and reading-position preservation. The existing Mapbox bundle-size advisory remains. The UI detector returned no findings.

Fresh desktop/mobile screenshot verification could not complete: native Chrome control repeatedly timed out or reported a changed application; the in-app browser was unavailable. Earlier screenshots document the pre-streaming panel only. A temporary offline review harness was removed. Full provider-backed streamed/sourced generation is still unverified; no provider/database request was made for this streaming change. The earlier explicitly approved synthetic probe confirmed model/tool-schema access only; see the backend diagnostic handoff.
