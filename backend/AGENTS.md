# Person 3 — Backend and Gemini

Read the root `AGENTS.md`, `atlas_prd.md`, and `backend/README.md`. Root instructions apply throughout this subtree. **Current phase: comment-only scaffold; wait for an explicit instruction before implementing.**

## Your scope

Own `backend/`: Fastify startup/routes, server-side configuration, database pool/queries, canonical retrieval, Gemini client/orchestration/tools/citations, embeddings, news ingestion execution, and bounded flight API/cache. You own backend dependencies and later backend package/build configuration.

Do not implement frontend/map behavior, shared contracts, migrations, seed definitions, imagery interpretation, or deployment in another owner's files. Coordinate contracts with Person 1, map/flight payloads with Person 2, and database/provider/deployment setup with Person 4. Shared scaffolding/docs updates already authorized by the user are allowed.

## Design requirements

- `app.ts` composes the app without listening; `server.ts` owns process startup/shutdown. Keep route handlers thin and inject services for verification.
- Validate HTTP and tool inputs against the same authoritative schemas from `contracts/`; use consistent errors and bounded result sizes.
- `retrieval.ts` owns canonical semantics for manual and assistant searches. Location/date/theme constraints remain authoritative in keyword/vector matching.
- Use parameterized SQL and the agreed Person 4 schema. One TLS pool connects to Tiger Cloud; clean it up on shutdown. No implicit schema creation in request handling.
- Embeddings use one configured model/version/dimension; store source/chunk ID and content hash. Cite original evidence, not vectors. Keyword fallback is explicit when embeddings are unavailable.
- Gemini calls remain server-side. Bound iterations, prompt/context size, request duration, and output. Validate all proposed tools/actions and resolve citations only against retrieved records.
- Support `search_news`, `set_filters`, `focus_location`, `get_investigation`, `compare_observations`, `get_aircraft_in_region`, and `find_aircraft` through allowlisted dispatch. Never execute model-generated SQL/code or arbitrary network fetches.
- Preserve user timezone/date meaning, nulls, precision, units, source IDs, and coverage. Do not invent a full article summary from a title-only input.
- Ingestion normalizes/deduplicates/upserts permitted provider content; browser requests query our stored/cached data. Record last successful refresh and verification status.
- Flight caching is shared across users, region-bounded, quota-aware, and paused without viewers. Return observed/fetched times, attribution, and stale/replay state; no guessed operational status.
- Errors must permit manual filtering and clearly labeled fallback modes. Cancelled/stale assistant requests must not apply outdated actions. Never claim mocked or replayed output is live.

## Handoffs before implementation

1. Person 1: endpoint schemas, UI-action payloads, citation references, pagination/limits, and error shapes.
2. Person 2: AircraftState, location precision/bounds, camera-action payloads, and layer freshness fields.
3. Person 4: table/view names, extension setup, embeddings columns, seed IDs, source metadata, retention, credentials supplied outside Git, and deployment host/port/health semantics.

## First authorized slice

Add manifest/configuration and health readiness; load one seeded investigation; return the same filtered records to manual and Gemini tools; generate a real cited explanation. Then expand ingestion, embeddings, time-series queries, and flights. Integrate before polishing all routes.

## Meaningful checks

Verify schema rejection, exact filter parity, injection-safe queries, grounded citations/actions, timeout/quota/cancellation handling, embedding fallback, flight cache/stale behavior, and graceful shutdown when those features exist. Run no implementation tests for comment-only scaffolds. Provide Person 1 concrete response examples and Person 4 documented runtime commands/environment names once implemented.
