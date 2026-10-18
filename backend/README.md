# Atlas backend — Person 3

Implementation is authorized for this workstream. This directory now contains a runnable Node.js/TypeScript/Fastify server, canonical retrieval services, official Google Gen AI SDK orchestration/embeddings, a TLS `pg` adapter, provider adapters, manual import/indexing entrypoints, and behavioral tests. All changes are confined to `backend/`.

**Current runtime (2026-10-17, main `9b592cd`):** all 24 required shared schemas and all 11 frozen database plans load. Tiger-backed health, news, locations, investigation, raw observations and endpoint comparisons pass live HTTP checks. The new optional `/api/workspace` catalog returns stored theme/entity labels and explicit article-to-investigation associations, so the frontend can discover Helene research automatically. Its SQL lives in `backend/src/data/workspace.ts` and uses the frozen `atlas-p3-v1` tables; no teammate migration or contract was changed.

The existing Tiger DEV service has 21 articles, 7,467 historical observations and one reviewed Helene investigation. TLS uses the supplied CA and least-privilege `atlas_runtime` credentials in ignored `backend/.env`. The Gemini SDK, bounded tool loop, source-citation validation and authorized actions are integrated with Person 1's new schemas. Live generation results and current provider limitations are recorded in [Gemini integration](docs/gemini-integration.md). Stored historical records are not live reporting. Embeddings remain unconfigured; flights remain disabled pending provider-use review. No resources were provisioned or deployed.

## Run locally

Requires Node >=22.12 (verified with Node 24.14). From the repository root:

```bash
npm --prefix backend ci
npm --prefix contracts ci
npm --prefix contracts run build
# Only on a fresh checkout without a populated secret file:
test -e backend/.env || (umask 077; cp backend/.env.example backend/.env)
npm --prefix backend run dev
```

The server defaults to `127.0.0.1:3001`. Set `HOST=0.0.0.0` only when the deployment owner needs it. Local `.env` loading is relative to the backend package working directory. Never place secrets in frontend settings.

