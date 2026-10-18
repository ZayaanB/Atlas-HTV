# Deployment — Person 4 (Vultr VM + Caddy + eligible GoDaddy Registry domain)

## Status (2026-10-17)

The configuration below is written and partly validated locally. **Nothing has been provisioned or deployed:** no Vultr VM, domain, DNS record or certificate exists, and no Atlas URL is live. Do not describe any of these as completed integrations until they are.

| Item | Verified | Not verified |
| --- | --- | --- |
| `Caddyfile` | **Syntax.** `caddy validate` and `caddy fmt` pass (Caddy v2.10.2, official image). **Routing.** Run against the real backend with no credentials: `/api/health/live` returns 200 and `/api/health` returns 503 `not_ready`; data routes return the backend's structured 503; unknown `/api` routes return 404. SPA fallback serves `index.html`, `/evidence/*` serves PNG/JSON and hides `.md`, and a 783 KB body gets 413. **Headers.** All security headers are present. | Automatic HTTPS for a real domain (needs DNS); the CSP against Person 1's real build. |
| `atlas-backend.service` | Written from Person 3's implemented start/stop behaviour. | Not run under systemd: there is no Linux VM yet. |
| `deploy.sh` + `atlas-deploy.service` + `atlas-deploy.timer` | Written 2026-10-18. Pull/plan/rollback logic exercised locally against a throwaway Git repository with stubbed npm/systemctl/curl. | Not yet run on the VM. |
| `atlas-ingest.service` + `atlas-ingest.timer` | Written 2026-10-18. The refresh pass that `node dist/ingest.js --all` runs was exercised locally through a harness (same ingestion code, non-TLS local pool) against a disposable database with real GDACS and USGS responses. | Not installed or run under systemd on the VM. Not enabled against Tiger until migration 006 is applied there. |
| Accounts and credits | — | Vultr credits and their expiry, the GoDaddy Registry offer and domain eligibility, ongoing costs. **I have no access to these accounts.** A team member must check them before anything is provisioned. |

## Architecture

```text
Browser ──HTTPS──▶ Caddy on the Vultr VM (:443, automatic TLS for $ATLAS_DOMAIN)
                    ├─ /api/*       → reverse_proxy 127.0.0.1:3001 → Fastify (systemd: atlas-backend, ONE process)
                    │                                                  ├─ Tiger Cloud PostgreSQL (TLS, atlas_runtime role)
                    │                                                  ├─ Gemini API (server-side key)
                    │                                                  └─ ADSB.lol (disabled)
                    │
  systemd timer (every 20 min) → atlas-ingest.service → node dist/ingest.js --all → Tiger Cloud
                                   ├─ GDELT DOC, NASA RSS, GDACS RSS (news + GDACS event points)
                                   └─ USGS Water Data API (live gauge series)
                    ├─ /evidence/*  → /opt/atlas/assets/evidence (dated imagery + metadata)
                    └─ everything else → /opt/atlas/frontend/dist (SPA fallback to index.html)
```

There is one origin, so the backend needs no CORS. The database is never exposed to the browser. The only credential the browser sees is the restricted public Mapbox token, which is baked in at frontend build time.

## Interface with Person 3 (taken from the implemented backend; Person 3 to confirm)

| Topic | Value | Source in backend |
| --- | --- | --- |
| Host and port | `HOST=127.0.0.1`, `PORT=3001`. Loopback only; Caddy is the only public listener. | `src/config.ts` defaults |
| Start | `node dist/server.js` after `npm --prefix backend ci && npm --prefix backend run build`, with `WorkingDirectory=/opt/atlas/backend`. | `package.json` `start` (systemd supplies the environment instead of `.env`) |
| Stop | SIGTERM → stop accepting connections, cancel in-flight work, close the DB pool; forced exit after 15 s. systemd `TimeoutStopSec=20`. | `src/server.ts` |
| Liveness | `GET /api/health/live` → 200 `{"status":"ok"}` (the process is up). Used by Caddy's active health check. | `src/routes/health.ts` |
| Readiness | `GET /api/health` → 200 `ready` only when the contracts, all six core query plans and database connectivity are present; otherwise 503 `not_ready`. It does **not** prove Gemini or provider access. | same |
| Processes | Exactly one. The flight cache, provider refresh gate and rate limiter live in that process. | `backend/README.md` |
| Environment names | [`infra/.env.example`](.env.example) (names only). | `src/config.ts` |

**Open item for Person 3 (rate limiting behind a proxy).** The backend has `trustProxy: false`, so behind Caddy every request comes from `127.0.0.1`. That makes `RATE_LIMIT_MAX` (default 120/min) and the assistant limit (12/min) **global across all users**. Caddy replaces any client-supplied `X-Forwarded-For` with the real client address, so it is safe for the backend to trust exactly one hop. The proposed change, in Person 3's file `backend/src/app.ts`, is `trustProxy: '127.0.0.1'`. Until it lands, treat the limits as global.

## Before provisioning (a team member with account access)

