# Step 2 — configure Tiger Cloud and Gemini locally

Use this guide before the shared contracts/database handoffs arrive. This setup verifies credentials separately from the Atlas data schema. It does not provision a service, apply migrations, import records, generate embeddings, or call Gemini generation.

The agent created `backend/.env` from the updated `backend/.env.example` with owner-only permissions (0600). Git ignores it. No real credentials have been inserted. Existing `.env` contents are preserved on setup; do not replace an existing populated file with the example. The backend scripts load `backend/.env`, **not `.env.local`**, when invoked with `npm --prefix backend`.

## 1. Get the existing team's database connection

Ask Person 4 for the Atlas Tiger Cloud service's hostname, **actual port**, database name, username, password, network access requirements, and any required trusted CA. Use PostgreSQL connection credentials, not Tiger Cloud management API keys.

If you have access to the existing service, open [Tiger Console](https://console.cloud.timescale.com/), select the service under Services, then open Service info → Connect → More details. The password is supplied separately by the service owner or their saved credentials. Do not reset a shared password without coordinating with Person 4. [Official connection details](https://www.tigerdata.com/docs/integrate/find-connection-details).

If no team service exists, ask Person 4 to arrange it using the agreed allowance/credits. This guide does not authorize paid provisioning.

## 2. Get a Gemini API key and model ID

Open [Google AI Studio API keys](https://aistudio.google.com/app/apikey). Use the team's intended Google Cloud project (import it if needed), then create or obtain a key intended for the Gemini API. Save it directly into the local environment file. [Official key instructions](https://ai.google.dev/gemini-api/docs/api-key).

Choose an available **text generation model with function calling** from the project/AI Studio and copy its exact API model ID, not its display name. Availability and quota depend on the project. Check its [model documentation](https://ai.google.dev/gemini-api/docs/models); no model ID or allowance is assumed by Atlas. Leave embeddings disabled initially.

## 3. Fill the local file

From your terminal:

```bash
cd /home/zayaan/Documents/Projects/HTV
nano backend/.env
```

Find the three commented credential lines, remove the leading `#`, and replace every placeholder:

```dotenv
DATABASE_URL='postgresql://USER:URL_ENCODED_PASSWORD@HOST:PORT/DATABASE'
GEMINI_API_KEY='YOUR_ACTUAL_GEMINI_API_KEY'
GEMINI_MODEL='YOUR_AVAILABLE_TEXT_MODEL_API_ID'
```

Use the actual service port and database name. Keep the surrounding quotes. If you construct the URL yourself, percent-encode reserved characters in the username/password; for example, a password's `@` becomes `%40` and `#` becomes `%23`. Do not double-encode an already encoded connection string.

Remove SSL query options such as `?sslmode=require`, `sslrootcert`, or `uselibpqcompat` from a provider-generated URL before storing it here. Atlas config rejects URL overrides and sets certificate-verified TLS explicitly in `pg`. This does not disable TLS. [Why node-postgres URL SSL options override explicit TLS settings](https://node-postgres.com/features/ssl).

If Person 4 supplies a trusted root CA that the system trust store does not recognize, uncomment `DATABASE_CA_FILE` and use that certificate's absolute local path. Keep verification enabled. A database password is unrelated to the CA file.

In nano: Ctrl+O, Enter saves; Ctrl+X exits. Do not paste credentials into this chat, API examples, frontend variables, or commit messages.

Keep these settings unchanged for now:

- `HOST=127.0.0.1`, `PORT=3001`, `FLIGHTS_ENABLED=false`.
- `EMBEDDING_MODEL`, `EMBEDDING_VERSION`, `EMBEDDING_DIMENSIONS` remain commented.
- The three `ATLAS_*_MODULE` entries remain commented until actual reviewed handoff modules exist. The paths in the example are proposals, not installed integrations.

## 4. Confirm Git ignores the secret file

```bash
cd /home/zayaan/Documents/Projects/HTV
git check-ignore backend/.env
```

Expected output: `backend/.env`. Commit `.env.example`; never force-add `.env`.

If dependencies are missing in a fresh checkout, install the pinned package set with `npm --prefix backend ci`. Dependencies are already installed in the current workspace.

## 5. Verify each connection

```bash
npm --prefix backend run verify:connections -- --database
npm --prefix backend run verify:connections -- --gemini
```

Alternatively, run both:

```bash
npm --prefix backend run verify:connections
```

The database check queries fixed PostgreSQL system catalogs only. A successful result reports `status: "passed"`, `tls_verified: true`, and boolean TimescaleDB/pgvector extension availability. Missing extensions are a Person 4 migration/setup task; this command does not install them.

The Gemini check calls `models.get` for metadata only. A successful result reports `status: "passed"` and advertised `generateContent` support. This does **not** verify generation quota, function calling, or a real grounded answer; those require the later sourced vertical slice. It makes no answer/embedding request.

Exit codes: 0 means selected connection probes passed; 2 means required credentials are missing; 1 means configuration or a probe failed. Error messages are sanitized; they do not print credentials or raw provider/connection errors.

| Result | Next action |
| --- | --- |
| `DATABASE_AUTH_FAILED` | Confirm the database username/password with Person 4. |
| `DATABASE_HOST_UNREACHABLE` / `DATABASE_TIMEOUT` | Check the actual hostname/port, service state, and network/VPN access. |
| `DATABASE_TLS_FAILED` / `DATABASE_TLS_UNCONFIRMED` | Confirm the correct hostname/trusted CA with Person 4; keep verification enabled. |
| `DATABASE_NOT_FOUND` | Use the actual database name from the service connection details. |
| `GEMINI_AUTH_FAILED` | Check the API key's project, permissions and API restrictions. |
| `GEMINI_MODEL_UNAVAILABLE` / `GEMINI_MODEL_UNSUPPORTED` | Select an available generation-capable model and copy its exact API ID. |
| `GEMINI_RATE_LIMITED` | Check the project's quota and retry later. |
| `CONFIG_INVALID` | Check the named environment variable. Blank active values are invalid; comment out settings you are not configuring. |

## 6. Check Atlas's separate handoff readiness

```bash
npm --prefix backend run check
```

While teammate code is pending, expect `ready_for_data: false` and exit code 2 even if both connection checks passed. Credentials do not supply shared schemas, SQL plans, migrations, verified seed records, or source definitions.

Once the code handoffs arrive, Person 3 can wire the real contract module and reviewed query plans, then validate news/locations/investigation/observations and a real cited Gemini answer. Do not run the comment-only migration placeholders or invent replacement schemas.

## 7. Start the backend when you want to inspect health

```bash
npm --prefix backend run dev
```

In a second terminal:

```bash
curl -i http://127.0.0.1:3001/api/health/live
curl -i http://127.0.0.1:3001/api/health
```

Liveness can return 200 now. Readiness remains 503 until the actual data/contracts handoffs are configured. Stop with Ctrl+C. Restart the process after editing `.env`; source watch mode is not a promise of environment-file reload.