For clear credential setup steps, see [Tiger Cloud and Gemini setup](docs/credentials-setup.md). `backend/.env` is the local secret file; `.env.local` is not loaded by these scripts. Leave optional credential settings commented until you fill them in. The example contains no usable secrets.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run check
npm --prefix backend run verify:connections
npm --prefix backend run build
npm --prefix backend start
```

`app.ts` composes without listening. `server.ts` owns listening, SIGINT/SIGTERM, connection draining and shutdown; closing the app cancels pending work and closes its owned pool. `REQUEST_TIMEOUT_MS` defaults to 30 seconds in code; the supplied local/example configuration uses 60 seconds for the entire route lifecycle; expiry returns a structured 503 `REQUEST_TIMEOUT`. Disconnect/shutdown cancellation prevents late work from returning actions. Assistant generation also has bounded concurrency, tool calls, rounds, context, and output. Rate limiting returns 429 `RATE_LIMIT` with Retry-After. Logs exclude raw errors, bodies, prompts, and credentials. Bindings are local and CORS is not enabled: the intended integration is Caddy serving frontend and `/api` on the same origin. The rate limiter uses the socket IP (`trustProxy=false`), so a reverse proxy shares that budget; Person 4/Person 3 must agree trusted proxy topology before changing it.

`npm --prefix backend run check` validates environment and handoff exports locally, lists missing shared schemas/core query plans, and reports whether credentials are configured. It opens no database connection and calls no provider. Exit codes: 0 means data configuration is complete, 2 means required setup is missing, and 1 means configuration is invalid. Configured means available for a later live check, not verified access. Blank/whitespace settings, inconsistent embedding configuration, malformed query plans, duplicate source/region IDs, missing modules and modules outside their owned paths fail with safe diagnostics. Integration modules must be portable `.mjs` or built `.js` files.

`verify:connections` is a separate explicit read-only network check that works without teammate schemas: it verifies PostgreSQL session TLS and reads installed extension names, and fetches Gemini model metadata. Use `-- --database` or `-- --gemini` to select one check. It does not apply migrations, import records, generate embeddings, or generate answers. Success verifies the selected connection/metadata only, not the Atlas schema, generation quota, tool calling, or grounded answers. Its exit codes are 0 (selected probes passed), 2 (missing configuration), and 1 (invalid configuration/failed probe). Raw errors and credential values are never printed.

The explicit `setup:tiger` command connects to an existing READY DEV service using authenticated Tiger CLI password storage. By default it only checks the completed schema and saves a verified `atlas_runtime` connection. `--initialize` applies the committed Person 4 migrations 001–005, runtime grants and curated seed when the database is empty. It resumes only a contiguous known migration history, refuses conflicting Atlas schemas/partial seed data, preserves existing role passwords, and never provisions or drops a database. Admin credentials stay out of `.env`; generated runtime credentials are saved privately before subsequent checks so retries do not lose them. See the [step-by-step setup guide](docs/credentials-setup.md) before running it.

## What is implemented

| Area | Behavior | External dependency |
| --- | --- | --- |
| Health | `/api/health/live` is process liveness; `/api/health` checks contracts, core query-plan availability, repository mode and database connectivity | Full contracts, core plans and configured database for readiness |
| News/locations/investigations | Shared-schema validation; canonical filters; bounded results; precise locations and original record/source fields preserved | Person 1 schemas; Person 4 verified records/schema; reviewed SQL plans |
| Timeline | Raw, time-filtered observations; source/unit-compatible endpoint comparison computed in application code | Real observations; TimescaleDB migration/aggregate handoff |
| Gemini | Official `@google/genai`, manual allowlisted dispatch, bounded multi-turn function responses, source-linked answers, validated UI actions | Available model/key and a sourced dataset |
| Embeddings | Query/document task separation, model/version/dimension/hash identity, changed-chunk indexing, filtered vector adapter and explicit keyword fallback | Available model/key; approved chunk permissions; pgvector schema/query plan |
| Imports | Fixed GDELT endpoint and reviewed RSS definitions; normalization, URL deduplication, provenance, permission checks, transactions and stored refresh/backoff metadata | Reviewed sources/rights and import SQL plans |
| Flights | Bounded ADSB.lol point adapter; shared cache, request coalescing, global refresh gate, Retry-After/backoff, stale/expiry metadata | Reviewed terms/polling, shared AircraftState/region schemas and configured regions |

The current timeline response says `aggregation: "raw"`. It does **not** claim a continuous aggregate is wired. Person 4 must supply the aggregate and its units/period semantics before a bucketed response is added. Flight cache is process-shared, demand-driven, and memory-only. Run one backend process for the current quota model; a multi-process/shared fleet cache is not implemented. No aircraft history or flight routes/status are stored or inferred. Empty results do not establish empty airspace.

## API integration

Full field and schema proposal: [contracts handoff](docs/contracts-handoff.md). This is a backend dependency proposal, **not a second authoritative contract**. Person 1 integrates the agreed schemas in `contracts/`; backend loads that one runtime export. Schema/table handoff: [database](docs/database-handoff.md). Provider setup: [sources](docs/sources-handoff.md).

GET arrays use comma-separated values, numbers use decimal strings, bounds use west,south,east,north. Input normalization happens before the same shared validation used by Gemini tools. UTC timestamps require `Z`; ranges are inclusive and limited to 366 days when both endpoints are supplied. Publication filtering excludes unknown publication times; GDELT discovery time is never substituted. Bounds crossing the antimeridian must be split. Regional bounds must fit the selected viewport; a broad story is not treated as an address pin.

```bash
curl -i http://127.0.0.1:3001/api/health/live
curl -i http://127.0.0.1:3001/api/health
# After the shared schemas, verified IDs, and database handoff exist:
curl 'http://127.0.0.1:3001/api/news?location_ids=KNOWN_LOCATION_ID&limit=20'
curl 'http://127.0.0.1:3001/api/news?event_types=flood,drought&topics=environment&has_location=true&verification_status=unreviewed&limit=20&offset=0'
curl 'http://127.0.0.1:3001/api/locations?query=PLACE_NAME'
curl 'http://127.0.0.1:3001/api/investigations/KNOWN_INVESTIGATION_ID'
curl 'http://127.0.0.1:3001/api/observations?location_id=KNOWN_LOCATION_ID&metric=KNOWN_METRIC&observed_from=2026-01-01T00:00:00Z&observed_to=2026-02-01T00:00:00Z'
curl 'http://127.0.0.1:3001/api/observations/compare?location_id=KNOWN_LOCATION_ID&metric=KNOWN_METRIC'
curl 'http://127.0.0.1:3001/api/flights?region_id=REVIEWED_REGION_ID'
curl 'http://127.0.0.1:3001/api/flights/find?region_id=REVIEWED_REGION_ID&identifier=KNOWN_CALLSIGN'
curl http://127.0.0.1:3001/api/assistant -H 'Content-Type: application/json' \
  -d '{"request_id":"ui-request-1","message":"Explain the available evidence","timezone":"America/Toronto","filters":{},"allow_ui_actions":false}'
