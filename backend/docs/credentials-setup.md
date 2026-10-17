# Configure the merged backend, Tiger Cloud and Gemini

The backend scripts load `backend/.env`, not `.env.local`. This file is Git-ignored and has owner-only permissions (0600). Preserve its existing Gemini key/model. Never copy the example over a populated file or paste credentials into chat.

## Current workspace status

- Branch: `feat/zayaan/backend-live-setup`, based on the pulled `main`.
- Gemini: the existing key/model passed a real `models.get` metadata check. Generation, quota and grounded answers are not yet verified.
- Tiger CLI: authenticated, with saved admin credentials for existing READY DEV service `apzql812ni` (`db-87363`). No new service was provisioned.
- Tiger endpoint: `apzql812ni.rz02n2sqq8.tsdb.cloud.timescale.com:35967`, database `tsdb`.
- The user supplied `tiger_cloud_chain.pem`; verified TLS now passes. Migrations 001–005, runtime grants and the historical Helene seed are applied. Runtime login/read access passed: 10 articles, 7,467 observations, one investigation.
- Real merged contract/database/source module paths are configured. Sixteen shared schemas remain missing; credentials cannot supply them.

## 1. Build the shared contract export

From the repository root:

```bash
cd /home/zayaan/Documents/Projects/HTV
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix backend ci
```

These steps are already done in this workspace. Rebuild contracts after pulling schema changes. The backend consumes Person 1's compiled `contracts/dist/index.js`; it does not define a second contract.

Only for a fresh checkout without an environment file:

```bash
test -e backend/.env || (umask 077; cp backend/.env.example backend/.env)
```

The merged module settings are:

```dotenv
ATLAS_CONTRACTS_MODULE=contracts/dist/index.js
ATLAS_DATABASE_MODULE=db/handoff/database.mjs
ATLAS_SOURCES_MODULE=scripts/source-definitions/atlas.mjs
```

## 2. Configure Tiger certificate trust

