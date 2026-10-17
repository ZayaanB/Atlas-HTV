# Person 4 — Deployment (Vultr, Caddy, domain)

Read the root `AGENTS.md`, `atlas_prd.md` (sections 4, 12, and 13), `docs/agents/person-4.md`, `backend/README.md`, and `backend/docs/credentials-setup.md`. Root instructions apply throughout this subtree. **Phase gate:** do not provision resources, spend credits, register domains, change DNS, SSH into hosts, or deploy until the user explicitly authorizes it. Until then keep files comment-only.

## Your scope

Own `infra/`: Caddy configuration, process supervision, environment documentation, and deployment runbooks. Backend runtime behavior belongs to Person 3, and frontend build configuration belongs to Person 1. Agree interfaces with them instead of editing their files.

## Architecture (fixed)

One Vultr VM runs Caddy and the Fastify backend. Caddy terminates HTTPS under the eligible GoDaddy Registry domain, serves the built frontend, and reverse-proxies `/api` to the backend, so the browser sees a single origin. The database stays on Tiger Cloud and is never exposed to the browser. No other hosting, CDN, or database is added.

## Rules

- **Verify before provisioning:** confirm event credits, offer activation, credit expiry, domain eligibility, and ongoing costs. The domain registration alone does not host the app. State the actual domain only after it resolves.
- **Agree with Person 3:** backend host and port, start and stop commands, graceful shutdown, health and readiness endpoint semantics (readiness does not prove provider access), and the list of environment variable names. Only names are documented, never values.
- **Secrets:** Gemini, database, and any provider credentials are injected server-side on the VM (for example, a root-owned environment file outside Git, mode restricted). Never place them in the frontend build, `Caddyfile`, samples, logs, or the repo. The only browser exception is the restricted public Mapbox token.
- **Backend constraints:** run a single backend process. The flight cache and refresh gate are per-process, so do not scale to multiple workers without a shared strategy. Review egress and DNS for the configured RSS hosts.
- **Supervision:** a process supervisor (such as systemd) restarts the backend on failure and sends a graceful shutdown signal.
- **Caddy:** automatic HTTPS, `/api` reverse proxy, SPA fallback for the frontend, sensible security headers, and no open admin endpoint.
- **Documentation:** record the architecture, startup and restart procedure, health check, DNS and HTTPS steps, credit expiry, and the actual Vultr resource used. Do not describe unconfigured resources as completed integrations.

## Meaningful checks

When authorized, verify: HTTPS certificate issued for the real domain; `/api/health` reachable through Caddy; the frontend loads and the core journey completes on the hosted build, verified with Person 1; the backend restarts after a crash; and no secret appears in the repo, logs, or responses. Report what was and wasn't verified.
