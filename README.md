# Atlas

**Every headline happens somewhere. Follow it there.**

A flood. A water outage. A neighbourhood changing around you. The headline catches your attention, but understanding the story means finding the place, connecting the reporting, and figuring out what the evidence actually supports.

Atlas puts that investigation on a globe. Fly into a city, follow its stories, explore historical measurements and dated imagery, then ask Gemini to help you make sense of what you've found. Original sources stay within reach as you explore.

We built Atlas for the moment curiosity turns into “I want to understand this.” Whether you're following your community, chasing a story, or researching a business connection, there's somewhere to start—and a trail to follow.

## Start the app locally

Requires **Node.js 22.12 or newer** and npm. Run these commands from the repository root (the folder containing `backend/`, `frontend/`, and `contracts/`).

### First-time setup

Install dependencies and build the shared contracts before starting either application:

```bash
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix backend ci
npm --prefix frontend ci
```

Create local environment files only if they do not already exist. These commands preserve populated files:

```bash
test -e backend/.env || (umask 077; cp backend/.env.example backend/.env)
test -e frontend/.env.local || (umask 077; cp frontend/.env.example frontend/.env.local)
```

Configure the files before starting:

| File | Settings |
| --- | --- |
| `backend/.env` | The team's `DATABASE_URL` using `atlas_runtime`, trusted `DATABASE_CA_FILE` when required, and `GEMINI_API_KEY` / `GEMINI_MODEL`. Keep the example's `ATLAS_*_MODULE` paths. |
| `frontend/.env.local` | `VITE_DATA_MODE=api` and `VITE_MAPBOX_ACCESS_TOKEN` with the public Mapbox token. |

Environment files are ignored by Git. Gemini/database credentials stay in the backend file. The database must already be initialized; starting the app does not apply migrations or import news. See [database and credential setup](backend/docs/credentials-setup.md) for a new machine or service. Existing configured checkouts can skip first-time setup.

### Start the backend — terminal 1

Open a terminal at the repository root:

```bash
npm --prefix backend run dev
```

The API runs at **http://127.0.0.1:3001**.

### Start the frontend — terminal 2

Open a second terminal at the same repository root:

```bash
npm --prefix frontend run dev
```

Open **http://127.0.0.1:5173/** (or the URL Vite prints). Vite forwards `/api` requests to the backend on port 3001. Both terminals must remain running. Stop each with **Ctrl+C**; restart after changing environment settings.

### Check startup or use historical fixtures

```bash
curl http://127.0.0.1:3001/api/health/live
npm --prefix backend run check
```

Liveness should return `{"status":"ok"}`. With built shared contracts, the frozen handoff modules and database credentials configured, the local configuration check reports `ready_for_data:true`. It makes no network calls. Full `/api/health` readiness also depends on database connectivity; a 503 there does not indicate a dead process.

To inspect the labeled historical feed without a backend/database/Gemini connection, use this **instead of** the ordinary frontend command:

```bash
npm --prefix frontend run dev:fixture
```

Mapbox rendering still needs its public token and network access in fixture mode. There is no automatic switch to fixtures when the real API fails.

If a port is already in use, stop the earlier dev server in its terminal rather than starting duplicate processes. If the map reports a missing token, check `frontend/.env.local` and restart Vite. After pulling shared schema changes, rebuild with `npm --prefix contracts run build`. News refresh is a separate manual operation documented in [news refresh status](backend/docs/news-refresh-status.md).

## Current status

The frontend implements the approved globe-first Night Earth · Dark design: on-demand search/news/article panels, source-linked investigations, raw historical timelines, dated imagery, local saves, assistant integration UI and a bounded aircraft layer. The complete shared backend domain schema set is supplied under `contracts/`.

Person 3's [UI integration handoff](backend/docs/ui-integration-handoff.md) records working Tiger-backed news/location retrieval and Mapbox navigation; the [Gemini handoff](backend/docs/gemini-integration.md) records a separate live tool/citation diagnostic. This integration connects the assistant/investigation/timeline UI to those existing APIs. Full assistant and timeline behavior against live services still needs an end-to-end smoke check; historical fixtures and automated tests do not establish that result. See [frontend integration boundaries and remaining setup](frontend/docs/research-handoff.md).

Historical fixture mode is explicitly labeled and usable without a backend. Geographic rendering requires the restricted public Mapbox token. Assistant and raw timeline access do not require optional workspace discovery. Gemini/database credentials stay server-side and are never committed.

This is the **shared repository for all four people**. The human using this chat is **Person 3 — Backend and Gemini**; that does not limit the repository to backend work. Frontend/map implementation was authorized by the approved plan; backend, data execution and deployment retain their own ownership and authorization boundaries.

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

- `frontend/`: runnable full-screen React/Vite workspace, Zustand browser state, TanStack Query data hooks, typed API access, research panels, and Mapbox rendering.
- `backend/`: Fastify API, retrieval, provider adapters, and operational tooling; see [backend handoff](backend/README.md) for setup and remaining dependencies.
- `contracts/`: authoritative JSON Schemas, inferred TypeScript types, and historical examples owned by Person 1, matching Person 3’s existing protocol.
- `db/`: migrations, database handoff, and historical seed definitions owned by Person 4; file presence does not establish deployment.
- `assets/evidence/`: verified imagery/legends supplied by Person 4.
- `scripts/`: import definitions and startup tooling, with ownership recorded before implementation.
- `infra/`: Vultr/Caddy deployment supplied by Person 4.

The runtime plan is React/Vite + Mapbox → Fastify/Node.js → Gemini and Tiger Cloud PostgreSQL/TimescaleDB/pgvector. Caddy on Vultr serves the frontend and reverse-proxies `/api` under the project domain. No separate NoSQL/vector database is planned.