Open the [existing service in Tiger Console](https://console.cloud.tigerdata.com/dashboard/services/apzql812ni). Obtain the trusted CA bundle for this service through the authenticated console or Tiger support. Save it outside Git, for example `/home/zayaan/.config/atlas/tiger-ca.pem`, then provide only its file path.

This workspace is already configured with the user-supplied `/home/zayaan/Documents/Projects/HTV/tiger_cloud_chain.pem`. Keep that file at its configured path or update `DATABASE_CA_FILE` after moving it. It remains an untracked user file; the backend commit commands do not stage it.

A CA certificate is public trust material, not the database password. Do not trust a certificate merely because it was downloaded from the currently unverified connection. Keep hostname and certificate verification enabled. If Tiger replaces the service chain with a publicly trusted certificate, a custom CA may no longer be needed; rerun the verified check to confirm.

## 3. Initialize the existing DEV service

Requires authenticated `tiger`, saved admin database password, and `psql` (installed here: PostgreSQL client 18.6). Authentication to the management API and PostgreSQL authentication are separate. `tiger db uri` reads the CLI's saved role password; the backend does not use a Tiger management API key as a database password.

Initialization is already completed here. On a new empty DEV service, after obtaining its trusted CA, run:

```bash
npm --prefix backend run setup:tiger -- \
  --service apzql812ni \
  --ca-file /home/zayaan/Documents/Projects/HTV/tiger_cloud_chain.pem \
  --initialize
```

Replace the CA path with the actual trusted file. If a publicly trusted chain has been verified, omit `--ca-file`.

`--initialize` explicitly permits database writes. The command:

1. Requires an existing READY DEV service and verifies TLS before SQL changes.
2. Checks migration history, refusing unknown versions or an unrecognized Atlas schema.
3. Applies only missing committed migrations `001_extensions` through `005_aircraft` in order.
4. Applies `db/roles/atlas_runtime.sql`. Creates a random password only for a newly created runtime role; preserves existing role passwords.
5. Saves the runtime connection to private `backend/.env` while preserving Gemini and other settings. Admin credentials are never stored there. It attempts to cache the new runtime password in Tiger CLI's keyring as well.
6. Verifies login/read access using `atlas_runtime`.
7. Loads Person 4's curated Helene seed only when the database has no investigation or partial source/location/evidence/article/observation records. Existing investigation data is preserved. This historical dataset is not a live feed.

The CLI uses private temporary password files, captures subprocess output without printing credentials, and removes temporary files on normal completion/failure. Migrations and seeds have their own transactions; completed migrations remain after a later failure. Reruns resume known migrations. Do not run multiple initializers concurrently. A failed seed/verification may leave a privately saved runtime connection for recovery; the reported phase identifies where to resume. If the seed transaction committed but its final aggregate refresh failed, coordinate with Person 4 to refresh the existing aggregate without reloading the seed.

For an already initialized service with the runtime password saved in Tiger CLI, omit `--initialize`. That mode performs read-only checks and local environment configuration, with no cloud DDL/imports.

```bash
npm --prefix backend run setup:tiger -- \
  --service apzql812ni \
  --ca-file /home/zayaan/Documents/Projects/HTV/tiger_cloud_chain.pem
```

If an existing runtime password is unavailable, obtain it from the owner or save it in Tiger CLI. The setup command intentionally does not reset a teammate's role password. Its error output never includes raw provider/SQL errors or credentials.

## 4. Verify the connections and remaining handoffs

```bash
npm --prefix backend run verify:connections -- --database
npm --prefix backend run verify:connections -- --gemini
npm --prefix backend run check
git check-ignore backend/.env
stat -c '%a' backend/.env
```

Database success reports verified TLS and installed TimescaleDB/pgvector extensions. Gemini success verifies metadata access and advertised generation support only; it makes no answer/embedding request. The final two commands should report `backend/.env` and `600`.

`check` still exits 2 while the missing shared schemas remain. As of this pull they are: `InvestigationQuery`, `InvestigationResponse`, `ObservationsQuery`, `ObservationsResponse`, `CompareObservationsArgs`, `FlightsQuery`, `FlightsResponse`, `FindAircraftArgs`, `FlightRegion`, `FocusLocationArgs`, `UIAction`, `AssistantRequest`, `AssistantDraft`, `AssistantResponse`, `Observation`, `AircraftState`. Person 1 owns these definitions; backend does not bypass their validation.

## 5. Start and inspect the backend

```bash
npm --prefix backend run dev
```

In a second terminal:

```bash
curl -i http://127.0.0.1:3001/api/health/live
curl -i http://127.0.0.1:3001/api/health
# Database initialization is complete in this workspace:
curl 'http://127.0.0.1:3001/api/locations?query=Asheville'
curl 'http://127.0.0.1:3001/api/news?location_ids=loc-asheville-nc&limit=20'
```

Liveness can return 200 now. Readiness stays 503 until all required schemas and the database are available. News/locations can use their supplied schemas once the database is connected. Missing investigation/assistant/flight schemas return explicit errors. Restart after editing `.env`; stop with Ctrl+C.

## Gemini key setup for another checkout

Open [Google AI Studio API keys](https://aistudio.google.com/app/apikey), select/import the intended team project and obtain a Gemini API key. Set `GEMINI_API_KEY` and an exact available function-calling model ID in the server-only `.env`. [Official key instructions](https://ai.google.dev/gemini-api/docs/api-key), [model documentation](https://ai.google.dev/gemini-api/docs/models).

Keep `FLIGHTS_ENABLED=false` and embedding settings commented until their schemas, permission review and model identity are ready. No automatic refresh/import/embedding timer is enabled.

For manual database configuration, obtain PostgreSQL connection credentials from the service owner. Percent-encode reserved characters in URL usernames/passwords; remove URL `ssl*`/`uselibpq*` parameters because Atlas configures verified TLS explicitly. Set `DATABASE_CA_FILE` to the trusted absolute CA path when needed. [node-postgres TLS behavior](https://node-postgres.com/features/ssl).