```

The generic identifiers above are placeholders. This checkout supports `location_ids=loc-asheville-nc`, `query=Asheville`, and the sourced investigation `inv-helene-asheville-2024`. `GET /api/workspace` discovers that investigation's explicit article links and stored filter labels. Current readiness reports:

```json
{"status":"ready","contracts":true,"database":true,"query_plans":true,"data_mode":"stored"}
```

News category filters use the authoritative `contracts` export `newsFiltering`: existing tags or whole English headline/excerpt terms, OR within each event/topic group and AND across fields. They are approximate discovery rules, not reviewed classifications or newly generated facts. `verification_status` filters the stored review field; `has_location` tests linked location IDs and does not infer coordinates. `backend/src/data/news-filters.ts` adds parameterized predicates on the agreed `atlas.article_records` view before the frozen handoff's keyword/semantic ranking and pagination. No migration or Person 4 SQL changes are required. An incompatible handoff fails explicitly instead of filtering only the returned page.

After pulling these changes, rebuild contracts and backend, then restart the backend (`npm --prefix contracts run build`, `npm --prefix backend run build`, `npm --prefix backend start`). These filters apply equally to manual requests and Gemini tools; read-only tools cannot replace active event/topic/provenance constraints. Backend tests require the built shared contracts and include filter parity, strict GET values, action rejection, bound SQL values and pagination-adapter checks.

The consistent operational error envelope is:

```json
{"error":{"code":"NOT_FOUND","message":"Investigation not found","retryable":false,"request_id":"SERVER_REQUEST_ID"}}
```

Assistant responses echo the client `request_id`. Person 1 must abort obsolete fetches and discard any response whose request ID is no longer active **before applying actions**. `allow_ui_actions` defaults to false; explicitly enable it for a workspace-changing request. Valid action types are `set_filters` with a complete filters object and `focus_location` with a known location ID; backend never invents camera coordinates/zoom. Focus precision comes from the shared Location record. Failed, cancelled or rejected synthesis produces no actions. Read-only tool searches inherit active location/theme/entity/bounds/publication constraints and cannot silently replace them; changing these requires `set_filters`.

The assistant attaches source URLs/titles from retrieved stored source records and checks the source belongs to the cited record. This validates provenance, not the truth of every generated sentence. Human source review remains necessary. The model receives permitted excerpts/titles only and must distinguish title-only evidence. Missing Gemini or rejected generation returns a labeled `fallback` explanation with no generated factual briefing, while manual results remain available. Synthetic injected repositories use `fixture`, never `live`.

## Import and index execution

After Person 4 reviews the source and database handoffs:

```bash
npm --prefix backend run ingest -- REVIEWED_SOURCE_ID
npm --prefix backend run embed -- KNOWN_SOURCE_ID KNOWN_CHUNK_ID
```

Imports accept configured source IDs, not arbitrary URLs. They upsert normalized records and associated source/provenance records through reviewed SQL. New discovery records remain unreviewed/unlocated, with empty verified theme/entity/location arrays. There is no automatic geocoding or inferred event time. Provider failures retain previous imports and last successful refresh. RSS excerpts require explicit permission and a per-source character bound. DTD/entities, redirects, oversized responses and non-public feed URL forms are rejected. Feed definitions are trusted reviewed configuration, not user/model input; deployment egress policy should match the reviewed hosts.

Indexing reads an explicitly permitted stored chunk, compares hash/model/version/dimensions, embeds changed text, and upserts it through the same pool. No model or dimension is assumed available. Semantic-query failures disclose `keyword_fallback` and retain structured constraints. No timer, automatic corpus embedding, provider API calls on startup, or browser-triggered news refresh is enabled.

## Validation and remaining integration work

**99 backend tests pass.** Backend behavioral tests cover canonical filter parity, timestamp/bounds handling, grounded citations/actions, cancellation/deadlines, bounded SDK configuration, schema projection, quota backoff, parameter binding/rollback, ingestion/provenance, embeddings fallback and shared flight caching. New catalog tests use the actual shared schema and verify explicit associations, malformed output rejection and bounded fixed SQL. They use injected providers/models and do not contact external services. Build `contracts/` before running the backend suite.

The main handoff passed 41 frontend tests and 10 contract/backend compatibility tests. Source/test typechecks and production builds pass. Real HTTP checks additionally verified readiness, the complete investigation envelope, raw USGS discharge rows and a source/unit-compatible endpoint difference. The browser opened an article's associated investigation through catalog discovery. Timeline remains raw; no daily aggregate is claimed. The old stale preview test was fixed by Person 1.

Configuration uses `AI_MAX_CONTEXT_BYTES=128000`, `AI_REQUEST_TIMEOUT_MS=50000`, `REQUEST_TIMEOUT_MS=60000`, and `AI_MAX_OUTPUT_TOKENS=8192` for the rich investigation. Defaults in code remain conservative where documented; copy the example only on a fresh checkout, preserving an existing secret file. Set `GEMINI_THINKING_LEVEL=low` only for a model supporting thinking levels; it is optional for other models. Context includes tool definitions and is never silently bypassed. Truncated/invalid output yields a labeled fallback with zero actions. Rebuild shared contracts before starting dev servers: rebuilding their imported files while a request runs can restart the watcher and cancel it.

Remaining external setup: broader reviewed source/location links for global map coverage, an agreed embedding model/version/dimension and indexing, ADSB.lol permission/polling review, and Person 4 deployment. Core assistant/research contracts are complete; no further Person 1 schemas are required for this slice.

References used for adapter behavior: [official Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/index.html), [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [node-postgres TLS](https://node-postgres.com/features/ssl), [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [ADSB.lol API/terms](https://api.adsb.lol/docs), [readsb v2 timestamp format](https://github.com/wiedehopf/readsb/blob/dev/README-json.md). Dependency versions are pinned in the backend manifest/lockfile. No current polling guarantee is assumed from the ADSB.lol documentation.

## Worldwide discovery and audience perspectives

The corpus currently contains the curated Helene investigation. More mapped locations require broader reviewed source definitions plus source-backed story-to-location links; imported discovery metadata remains unlocated until enrichment is agreed. The backend now supplies distinct general-public, journalist and investor guidance to Gemini without changing retrieval, citations or actions. The authoritative AssistantRequest and UI now support these perspectives; this does not create new facts or global coverage. Exact cross-owner fields and source/location requirements are in [the global discovery handoff](docs/global-discovery-handoff.md). Ingestion failures now return safe structured error codes and an upstream HTTP status when available, without raw provider/SQL details.

Current news refresh results, replay provenance and timeout configuration are recorded in [news refresh status](docs/news-refresh-status.md). The browser and same-origin API both show 21 stories; that is a stored corpus, not a complete live worldwide feed.

## Gemini integration work

Run `AI_REQUEST_TIMEOUT_MS=60000 npm --prefix backend run verify:gemini` for the explicit live two-turn diagnostic (uses generation quota). It checks canonical news tool calling and citation resolution separately from the public assistant. The public route uses the shared `AssistantRequest`, `AssistantDraft` and `AssistantResponse`, server-resolved URLs/titles, and validated `set_filters` / `focus_location` actions only when authorized. See [Gemini integration evidence and test steps](docs/gemini-integration.md).

Valid JSON assistant POSTs use Atlas-owned lifecycle cancellation: request-body completion does not trigger a false disconnect. Real HTTP tests cover successful responses, structured timeout 503s and client disconnects. Provider errors/fallbacks leave manual filtering available and never return pending actions. API mode never silently switches to fixtures.
