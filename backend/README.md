# Atlas backend — Person 3

Implementation is authorized for this workstream. This directory now contains a runnable Node.js/TypeScript/Fastify server, canonical retrieval services, official Google Gen AI SDK orchestration/embeddings, a TLS `pg` adapter, provider adapters, manual import/indexing entrypoints, and behavioral tests. All changes are confined to `backend/`.

**Current runtime:** liveness works without credentials. Readiness returns 503 and data routes fail with an explicit missing-contract/setup error until the shared contracts and frozen database handoff are supplied. The repository's `contracts/`, migrations, source definitions, and seeds were comment-only when this implementation began. No factual development dataset has been invented. Test data and model responses are synthetic protocol doubles, used only by tests.

No real Gemini request, Tiger Cloud query, news import, embedding generation, or flight request has been executed. The agent has not run migrations, provisioned resources, deployed, committed, or pushed. Implemented adapters are not evidence of completed sponsor integrations.

## Run locally

Requires Node >=22.12 (verified with Node 24.14). From the repository root:

```bash
npm --prefix backend ci
cp backend/.env.example backend/.env
npm --prefix backend run dev
```

The server defaults to `127.0.0.1:3001`. Set `HOST=0.0.0.0` only when the deployment owner needs it. Local `.env` loading is relative to the backend package working directory. Never place secrets in frontend settings.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run check
npm --prefix backend run build
npm --prefix backend start
```

`app.ts` composes without listening. `server.ts` owns listening, SIGINT/SIGTERM, connection draining and shutdown; closing the app cancels pending work and closes its owned pool. `REQUEST_TIMEOUT_MS` defaults to 30 seconds for the entire route lifecycle; expiry returns a structured 503 `REQUEST_TIMEOUT`. Disconnect/shutdown cancellation prevents late work from returning actions. Assistant generation also has bounded concurrency, tool calls, rounds, context, and output. Rate limiting returns 429 `RATE_LIMIT` with Retry-After. Logs exclude raw errors, bodies, prompts, and credentials. Bindings are local and CORS is not enabled: the intended integration is Caddy serving frontend and `/api` on the same origin. The rate limiter uses the socket IP (`trustProxy=false`), so a reverse proxy shares that budget; Person 4/Person 3 must agree trusted proxy topology before changing it.

`npm --prefix backend run check` validates environment and handoff exports locally, lists missing shared schemas/core query plans, and reports whether credentials are configured. It opens no database connection and calls no provider. Exit codes: 0 means data configuration is complete, 2 means required setup is missing, and 1 means configuration is invalid. Configured means available for a later live check, not verified access. Blank/whitespace settings, inconsistent embedding configuration, malformed query plans, duplicate source/region IDs, missing modules and modules outside their owned paths fail with safe diagnostics. Integration modules must be portable `.mjs` or built `.js` files.

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

The identifiers above are placeholders, not invented source records. An actual response currently obtainable with no setup is:

```json
{"status":"not_ready","contracts":false,"database":false,"query_plans":false,"data_mode":"unavailable"}
```

The consistent operational error envelope is:

```json
{"error":{"code":"CONTRACTS_UNAVAILABLE","message":"Shared schema NewsQuery has not been supplied","retryable":true,"request_id":"SERVER_REQUEST_ID"}}
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

Verified in this checkout: **52 behavioral tests passed**, including rate-limit/deadline regressions, cancellation of late model responses, stalled-provider shutdown, malformed provider/handoff rejection, and a separate server process that serves liveness and exits cleanly on SIGTERM. TypeScript checks passed for source/tests, the production build passed, and the local configuration checker accurately reports incomplete setup with exit code 2. Earlier built-server smoke checks returned liveness 200, readiness 503 and a structured missing-contract 503 for news. `git diff --check` passed; changes remain within `backend/`.

Tests cover manual/tool filter parity, timestamp/bounds handling, validation, citation/source relationships, UI-action rejection, timeout/cancellation, tool limits, redaction, parameter binding/transaction rollback, embedding identity/fallback, import normalization/deduplication/permissions/failures, provider payloads and size limits, and flight cache/coalescing/backoff/expiry. They use synthetic dependencies plus a temporary localhost server, and do not contact external providers. A failed rollback discards the affected pool client while preserving the original write error.

To finish the real vertical slice, supply the authoritative runtime schemas, a frozen database schema/query handoff, TLS database credentials, one verified source-linked investigation and observation series, an available Gemini model/key, and reviewed source/flight configuration. Then run the migrations/imports with Person 4's authorization, verify real filtered queries and timeline, make a real cited Gemini call, and record integration evidence. None of those live validations is claimed by the current test suite.

References used for adapter behavior: [official Gen AI SDK](https://googleapis.github.io/js-genai/release_docs/index.html), [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [node-postgres TLS](https://node-postgres.com/features/ssl), [GDELT DOC](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), [ADSB.lol API/terms](https://api.adsb.lol/docs), [readsb v2 timestamp format](https://github.com/wiedehopf/readsb/blob/dev/README-json.md). Dependency versions are pinned in the backend manifest/lockfile. No current polling guarantee is assumed from the ADSB.lol documentation.
