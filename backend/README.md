# Atlas backend — Person 3

Implementation is authorized for this workstream. This directory now contains a runnable Node.js/TypeScript/Fastify server, canonical retrieval services, official Google Gen AI SDK orchestration/embeddings, a TLS `pg` adapter, provider adapters, manual import/indexing entrypoints, and behavioral tests. All changes are confined to `backend/`.

**Current runtime (2026-10-17):** the merged authoritative contract module is built and loaded, all 11 frozen SQL plans load from `db/handoff/database.mjs`, and four reviewed source definitions plus one bounded flight region load. News/location APIs return real stored records from the existing Tiger DEV service. Sixteen required schemas for investigations, observations, assistant/actions and flights are still missing, so full readiness remains 503. Person 4's curated Helene seed is loaded: 10 articles, 7,467 observations and one investigation. This is historical data, not a live feed. Test data/model responses are synthetic protocol doubles used only by tests.

The configured Gemini key/model passed a real metadata-only probe. Tiger's TLS verification passed with the user-supplied certificate file; migrations 001–005, reviewed runtime grants and the committed seed were applied to existing DEV service `apzql812ni`. Backend `.env` contains only the least-privilege runtime database connection and retains the existing Gemini settings. A live two-turn Gemini diagnostic has now verified model generation, canonical news tool calling, manual-filter parity and source-citation resolution. A full assistant explanation/API, embeddings and flights are not yet verified. The corpus now has 21 articles: 10 curated, one imported GDELT discovery and 10 NASA records reprocessed from a captured provider response after a narrowly scoped RSS header repair. The original curated records were preserved; new imports remain unreviewed/unlocated. Failed source refreshes retain their retry state. No provisioning or deployment was performed by this workstream.

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

`app.ts` composes without listening. `server.ts` owns listening, SIGINT/SIGTERM, connection draining and shutdown; closing the app cancels pending work and closes its owned pool. `REQUEST_TIMEOUT_MS` defaults to 30 seconds for the entire route lifecycle; expiry returns a structured 503 `REQUEST_TIMEOUT`. Disconnect/shutdown cancellation prevents late work from returning actions. Assistant generation also has bounded concurrency, tool calls, rounds, context, and output. Rate limiting returns 429 `RATE_LIMIT` with Retry-After. Logs exclude raw errors, bodies, prompts, and credentials. Bindings are local and CORS is not enabled: the intended integration is Caddy serving frontend and `/api` on the same origin. The rate limiter uses the socket IP (`trustProxy=false`), so a reverse proxy shares that budget; Person 4/Person 3 must agree trusted proxy topology before changing it.

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
curl 'http://127.0.0.1:3001/api/locations?query=PLACE_NAME'
curl 'http://127.0.0.1:3001/api/investigations/KNOWN_INVESTIGATION_ID'
curl 'http://127.0.0.1:3001/api/observations?location_id=KNOWN_LOCATION_ID&metric=KNOWN_METRIC&observed_from=2026-01-01T00:00:00Z&observed_to=2026-02-01T00:00:00Z'
curl 'http://127.0.0.1:3001/api/observations/compare?location_id=KNOWN_LOCATION_ID&metric=KNOWN_METRIC'
curl 'http://127.0.0.1:3001/api/flights?region_id=REVIEWED_REGION_ID'
curl 'http://127.0.0.1:3001/api/flights/find?region_id=REVIEWED_REGION_ID&identifier=KNOWN_CALLSIGN'
curl http://127.0.0.1:3001/api/assistant -H 'Content-Type: application/json' \
  -d '{"request_id":"ui-request-1","message":"Explain the available evidence","timezone":"America/Toronto","filters":{},"allow_ui_actions":false}'
```

The generic identifiers above are placeholders. This checkout's initialized database supports `location_ids=loc-asheville-nc` and `query=Asheville`; the sourced investigation ID is `inv-helene-asheville-2024`, but its route still awaits the shared investigation schemas. Current readiness reports:

```json
{"status":"not_ready","contracts":false,"database":true,"query_plans":true,"data_mode":"stored"}
```

The consistent operational error envelope is:

```json
{"error":{"code":"CONTRACTS_UNAVAILABLE","message":"Shared schema InvestigationQuery has not been supplied","retryable":true,"request_id":"SERVER_REQUEST_ID"}}
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

**94 backend tests pass**, including rate-limit/deadline regressions, cancellation of late model responses, stalled-provider shutdown, malformed provider/handoff rejection, and a separate server process that serves liveness and exits cleanly on SIGTERM. TypeScript checks and production build pass. Tiger setup tests cover URI/TLS overrides, private environment preservation, migration conflicts, password-file escaping, explicit initialization, production/unready service rejection, TLS failure redaction and runtime verification/cleanup. Area-search regressions verify more than 50 locations and multiple ID batches without dropping matching articles, manual/tool parity, and no unrestricted location lookup for empty results. The current local configuration checker loads real handoffs and reports incomplete setup with exit code 2.

