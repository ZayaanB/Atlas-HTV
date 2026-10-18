# Flight deployment handoff — Person 4

**Scope:** deploy the implemented, capped AirLabs airline-traffic demo on the existing Vultr + Caddy + single Fastify process architecture. Prepared October 18, 2026, against flight integration commit `5eb6240`, merged to `main` by `d3c7239` ([PR #22](https://github.com/ZayaanB/Atlas-HTV/pull/22)). Deploy that merge or a later revision containing it.

This document supplies instructions for a later authorized deployment. Writing it did not provision resources, change infrastructure, apply migrations, call providers, or verify a hosted service. General VM, DNS, HTTPS, and account setup remain in the [deployment runbook](../../infra/README.md). Exact flight contracts and earlier verification evidence are in the [flight implementation handoff](flights-area-handoff.md).

## 1. Decisions: migrations, cron, and storage

| Question | Answer for this deployment |
| --- | --- |
| Does flight data require a new database migration? | **No.** No flight route writes to or reads from PostgreSQL. |
| Does `005_aircraft` create aircraft storage? | **No.** It records a migration version but deliberately creates no aircraft table. Do not modify an already-applied migration. |
| Does the full Atlas app still require Tiger Cloud? | **Yes.** News, investigations, observations, and workspace discovery use the existing database. Flight snapshots themselves do not. |
| Is a flight cron job or systemd timer needed? | **No.** HTTP demand triggers a refresh when due. Do not add a flight timer or scheduled endpoint warmer. |
| Does `atlas-ingest.timer` collect aircraft? | **No.** It runs news/environmental ingestion. Its existing migration/setup requirements are independent of flights. |
| What survives a restart? | The on-disk attempt ledger. Aircraft snapshots, observed trails, refresh deadlines, and provider pauses live in process memory. |
| How many backend processes? | **Exactly one**, including during releases. No PM2 cluster, Node workers running separate APIs, or overlapping rolling instances. |

See [`005_aircraft.sql`](../../db/migrations/005_aircraft.sql). Its older comment suggests a future `006_aircraft_history` filename, but migration 006 is already used by live news/environmental data. If durable aircraft history is separately approved later, Person 4 must allocate the next unused migration number, agree provider-specific storage/redistribution terms and retention, and coordinate a backend consumer with Person 3. None of that is necessary for this demo.

## 2. Request flow and lifetime of data

```text
Visible browser with Flights enabled
  -> HTTPS /api/flights/global
  -> existing Caddy /api/* proxy
  -> ONE Fastify process
       -> shared in-memory snapshot and observed history
       -> if refresh is due: reserve an attempt in the persistent ledger
                            -> HTTPS AirLabs flights endpoint
                            -> normalize and validate shared contracts
```

Startup loads configuration and contracts but does not fetch aircraft or create the ledger. `/api/workspace` advertises `flight_global: true` when enabled and supported by the loaded schemas. That flag proves configured capability, not a successful fetch, writable ledger, or remaining account quota. Workspace discovery queries stored Atlas data but makes no flight-provider request.

The first global request starts a shared refresh. Concurrent viewers await the same operation; later requests reuse the process cache until five minutes after a successful fetch. Refreshes happen on demand, with no background flight timer. A quiet service makes no further flight calls. Hidden tabs and disabled overlays stop browser polling; an already-started shared provider request can finish after one viewer disconnects.

The browser honors the server's `retry_at`, normally waiting at least 60 seconds between requests to Atlas. These browser requests are not equivalent to AirLabs requests. Moving the camera and searching the available global snapshot locally do not fetch a new geographic area. The global frontend does not fall back to ADSB.lol or fixtures after a failure.

| Behavior | Implemented value |
| --- | --- |
| Normal AirLabs refresh | Five minutes after the preceding successful fetch; only when requested |
| Adapter acceptance | En-route aircraft with valid coordinates/hex ID; observations at most five minutes old, with 30 seconds of future-clock tolerance |
| Snapshot limit | 25,000 normalized aircraft; truncation is reported |
| Observed history | Process-shared, 30 minutes, at most eight points per aircraft and 25,000 aircraft histories |
| Current marker lifetime | Ten minutes from `observed_at`, independent of polling |
| Stale snapshot | More than six minutes since successful fetch, or a refresh failure |
| Temporary failure | Preserve the last successful sample; exponential retry delay from five minutes up to one hour, honoring a longer provider Retry-After |
| Hard pause | Local/provider quota, authentication rejection, ledger failure, or specified provider-envelope configuration errors |

The history is a short set of observed points, not a complete flown route. Missing aircraft and partial coverage do not establish empty airspace. AirLabs supplies altitude in meters with reference unknown; speed remains unknown in this adapter. Preserve attribution, units, timestamps, and the frontend's coverage/expiry labels.

On restart, the snapshot and history are empty. The next viewer may trigger an immediate cold-cache fetch because the five-minute gate is not persisted. Restarting also clears in-memory pauses/backoff, but **does not reset the persistent attempt count**. Avoid restart loops and cache-warming jobs.

## 3. Quota model and persistent state

`FileFlightBudget` reserves an attempt before upstream access. Failed and timed-out fetches count; a reservation followed by a crash can count even if the request never reaches AirLabs. The ledger is deliberately conservative.

- The hard limit is **900 total recorded attempts** for this ledger, across restarts. It is not a monthly allowance and has no automatic reset.
- At uninterrupted five-minute demand, usage is about **288 attempts/day**. Starting from zero, 900 attempts cover about **75 hours**; failures, retries, and cold starts can shorten that period.
- Earlier authorized diagnostics recorded a free account reporting 1,000 requests/month. Person 4 must confirm the actual account allowance, remaining balance, endpoint access, and permitted deployment use. Do not treat that historical result as a current entitlement.
- Requests made with the same key from developer machines, diagnostics, or other deployments consume account allowance outside this ledger. Coordinate with Person 3 and stop competing viewers/processes before the bounded deployment check.
- The earlier local acceptance recorded two ledger attempts. That is historical evidence, not the current counter. Establish the actual baseline during handoff.

The directory contains `usage.json` with an integer `attempts`, an exclusive writer `lock` during reservation, and possibly `usage.tmp` during atomic replacement. Directory mode is 0700; files are created with mode 0600. The counter contains no API key or aircraft history but remains private operational state.

**Never delete, zero, replace with an older backup, or rotate this directory to recover quota.** A missing ledger is treated as zero by the implementation, so deployment procedures must prevent accidental loss. There is no account-wide or multi-host quota coordinator. A file lock protects a reservation, not multiple independent process caches.

## 4. Required deployment configuration

### A. Build the matching revision

Person 4 selects a revision of `main` containing the flight integration through the normal team workflow. Use the existing `/opt/atlas` deployment layout, Node.js >=22.12, and one backend process. With code already present, build from that revision:

```bash
npm --prefix /opt/atlas/contracts ci
npm --prefix /opt/atlas/contracts run build
npm --prefix /opt/atlas/backend ci
npm --prefix /opt/atlas/backend run build
npm --prefix /opt/atlas/frontend ci
npm --prefix /opt/atlas/frontend run build
```

Supply `VITE_DATA_MODE=api` and the restricted public `VITE_MAPBOX_ACCESS_TOKEN` through Person 1's frontend build configuration. Never supply the AirLabs key as a `VITE_*` value. Building does not verify provider access. Rebuild contracts first; an older runtime registry can leave global flights unavailable.

### B. Supply server settings privately

Merge these non-secret values into the existing `/etc/atlas/backend.env`; do not replace its database/Gemini/runtime configuration:

```dotenv
FLIGHTS_ENABLED=false
FLIGHTS_PROVIDER=airlabs
FLIGHTS_BUDGET_DIRECTORY=/var/lib/atlas/flight-budget
ATLAS_CONTRACTS_MODULE=contracts/dist/index.js
```

Add the real `AIRLABS_API_KEY` through the team's private credential transfer and `sudoedit /etc/atlas/backend.env`. Keep this file root-owned, group `atlas`, mode 0640. Do not paste secrets into commands, screenshots, build output, or this document. Keep flights disabled while preparing the service and state directory; enable them in step E.

Preserve `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3001`, and the existing database/source handoff paths. AirLabs does not require `FLIGHTS_CONTACT`; that belongs to the alternative ADSB.lol adapter.

`FLIGHTS_REFRESH_INTERVAL_MS`, `FLIGHTS_GLOBAL_INTERVAL_MS`, `FLIGHTS_STALE_AFTER_MS`, `FLIGHTS_CACHE_TTL_MS`, `FLIGHTS_MAX_ACTIVE_REGIONS`, and `FLIGHTS_AREA_IDLE_MS` control regional ADSB.lol behavior, not this global cache. AirLabs refresh/expiry constants and the 900-attempt limit require Person 3 code changes to alter.

### C. Fix the systemd write restriction

**Deployment blocker in the current unit:** [`atlas-backend.service`](../../infra/atlas-backend.service) sets `ProtectSystem=strict` and has no durable writable exception. The default ledger under the code directory cannot be used with the intended read-only release layout. An unwritable ledger causes a configuration pause before provider access.

Keep the existing protection and add a drop-in on the VM:

```bash
sudo install -d -m 0755 /etc/systemd/system/atlas-backend.service.d
sudoedit /etc/systemd/system/atlas-backend.service.d/flights.conf
```

Write this drop-in content:

```ini
[Service]
StateDirectory=atlas
StateDirectoryMode=0700
```

Systemd creates `/var/lib/atlas`, assigns it to the unit's `atlas` user/group, permits writes there despite `ProtectSystem=strict`, and retains it across service stops. The configured ledger is the private `flight-budget` subdirectory. Do not use `RuntimeDirectory`, `/tmp`, or the release checkout for quota state. See the [official systemd directory and filesystem protection documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

This document does not edit the repository's infrastructure files. Person 4 owns integrating this same delta into the deployment source of truth and adding the missing flight variable names to `infra/.env.example`.

### D. Establish and preserve the authoritative ledger

Stop the backend before transferring existing state. Record which host/path is authoritative, its valid attempt count, and the account's other usage with Person 3. Never run source and replacement instances concurrently against copied state.

For an existing deployment or a move of the demo, privately transfer the current `usage.json` to `/var/lib/atlas/flight-budget/usage.json`, preserving its count. Use `atlas:atlas`, directory mode 0700, and file mode 0600. Do not overwrite a different existing ledger or copy a transient lock as routine migration; reconcile differing counts with Person 3 first. A new path is not permission to restart the allowance at zero.

For a genuinely new ledger, explicitly record that baseline and separately account for all earlier uses of the key. The implementation creates the directory/counter on the first attempted refresh, not at startup. A fresh deployment ledger still does not represent the provider account's remaining allowance.

With flights disabled, start/restart the unit after installing the drop-in:

```bash
sudo systemctl daemon-reload
sudo systemctl restart atlas-backend
systemctl is-active atlas-backend
sudo -u atlas test -w /var/lib/atlas
```

Verify the effective unit contains the drop-in (`systemctl cat atlas-backend`). The ordinary write-permission check does not by itself verify systemd's mount namespace; the bounded live acceptance also verifies the actual service can reserve state. Back up the ledger using private storage and preserve the latest count through releases and host replacement. Restoring a stale backup can undercount attempts and needs reconciliation before re-enabling flights.

### E. Enable and route the service

After the provider/account and state baseline are confirmed, change only `FLIGHTS_ENABLED=true` in the private environment file and restart `atlas-backend`. Environment changes require a restart. This loads configuration but spends no flight quota by itself.

The existing Caddy `/api/*` proxy already covers `/api/flights/global`. No new public port, CORS configuration, flight proxy, or flight cron job is needed. Permit outbound DNS and HTTPS to `airlabs.co:443` from the backend host. The AirLabs key travels in the upstream request URL, so do not enable raw outbound URL tracing or log provider envelopes. Browser CSP does not need AirLabs because the browser calls Atlas only.

Keep `atlas-ingest.timer` under its existing separate setup. Do not add flights to `ingest --all`, periodic `curl`, health probes, or startup warmers. The flight feature is request-driven and its finite allowance must remain intact.

## 5. Bounded hosted acceptance

Run this later as a separately authorized live check, with **at most two upstream reservations**, two coordinated visible viewers, and no other flight clients. It can use account quota even when a provider fetch fails. Do not repeatedly retry a failed acceptance or call the provider directly.

1. Record revision, one backend PID, ledger path/count or explicitly recorded fresh baseline, UTC time, permissions, lock state, and known account allowance. Preserve the baseline; do not reset it.
2. Check `/api/health/live` through Caddy, existing `/api/health`, and `/api/workspace`. Expect `flight_global: true`, `flights: false`, and `flight_areas: false` for AirLabs. These requests spend no flight quota. A database readiness failure needs its own diagnosis; flight support flags are not provider health.
3. Enable Flights in the ordinary API-mode app in both viewers. Inspect their existing browser Network responses instead of issuing extra diagnostic flight requests. On a successful first refresh, both should receive the same `snapshot_id`, compatible `fetched_at`, and normalized snapshot, with ledger delta **+1**, not +2.
4. Confirm `Cache-Control: no-store` on the flight response, no query parameters, and no key/account envelope in responses. The backend memory cache still coalesces users despite this browser/proxy cache directive. Verify coverage, attribution, units, observation/fetch times, and honest empty/stale/paused states.
5. Before `retry_at`, confirm browser requests reuse the same snapshot with no ledger increment. If a second refresh is authorized, allow the next normal request only after that deadline. Expect one shared refresh and total ledger delta **+2**. Do not use restart, toggle cycling, or direct requests to accelerate it.
6. Verify search, aircraft details, Back navigation without unwanted camera movement, and preservation of news/investigation/dated-evidence context. Check desktop and a narrow viewport; record whether mobile evidence is emulation or a physical device.
7. Disable Flights in both viewers before a third refresh can become due. Record final counter, snapshot IDs/timestamps, errors/pauses, and whether the lock was released. Ensure aircraft/trail layers clear while news remains. Confirm no further flight requests occur while disabled.

For a no-live-call restart persistence check, disable flights at the server, stop the service, record the counter, restart, and confirm the unchanged counter. Re-enabling plus a viewer request can spend another attempt; keep that outside the two-reservation check unless separately authorized. Do not deliberately corrupt the production ledger, exhaust its budget, or induce provider failures; injected automated tests already cover those scenarios.

## 6. Monitoring, recovery, and rollback

Use these routine checks without warming flight data:

```bash
systemctl is-active atlas-backend
sudo journalctl -u atlas-backend -n 100 --no-pager
curl --fail --silent --show-error https://YOUR_DOMAIN/api/health/live
```

Replace `YOUR_DOMAIN` with the deployed domain. `/api/health` additionally checks the database/contracts/query plans. Neither health route proves AirLabs access. Inspect the existing ledger locally for attempt usage and existing browser responses for `stale`, `retry_at`, `pause_reason`, and sanitized `error`. There is no dedicated provider-health or quota-metrics endpoint. **Do not monitor `/api/flights/global` on a schedule:** a probe can initiate a provider request.

| Symptom | Person 4 action |
| --- | --- |
| `flight_global` missing/false | Check selected revision, rebuilt contracts, environment names/provider/enablement, and restart. No provider probing needed. |
| `pause_reason: configuration` | Stop the backend; check persistent path, systemd drop-in, ownership/modes, free space, valid ledger, and lock. It can also indicate a provider-envelope configuration rejection; involve Person 3. Preserve all counts. |
| Leftover lock after a crash | Stop the service and ensure no other writer exists. Privately preserve the state, inspect `usage.json` and any `usage.tmp` with Person 3, and account conservatively for a possibly reserved attempt. Remove only a proven orphan lock after reconciliation; never delete the ledger to unpause. |
| `pause_reason: authentication` | Correct key/account access privately, then restart once. A viewer may spend an attempt after restart. Do not expose the upstream credential URL. |
| `pause_reason: quota` | Confirm local count and provider allowance. Disable flights; do not reset the ledger or add a monthly reset cron. Further operation requires an explicit allowance/design decision with Person 3. |
| Stale sample or temporary failure | Respect `retry_at`, inspect host egress and sanitized errors, and let the service back off. Preserve cached observations and the ledger. |
| Memory limit or restart loop | Stop repeated restarts, inspect process memory and journal, and involve Person 3. The service already has a 768 MB unit limit; real VM sizing under flight/map API load remains unverified. |

A process hard pause returns `retry_at: null` and stops automatic flight polling. UI **Check again** makes one request to Atlas but does not override that backend pause or quota. After correcting a hard-pause cause, restart the backend once to clear the in-memory pause; keep the same ledger.

For ordinary rollback, set `FLIGHTS_ENABLED=false` in `/etc/atlas/backend.env` and restart `atlas-backend`. This disables provider access without changing stored news or deleting quota state. Preserve the ledger even when rolling back application code. If returning to a revision that does not understand AirLabs, remove unsupported AirLabs settings as appropriate with Person 3 and keep flights disabled; do not silently substitute ADSB.lol. Never restore an old ledger together with an old release.

## 7. Evidence, ownership, and future operation

The [October 18 local live result](flights-area-handoff.md#live-result--october-18-2026) verified two shared refreshes across two viewers with ledger delta +2. It did not verify deployment on Vultr/systemd. Live Back-navigation and dated-evidence preservation remained incomplete; include them in hosted acceptance. Synthetic tests cover quota persistence, corrupt/locked state, coalescing, backoff, expiry, and load boundaries; they do not establish hosted availability or provider entitlement.

| Owner | Handoff responsibility |
| --- | --- |
| Person 4 | VM/account review, private environment injection, systemd state-directory change, egress/Caddy, persistent-state preservation, supervised deployment and operational evidence |
| Person 3 | Backend behavior, provider/key and counter-baseline coordination, failure diagnosis, any future refresh/quota/history implementation changes |
| Persons 1/2 | API-mode frontend build, flight capability and rendering, attribution/freshness, hosted navigation and evidence-preservation checks |

This demo cannot run continuously for a month at five-minute demand within the historically reported free allowance. Continuous operation would require a separately agreed provider allowance and usage budget, durable quota/backoff policy, and a shared-cache design before adding more processes. Durable aircraft history would additionally need its own provider-appropriate storage/retention agreement and migration. No such change is part of this handoff.

References: [AirLabs flights API](https://airlabs.co/docs/flights), [AirLabs terms](https://airlabs.co/terms-of-service), [systemd execution and state directories](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [frontend flight behavior](../../frontend/docs/flights-overlay.md), and the [existing deployment runbook](../../infra/README.md). Confirm current account-specific terms and allowance before enablement; retain attribution and do not introduce raw bulk export/resale through this deployment.