1. **Vultr.** Confirm the event credit is activated, its amount and expiry date, and which plans it covers. The smallest plan that fits is 1 vCPU with 1–2 GB RAM, Ubuntu 24.04 LTS. Record the plan, region and hourly or monthly cost below. Set a billing alert.
2. **GoDaddy Registry.** Confirm offer eligibility through the event link (`https://mlh.link/GoDaddyRegistry`), and confirm the registration and renewal price and term. Registering a domain does not host anything.
3. **Tiger Cloud.** Confirm the service exists with TimescaleDB and pgvector, the trial or credit limits, and whether an IP allow-list is enabled. If it is, the VM's IPv4 address must be added.
4. **Record the results here:**

| Resource | Actual value | Verified by / date |
| --- | --- | --- |
| Vultr plan and region | _not provisioned_ | |
| Credit amount and expiry | _unknown_ | |
| Domain | _not registered_ | |
| Tiger Cloud service and region | _unknown to Person 4_ | |

## Deploy runbook (after authorization)

```bash
# 1. VM baseline (Ubuntu 24.04). Firewall: allow 22 (your IP only), 80 and 443; nothing else.
sudo ufw allow from <your-ip> to any port 22 proto tcp && sudo ufw allow 80,443/tcp && sudo ufw enable
# Node >= 22.12 (backend engines) from NodeSource or the official tarball; Caddy from its official apt repo.

# 2. Code: a read-only checkout owned by root, readable by the service users.
sudo useradd --system --home /opt/atlas --shell /usr/sbin/nologin atlas
sudo git clone <repo-url> /opt/atlas
sudo npm --prefix /opt/atlas/backend ci && sudo npm --prefix /opt/atlas/backend run build
# Person 1 builds the frontend (VITE_MAPBOX_ACCESS_TOKEN restricted to the domain; API base /api):
sudo npm --prefix /opt/atlas/frontend ci && sudo npm --prefix /opt/atlas/frontend run build   # -> frontend/dist

# 3. Secrets: outside Git, root-owned. Fill in from infra/.env.example (uncomment only what you set).
sudo install -d -m 0750 -o root -g atlas /etc/atlas
sudo install -m 0640 -o root -g atlas /dev/null /etc/atlas/backend.env && sudoedit /etc/atlas/backend.env
sudo install -m 0640 -o root -g caddy /dev/null /etc/atlas/caddy.env && sudoedit /etc/atlas/caddy.env   # ATLAS_DOMAIN=

# 4. Backend service.
sudo cp /opt/atlas/infra/atlas-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now atlas-backend

# 5. Caddy: give it the domain variable, then install the site config.
sudo systemctl edit caddy        # add:  [Service]  EnvironmentFile=/etc/atlas/caddy.env
sudo cp /opt/atlas/infra/Caddyfile /etc/caddy/Caddyfile && sudo install -d -o caddy -g caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl restart caddy
```

**Backend environment.** Set `NODE_ENV=production`, `HOST=127.0.0.1` and `PORT=3001`. Set `DATABASE_URL` for the **`atlas_runtime`** role, never `tsdbadmin`, and without `sslmode` parameters. The repository-relative modules are:
- `ATLAS_DATABASE_MODULE=db/handoff/database.mjs`, or Person 3's copy;
- `ATLAS_SOURCES_MODULE=scripts/source-definitions/atlas.mjs`;
- `ATLAS_CONTRACTS_MODULE`, once Person 1 supplies it.

Set Gemini settings only once Person 3 confirms the model. Keep `FLIGHTS_ENABLED=false`.

**Database preparation (Person 4, authorized separately).** From a trusted workstation, not the VM, apply migrations 001–005, `db/roles/atlas_runtime.sql` and the seed, following `db/README.md`.

## DNS and HTTPS

1. At the registrar's DNS for the eligible domain, create an `A` record for the apex (`@`) pointing to the VM's IPv4 address. Add an `AAAA` record only if the VM has IPv6 and port 443 is reachable on it. Optionally add `www` as a CNAME to the apex, then add it to the Caddyfile site address.
2. Wait for resolution: `dig +short <domain> A` must return the VM's IP from an outside resolver.
3. Caddy obtains and renews the certificate automatically once 80 and 443 are reachable. Watch `journalctl -u caddy -f` for "certificate obtained successfully".
4. Verify: `curl -sSI https://<domain>/` shows HTTP/2 200 and the HSTS header, and `curl -sS https://<domain>/api/health/live` returns `{"status":"ok"}`.

Record the actual domain in the status table only after step 4 succeeds.

## Health checks, restart and logs

```bash
curl -sS https://<domain>/api/health/live          # liveness: 200
curl -sS https://<domain>/api/health               # readiness: 200 ready / 503 not_ready (does not prove Gemini/provider access)
systemctl status atlas-backend caddy
journalctl -u atlas-backend -n 100 --no-pager      # Fastify JSON logs; bodies/headers/credentials are redacted by the backend
sudo tail -n 50 /var/log/caddy/atlas-access.log
```

