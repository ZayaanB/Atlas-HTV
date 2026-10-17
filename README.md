# Atlas

Geographic news and evidence workspace with a Mapbox globe, satellite exploration, a Gemini research assistant, Tiger Data timelines, and a bounded aircraft overlay.

Product scope: [Final PRD](atlas_prd.md).

## Scaffold status

Structure only. TypeScript files contain planning comments, not implementation. No packages have been installed, no runnable scripts are provided, and no integrations are configured. Package manifests and TypeScript/build configuration will be added when implementation starts so placeholder files cannot be mistaken for a working app.

This is the **shared scaffold for all four people**. The human using this chat is **Person 3 — Backend and Gemini**; that does not limit the scaffold to backend work. Implementation is paused until a later explicit start instruction.

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

- `frontend/`: comment-only entry, shell/state, feature components, API boundary, and styles for Persons 1 and 2.
- `backend/`: comment-only API, service, and data placeholders; see [backend handoff](backend/README.md).
- `contracts/`: shared API/schema/example slots owned by Person 1, agreed with Person 3.
- `db/`: migration and seed/import definition slots owned by Person 4.
- `assets/evidence/`: verified imagery/legends supplied by Person 4.
- `scripts/`: import definitions and startup tooling, with ownership recorded before implementation.
- `infra/`: Vultr/Caddy deployment supplied by Person 4.

The runtime plan is React/Vite + Mapbox → Fastify/Node.js → Gemini and Tiger Cloud PostgreSQL/TimescaleDB/pgvector. Caddy on Vultr serves the frontend and reverse-proxies `/api` under the project domain. No separate NoSQL/vector database is planned.
