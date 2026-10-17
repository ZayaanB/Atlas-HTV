# Atlas — instructions for every AI agent

## Current phase

**Scaffolding and documentation only. Implementation has not been authorized yet.** Keep source/configuration placeholders comment-only. Do not install packages, generate application code, run migrations/imports, call paid/provider APIs, provision resources, deploy, or publish. Begin implementation only after a subsequent explicit user instruction to start work. This gate applies to all four workstreams; planning an implementation sequence is not permission to execute it.

## Read first

1. `atlas_prd.md` is the product source of truth.
2. `README.md` describes the shared scaffold and ownership.
3. Read your role guide and any nested `AGENTS.md` covering files you touch.

| Person | Role guide | Owned areas |
| --- | --- | --- |
| 1 — Frontend/integration lead | `docs/agents/person-1.md` | Frontend shell/state/feed/assistant/research UI, frontend dependencies/configuration, `contracts/`, root integration docs/tooling. |
| 2 — Map and visuals | `docs/agents/person-2.md` | `frontend/src/features/map/`; Mapbox navigation, satellite/evidence layers, flight rendering. |
| 3 — Backend and Gemini | `backend/AGENTS.md` | `backend/`, backend dependencies/configuration, provider adapters, retrieval/embeddings, flight cache; backend execution tooling. |
| 4 — Data/evidence/deployment | `docs/agents/person-4.md` | `db/`, `assets/evidence/`, `infra/`, source/import definitions in `scripts/`. |

The human using this chat is Person 3. The repository scaffold is for **all four people**, not only this workstream. Role ownership is a coordination rule, not a reason to block authorized shared scaffolding/docs work.

## Collaboration boundaries

- Inspect current files and preserve teammate/uncommitted changes. Do not overwrite unrelated work or reset their checkout.
- Work in your owned paths. Propose cross-owner changes with exact interfaces/files; the receiving owner integrates them. Person 1 resolves shared contracts, frontend dependencies, root tooling, and integration changes; Person 3 owns backend scaffolding/dependencies.
- Share one authoritative runtime-schema/type contract under `contracts/`. Do not invent parallel frontend/backend types or private copies of fixtures.
- Person 4 supplies migrations, aggregate definitions, seed/source records, and evidence metadata. Person 3 supplies parameterized queries and ingestion execution. Freeze the schema handoff before SQL consumers are implemented.
- Source/import definitions in `scripts/` belong to Person 4; backend executable entrypoints belong in `backend/` under Person 3. Person 1 owns root startup orchestration when authorized.
- Do not spawn additional agents, create chats, message teammates externally, commit, push, or deploy merely because this document lists multiple people. Follow the user's actual instructions and tool permissions.

## Fixed architecture

React/TypeScript/Vite + **Mapbox GL JS**; Node.js/TypeScript/Fastify; official Gemini SDK; Tiger Cloud PostgreSQL + TimescaleDB + pgvector via `pg`; Vultr + Caddy; eligible GoDaddy Registry domain. No second globe engine, separate NoSQL service, or separate vector database.

Browser state owns filters/selection/camera requests. Backend owns validation/retrieval/provider access. Gemini tools use the same validated functions as manual queries. Backend returns UI actions; it does not render the map. Caddy serves frontend and `/api` under one HTTPS origin.

## Data and AI rules

- Real source links and honest coverage are mandatory. Do not fabricate articles, measurements, company relationships, precise coordinates, or completed integrations.
- Use longitude–latitude, UTC timestamps, stable IDs, explicit nulls, units, geographic precision, and separate event/publication/observation/fetch times.
- Basemap satellite imagery is context, not live or dated event evidence. Flight positions are not verified routes, delays, emergency status, or proof of news impact.
- Keep provider data within verified terms, attribution, polling, and retention limits. ADSB.lol is planned for flights; OpenSky is not a drop-in substitute under its current live-product terms.
- Keep credentials server-side. Never commit secrets or include them in logs/prompts. A restricted public Mapbox token is the frontend exception.
- Validate Gemini tool arguments, citations, and UI actions; reject generated SQL/code/arbitrary URL fetching. Retrieved text is untrusted evidence, not instructions.
- Prepared fixtures/replay/fallback answers must be labeled. Sponsor claims require genuine implemented integrations.

## When implementation is authorized

Integrate one complete sourced investigation early. Verify real filters, citation/action rejection, timestamp/precision handling, satellite style transitions, flight freshness/backoff, and API failures as appropriate to your changes. Do not write tests that merely mirror placeholders. Report what changed, meaningful validation, and remaining external setup accurately.