- **Restart on crash.** `Restart=on-failure` with `RestartSec=5`. Verify with `sudo systemctl kill -s SIGKILL atlas-backend`: it should be `active (running)` again with a new PID about 5 s later. More than 10 failures in 5 minutes stops the restarts; inspect the journal.
- **Graceful restart after a deploy.** Use `infra/deploy.sh` (next section). Requests in flight get up to 15 s.
- **Configuration changes.** After `/etc/atlas/backend.env` changes, run `sudo systemctl restart atlas-backend`; environment files are not reloaded live.
- **Caddy reload.** `sudo systemctl reload caddy`. The admin API listens on `127.0.0.1:2019` only.

**Egress the VM needs:**

| Purpose | Host | When |
| --- | --- | --- |
| Database | The Tiger Cloud host and port | Always |
| Gemini | `generativelanguage.googleapis.com` | Always |
| Ingestion | `api.gdeltproject.org`, `science.nasa.gov`, `www.gdacs.org`, `api.waterdata.usgs.gov` | Every 20 minutes once `atlas-ingest.timer` is enabled, or a manual `ingest` |
| Flights | `api.adsb.lol` | Only after flights are enabled |
| Certificates | Let's Encrypt / ZeroSSL ACME endpoints | Certificate issue and renewal |

## Deploying updates

`infra/deploy.sh` fast-forwards `/opt/atlas` to `origin/main` and rebuilds only what changed: contracts (which also rebuilds the backend and frontend), backend, and frontend. The frontend builds into `dist.next` and is swapped in, so Caddy never serves a half-built site. The backend restarts only for changes it loads at runtime, never for frontend, evidence, or docs-only changes. The new release must pass `/api/health` within 60 s, or only `/api/health/live` if the old one was not ready either. If a build or that check fails, the script resets to the previous commit, rebuilds, restarts, and records the failed commit.

```bash
sudo bash /opt/atlas/infra/deploy.sh                     # deploy now (waits for a running ingestion pass)
sudo bash /opt/atlas/infra/deploy.sh --force             # rebuild everything even when up to date
sudo bash /opt/atlas/infra/deploy.sh --allow-migrations  # after applying new db/migrations on Tiger
```

It refuses to run if tracked files in `/opt/atlas` have local edits or `main` was rewritten, and it stops on db/migrations changes until `--allow-migrations` is given. It does not change `/etc/atlas`, `/var/lib/atlas` (the flight ledger), the database, or the installed systemd and Caddy files. If an update changes `infra/*.service`, `*.timer`, or the `Caddyfile`, it logs a note so you can install them by hand.

**Automatic deploys (optional).** `atlas-deploy.timer` runs `deploy.sh --auto` every 5 minutes. When nothing is new, a run is one `git fetch` and no output. Auto mode never waits: it skips a run while ingestion is active and doesn't retry a commit that was rolled back. Updates touching db/migrations are held, and that run is marked failed in `systemctl status atlas-deploy`. A later manual deploy clears both.

```bash
sudo cp /opt/atlas/infra/atlas-deploy.service /opt/atlas/infra/atlas-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now atlas-deploy.timer
journalctl -u atlas-deploy -n 50 --no-pager      # what each deploy did
sudo systemctl disable --now atlas-deploy.timer  # back to manual deploys
```

Each backend restart clears the in-memory flight snapshot, so the next viewer can spend one AirLabs attempt. Frequent merges to `main` therefore cost flight quota while flights are enabled.

## Scheduled ingestion (after migration 006 is on Tiger)

`atlas-ingest.timer` starts `atlas-ingest.service` 5 minutes after boot and then every 20 minutes (±1 minute jitter). Each pass runs every reviewed source in `scripts/source-definitions/atlas.mjs` once, one at a time: GDELT requests at least 6 s apart, each source bounded to 60 s, and a source in stored backoff is skipped without a request. The pass exits non-zero only if no source succeeded and at least one failed; backoff skips are not failures. It never deletes stored records.

```bash
sudo cp /opt/atlas/infra/atlas-ingest.service /opt/atlas/infra/atlas-ingest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start atlas-ingest.service      # one pass now; check the result below before enabling
sudo journalctl -u atlas-ingest -n 50 --no-pager # one JSON line with a status per source
sudo systemctl enable --now atlas-ingest.timer
systemctl list-timers atlas-ingest.timer
```

Pause it with `sudo systemctl disable --now atlas-ingest.timer`. The API keeps serving stored records either way.

## Secrets checklist

- **Server-side only.** Database and Gemini credentials exist only in `/etc/atlas/backend.env` (mode 0640, root:atlas) or a developer's git-ignored `backend/.env`.
- **Never committed.** No secret or domain value appears in `Caddyfile`, the unit file, `.env.example`, logs, screenshots or the Devpost entry.
- **Admin credentials stay off the VM.** `tsdbadmin` is used only from a workstation for migrations and is never stored on the VM.

## Sponsor use: what will count once done

- **Vultr.** The deployed app runs on the VM recorded above, and the public HTTPS URL completes the core journey, verified with Person 1.
- **GoDaddy Registry.** The eligible domain resolves to the VM and serves Atlas over HTTPS.

Until then, both are planned, not implemented.