Real read-only API checks passed for Asheville location lookup, location-filtered news (5 results), location+`water` filtering (3 results), publication-range filtering (6 results), and oversized-limit rejection (400). Coverage preserves `mode: "stored"`, `live: false`, units and source/dataset timestamps. Database catalogs confirm verified TLS and installed TimescaleDB/pgvector; runtime login/read checks pass, with 10 articles, 7,467 observations and one investigation. Gemini metadata access is verified. Investigation returns the expected explicit missing-schema 503. The separate two-turn Gemini diagnostic verifies generation/tool/citation handling; a full generated explanation, timeline API result and flight integration are not claimed here. News import evidence is recorded separately below.

After fast-forwarding to UI integration commit `e6eeb59`, the browser loaded all 10 stored articles through Vite's same-origin `/api` proxy. Keyword `water` returned 4; selecting Asheville retained 3 and resolved its sourced city extent. A proxied area query `bounds=-83,35,-82,36&limit=100` returned 10 stored articles with `live:false`. The user-supplied public Mapbox token is configured in ignored `frontend/.env.local`; globe rendering, feed-driven focus to Asheville and the Auto transition to satellite were visually verified, with the sourced city extent and streamgage overlay restored. Satellite basemap remains context, not dated event evidence. The frontend build passes; its tests report 14 passes and one stale preview expectation after Mapbox replaced that preview. See [UI integration handoff](docs/ui-integration-handoff.md) for exact remaining owner tasks.

Tests cover manual/tool filter parity, timestamp/bounds handling, validation, citation/source relationships, UI-action rejection, timeout/cancellation, tool limits, redaction, parameter binding/transaction rollback, embedding identity/fallback, import normalization/deduplication/permissions/failures, provider payloads and size limits, and flight cache/coalescing/backoff/expiry. They use synthetic dependencies plus a temporary localhost server, and do not contact external providers. A failed rollback discards the affected pool client while preserving the original write error.

To finish the sourced assistant/timeline vertical slice, receive the remaining shared schemas from Person 1, then verify investigation/timeline retrieval and make a real cited Gemini call. Flight activation still requires provider/polling review and the shared flight schemas. The initialized Tiger database and existing Gemini metadata access are ready for that integration.

References used for adapter behavior: [official Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/index.html), [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [node-postgres TLS](https://node-postgres.com/features/ssl), [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [ADSB.lol API/terms](https://api.adsb.lol/docs), [readsb v2 timestamp format](https://github.com/wiedehopf/readsb/blob/dev/README-json.md). Dependency versions are pinned in the backend manifest/lockfile. No current polling guarantee is assumed from the ADSB.lol documentation.

## Worldwide discovery and audience perspectives

The corpus currently contains the curated Helene investigation. More mapped locations require broader reviewed source definitions plus source-backed story-to-location links; imported discovery metadata remains unlocated until enrichment is agreed. The backend now supplies distinct general-public, journalist and investor guidance to Gemini without changing retrieval, citations or actions. This still awaits the authoritative AssistantRequest audience field and UI; no visible audience tags or global coverage are claimed. Exact cross-owner fields and source/location requirements are in [the global discovery handoff](docs/global-discovery-handoff.md). Ingestion failures now return safe structured error codes and an upstream HTTP status when available, without raw provider/SQL details.

Current news refresh results, replay provenance and timeout configuration are recorded in [news refresh status](docs/news-refresh-status.md). The browser and same-origin API both show 21 stories; that is a stored corpus, not a complete live worldwide feed.

## Gemini integration work

Run `AI_REQUEST_TIMEOUT_MS=60000 npm --prefix backend run verify:gemini` for the explicit live two-turn diagnostic (uses generation quota). It validates a news-search call and citation with existing shared schemas; it does not bypass missing assistant contracts. The model can now finalize via a shared-schema `respond` tool, preserves all active search constraints, and uses sanitized errors, quota backoff and bounded context. See [Gemini integration evidence](docs/gemini-integration.md) and [the copy-paste request for Person 1's AI](docs/person-1-ai-request.md). Production assistant/investigation/timeline integration still awaits Person 1's 11 core schemas.

Valid JSON assistant POSTs now use Atlas-owned lifecycle cancellation: request-body completion no longer triggers a false disconnect. Real HTTP tests verify successful responses, timeout 503s and client disconnects. The current public assistant endpoint returns the honest missing-AssistantRequest 503 until the shared contract handoff arrives.
