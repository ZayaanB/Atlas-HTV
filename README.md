# Atlas

Geographic news and evidence workspace with a Mapbox globe, satellite exploration, a Gemini research assistant, Tiger Data timelines, and a bounded aircraft overlay.

Product scope: [Final PRD](atlas_prd.md).

## Current status

The frontend foundation, core/news/location contracts, backend code, and data handoff files now exist. The frontend runs independently with explicitly labeled historical fixtures or connects through same-origin `/api`. Overall backend readiness remains incomplete: 16 required domain schemas and external setup are still outstanding. No live provider/database integration is claimed by this status.

This is the **shared scaffold for all four people**. The human using this chat is **Person 3 — Backend and Gemini**; that does not limit the scaffold to backend work. Person 1’s frontend foundation was explicitly authorized. Map rendering and the remaining feature UI are deferred; see [frontend startup and boundaries](frontend/README.md) and [Person 2 handoff](frontend/docs/map-handoff.md).

Read [shared agent instructions](AGENTS.md) first, then the matching role guide:

- [Person 1 — Frontend/integration](docs/agents/person-1.md)
- [Person 2 — Map/visuals](docs/agents/person-2.md)
- [Person 3 — Backend/Gemini](backend/AGENTS.md)
- [Person 4 — Data/evidence/deployment](docs/agents/person-4.md)

## Ownership

| Owner | Areas |
| --- | --- |
| Person 1 — Frontend/integration | Frontend shell, feed/assistant/research UI, frontend dependencies, shared contracts. |
| Person 2 — Map/visuals | `frontend/src/features/map/`, including flight rendering. |
| Person 3 — Backend/Gemini (this workstream) | `backend/`, backend dependencies, retrieval/embeddings, ingestion execution, flight API/cache. |
| Person 4 — Data/evidence/deployment | `db/`, source/import definitions, evidence assets, `infra/`, service/domain setup. |

## Layout

- `frontend/`: runnable React/Vite shell, Zustand workspace state, TanStack Query news/location hooks, typed API boundary, feed, and a temporary map preview. Person 2’s map subtree remains placeholders.
- `backend/`: Fastify API, retrieval, provider adapters, and operational tooling; see [backend handoff](backend/README.md) for setup and remaining dependencies.
- `contracts/`: authoritative JSON Schemas, inferred TypeScript types, and historical examples owned by Person 1, matching Person 3’s existing protocol.
- `db/`: migrations, database handoff, and historical seed definitions owned by Person 4; file presence does not establish deployment.
- `assets/evidence/`: verified imagery/legends supplied by Person 4.
- `scripts/`: import definitions and startup tooling, with ownership recorded before implementation.
- `infra/`: Vultr/Caddy deployment supplied by Person 4.

The runtime plan is React/Vite + Mapbox → Fastify/Node.js → Gemini and Tiger Cloud PostgreSQL/TimescaleDB/pgvector. Caddy on Vultr serves the frontend and reverse-proxies `/api` under the project domain. No separate NoSQL/vector database is planned.
