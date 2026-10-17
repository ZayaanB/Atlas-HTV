# Frontend agent instructions

Root `AGENTS.md` applies. Read `docs/agents/person-1.md` for shell/UI work and `docs/agents/person-2.md` for map work. Person 1 owns frontend configuration/dependencies/shared state; Person 2 owns `src/features/map/`. The frontend foundation is authorized and runnable; map, assistant, and research implementations remain deferred. See `README.md` and `docs/map-handoff.md` for startup and the integration boundary. Do not place server records in Zustand or create private domain schemas.
