# Backend and Gemini — Person 3

Comment-only scaffold. Nothing here starts a server or calls a provider yet.

## Intended stack

Node.js + TypeScript + Fastify; official Google Gen AI SDK; `pg` for Tiger Cloud PostgreSQL with TimescaleDB and pgvector. Pin dependencies and add package/build configuration during implementation. Runtime schemas must be shared with `contracts/`, not independently invented here.

## Request flow

HTTP route → shared validation → retrieval/data services → normalized records.

Assistant route → Gemini orchestration → allowlisted tools using the same retrieval services → validated citations/actions → frontend shared state. Backend never owns Mapbox camera/rendering; it returns actions against supported location IDs/bounds.

## File map

| Path | Planned responsibility |
| --- | --- |
| `src/app.ts` | Compose Fastify routes/services and common errors; no listening side effects. |
| `src/server.ts` | Process startup, listen, and graceful shutdown. |
| `src/config.ts` | Server-side environment validation and bounded limits. |
| `src/routes/` | News, locations, investigations, observations, assistant, flights, health. |
| `src/services/validation.ts` | Shared-contract validation and query/action constraints. |
| `src/services/retrieval.ts` | Canonical filtered retrieval shared by manual and AI requests. |
| `src/services/embeddings.ts` | Embedding generation/versioning for permitted text; keyword fallback. |
| `src/services/gemini/` | SDK access, bounded orchestration, tool dispatch, and citation validation. |
| `src/services/flights.ts` | Shared regional cache, freshness, backoff, and polling lifecycle. |
| `src/data/database.ts` | TLS connection pool and shutdown; migrations belong to Person 4. |
| `src/data/queries.ts` | Parameterized SQL against agreed tables/views. |
| `src/data/ingestion.ts` | Normalize/deduplicate/upsert permitted data with provenance. |
| `src/data/providers/` | GDELT, permitted RSS, and ADSB.lol adapter slots. |

## API handoff to Person 1

| Endpoint | Intended response |
| --- | --- |
| `GET /api/news` | Filtered articles, coverage, and timestamp metadata. |
| `GET /api/locations` | Known places, bounds, and honest geographic precision. |
| `GET /api/investigations/:id` | Resolved brief and source-linked evidence. |
| `GET /api/observations` | Real observations or disclosed time buckets/units. |
| `POST /api/assistant` | Answer, validated citations, result IDs, UI actions, mode, and errors. |
| `GET /api/flights` | Bounded aircraft results, observed/fetched times, attribution, and stale/replay status. |
| `GET /api/health` | Safe readiness status without secrets. |

Freeze schemas, stable IDs, timestamps, action payloads, pagination/result limits, and error shapes with Person 1 before route implementation. Person 2 consumes the same location/aircraft contracts. Person 4 supplies seed records, migrations, aggregates, and source/license metadata before SQL is finalized.

## Implementation sequence

1. Agree contracts and minimal seeded records with Persons 1 and 4.
2. Add manifest/configuration, database access, health, and one investigation retrieval.
3. Connect real Gemini retrieval and cited responses; preserve manual-query behavior.
4. Add news ingestion, embeddings, observations, and the bounded flight adapter/cache.
5. Verify filters, citation/action rejection, failures, and deployment handoffs with realistic checks.

Do not create private copies of shared contracts, run generated SQL/code, expose credentials, or claim prepared fallback output is live. No provider calls, migrations, provisioning, or tests have been run as part of scaffolding.
