# Frontend research integration handoff

Person 1's shared contracts and frontend integration are implemented against Person 3's merged Gemini/backend work (main through `3f9f72e`) and frozen Person 4 `atlas-p3-v1` projections. `contracts/` is the sole runtime-schema and inferred TypeScript authority. This work does not edit backend, database/migration, or map implementation files. No external service is contacted by the checks below.

## Delivered schemas

`AssistantRequest`, `AssistantDraft`, `AssistantResponse`, `UIAction`, `FocusLocationArgs`, `InvestigationQuery`, `InvestigationResponse`, `ObservationsQuery`, `ObservationsResponse`, `CompareObservationsArgs`, and `Observation` are exported by name, with inferred TypeScript aliases. Supporting `Investigation`, `Evidence`, and `ObservationSeries` match the resolved investigation envelope. Existing core and flight definitions are preserved; no flight readiness placeholders were added.

- Requests require `request_id`, nonblank `message` (up to 4,000 characters), and `timezone` (up to 100 characters; Person 3's existing `Intl` check validates IANA names). Optional fields are `filters`, `selected_investigation_id`, `allow_ui_actions`, and `audience: general_public | journalist | investor`. No speculative conversation history or selected-article field is sent.
- `AssistantDraft` contains only answer, citation references, result IDs, and actions. It embeds the canonical NewsQuery/CitationReference definitions and has no external `$ref`, and Person 3's merged orchestrator derives the `respond` declaration from this authoritative schema without creating another model-output schema. It cannot supply citation URLs/titles, mode, coverage, request IDs, or errors.
- Actions are closed to `set_filters` and `focus_location`. Focus accepts a stored location ID, never model coordinates. Strings/arrays, paging and IDs are bounded. JSON Schema does not establish citation truth; the backend evidence ledger remains responsible for provenance and retrieved result IDs.
- Observations retain all 14 frozen fields, including nullable values/period boundaries, source/series identity, units, qualification flags, statistic, precision, observation time and fetch time. Runtime validation rejects missing fields, invalid precision/statistic combinations and one-sided null periods. Ordered ranges and relational identity remain database/service checks.
- Investigation responses include investigation, articles, evidence, observations, observation series, locations and sources. Broad geographic precision, original source links, date-only publications and explicit nulls are preserved.
- HTTP failures keep `{error:{code,message,retryable,request_id}}`; frontend `ApiFailure` preserves those values.

## Existing HTTP integration

- `POST /api/assistant`: shared validation before sending and after receiving. The panel sends the audience on every question and never changes filters in response to selecting a perspective. Filter/selection changes, cancellation, audience/consent changes and unmount abort obsolete requests. Both request ID and context revision are checked before any action, including after asynchronous location resolution. Every action is validated/resolved before any state changes; consent is required. Filter changes have an Undo control.
- The backend resolves citation sources. The browser accepts citations to records retrieved by tools even when those records were not previously loaded, rejects contradictions with known source/record relationships and URLs, and validates every link through `Citation`. It displays original source links, errors, live/fixture/fallback mode and coverage; fallback actions are rejected.
- `GET /api/investigations/:id`: validated IDs/envelope, matching response ID, loading/error/retry states, source-linked Brief/Timeline/Evidence/Sources tabs. Known IDs can be opened through News → Saved investigations → Open investigation by ID when catalog discovery is absent. Brief perspectives reorder all supplied sections; facts and sources remain available.
- `GET /api/observations`: uses the existing `location_id`, `metric`, `observed_from`, `observed_to`, `limit`, `offset` fields. The frozen database guarantees a unique series per location/metric pair; no new `series_id` query extension is required. The client pages raw rows up to 10,000, rejects mixed series/source/units/location/metric, duplicate/misordered rows and rows outside the requested UTC range, and reports truncation. Changing the range or series aborts obsolete reads. Linked key observations are an explicitly labeled, range-scoped fallback.
- `GET /api/observations/compare`: existing one-location/metric endpoint; only returned endpoints are compared. The UI checks returned endpoint IDs/units and displays the backend limitation. It never claims full-period aggregates or causality.
- Timeline: UTC date controls, gaps and nulls retained, original units, historical labels, coverage/retrieval metadata, precision/period/fetch fields, source dataset link and accessible table. Aggregate integration is not claimed.

`GET /api/workspace` is optional discovery for labeled filters, article/investigation associations and reviewed flight regions. Its failure no longer disables assistant or timeline requests. Discovery and flights remain outside this integration; existing capability fields are retained for compatibility.

## Exact remaining Person 3 / Person 4 dependencies

1. Build `contracts/` before consumers. Configure `ATLAS_CONTRACTS_MODULE=contracts/dist/index.js` and `ATLAS_DATABASE_MODULE=db/handoff/database.mjs` through backend-owned configuration. Serve the existing API on port 3001 for Vite's `/api` proxy, or under the same origin in deployment.
2. Real Tiger-backed reads require server-only `DATABASE_URL`, the required CA/TLS configuration, and the frozen Person 4 schema/data already provisioned/imported by its owners. This change does not execute migrations/imports or verify a database connection.
3. Real Gemini calls require server-only `GEMINI_API_KEY` and `GEMINI_MODEL`. The merged client/orchestrator implements `respond` finalization and server-authored audience emphasis while preserving retrieval constraints. Compatibility tests exercise that real orchestration with shared schemas and an injected model; full live assistant API/browser behavior, latency and generation quota remain to be smoke-tested separately.
   The full historical investigation plus initial news/resolved source records exceeds the default 64,000-byte AI context budget. Compatibility checks verify a labeled `CONTEXT_LIMIT` fallback with zero model calls/actions at that default and successful `respond` finalization at the bounded `AI_MAX_CONTEXT_BYTES=128000` setting. Set that server-only budget deliberately for the rich investigation flow, or have Person 3 compact retrieved context; no limit is silently bypassed.
4. Person 3's [Gemini integration](../../backend/docs/gemini-integration.md) and [UI integration](../../backend/docs/ui-integration-handoff.md) documents arrived with the main pull and have been reconciled here. They record separate earlier live checks, not a completed assistant/timeline UI check. Their historical missing-schema lists are satisfied by this delivery. No migrations, imports or new provider calls were executed while merging.
5. Optional catalog discovery is still needed for authoritative topic/entity labels and automatic article-to-investigation discovery. It is not a prerequisite for assistant, known-ID investigation or timeline access. Daily aggregate HTTP support and flight changes can follow separately; no schema/query placeholders are supplied for them.

Credentials stay server-side. The existing restricted public Mapbox token exception applies only to geographic rendering; no map files are changed in this slice.

## Verification

Run from the repository root:

```sh
npm --prefix contracts run typecheck
npm --prefix contracts test
npm --prefix contracts run test:backend
npm --prefix frontend test
npm --prefix frontend run build
```

Schema tests compile the model draft independently and exercise frozen null/precision/provenance shapes and bounded inputs. Backend compatibility tests import the actual loader, retrieval, assistant (including `respond` finalization) and citation ledger with local historical records and injected repositories/models, without SQL execution or provider calls. UI tests exercise HTTP payloads, unavailable discovery, known-ID investigation access, pagination, cancellation/stale IDs, consent, atomic rejection, citations, fallback diagnostics, units and nulls. The stale map-preview test now checks the public map integration interface and rejects an obsolete camera acknowledgement.

The historical fixture is derived from committed seed literals/CSV and labeled explicitly. API failures never silently switch to it. Live provider/database smoke checks and deployment remain external. Publication of this implementation follows the user's separate Git commit/push/merge authorization; credentials remain ignored and local.

## Assistant v2 delivery

The frontend now uses the eight authoritative v2 contracts and always posts version 2 with `interaction_mode:"intent"`. The v1 consent control is removed. Conversation/session data lives at App lifetime; workspace actions resolve every target before one Zustand commit. Suggested and explicit timelines share validation and preserve exact UTC timestamps. See [assistant v2 delivery](assistant-v2.md) for activation and exact verification results. This supersedes the v1 frontend assistant notes above; existing backend ownership and live-service boundaries still apply.
