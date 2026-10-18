# Live ingestion — 2026-10-18 (branch `feat/yathurshan/live-data`)

Atlas still serves **stored** records: the browser reads Tiger, never a provider. What changed is that the stored data is now refreshed from live providers on a schedule, and the live data reaches the map and the timeline. The curated Helene investigation stays as a labeled `curated_seed`. `Coverage.live` remains `false` by contract, because responses are not provider passthroughs; the UI shows the last successful refresh instead.

## What is refreshed

| Source definition | Provider | Writes | Map / UI |
| --- | --- | --- | --- |
| `rss-gdacs-alerts` | GDACS RSS (`gdacs` profile) | Unreviewed articles (`government_report` sources, CC BY 4.0 credit stored), earthquake origin time as `event_at`, unreviewed `region` locations from the GDACS point and alert box, `provider_asserted` links | Amber provisional points worldwide. The article panel says "provider-reported, not reviewed". |
| `rss-nasa-earth-observatory`, `gdelt-*` (3) | NASA RSS, GDELT DOC | Unreviewed, unlocated articles (unchanged behaviour) | Feed only; GDELT items carry their discovery attribution. |
| `usgs-waterdata-<site>-<parameter>` (4) | USGS Water Data OGC API | `live = true` series beside the curated 2024 series of the same gauges, with readings in the hypertable, linked once to `inv-helene-asheville-2024` | Timeline series picker: "… · current readings", marked provisional. |

Definitions and rights records: `scripts/source-definitions/atlas.mjs` and its `README.md`. The worldwide GDELT queries were **not** added: GDELT answered 429 to four of five requests on 2026-10-18.

## Commands

```bash
npm --prefix backend run ingest -- --all                 # one sequential pass over every reviewed source
npm --prefix backend run ingest -- rss-gdacs-alerts      # one news source
npm --prefix backend run ingest -- usgs-waterdata-03451500-discharge   # one live series
```

- `--all` prints one JSON line, `{"results":[{source_id,status:"success"|"backoff"|"failed",…}]}`, and exits non-zero only when no source succeeded and at least one failed.
- Scheduling on the VM: `infra/atlas-ingest.timer` runs `node dist/ingest.js --all` every 20 minutes (see `infra/README.md`). Locally, run the command by hand; there is no in-process timer, so API processes never poll providers.
- Order and pacing: sources run one at a time, GDELT requests at least 6 s apart, and each source has a 60 s deadline (`INGESTION_PROVIDER_TIMEOUT_MS` per request). A source in stored backoff is skipped without a request. Every failure, for news and observations alike, records `failed` with a retry no sooner than 15 minutes (a longer `Retry-After` is respected, capped at 24 h) and keeps `last_successful_at` and all stored rows.

## Behaviour worth knowing

- **Event locations** are only ever what the provider published for that item. A wrapped (antimeridian) or inconsistent box stores no location, and the article stays unlocated. A bad location never blocks the article.
- **Live series** resume two hours before the newest stored reading, so revised provisional values replace stored ones. A new series backfills 7 days (at most 30), and a refresh reads at most 1,000 readings. An empty refresh writes no series row but still records success. A changed provider unit, a reading for another site/parameter/statistic, a malformed time or a non-numeric value fails the refresh and writes nothing.
- **Series selection.** Since migration 006 a location + metric can hold two series. `ObservationsQuery` and `CompareObservationsArgs` take an optional `series_id` (shared contract), and the timeline always sends it. Without it, rows from both series can come back (each carries `series_id`/`source_id`), and comparison rejects mixed sources.
- **XML text.** RSS titles, excerpts and links decode XML's predefined escapes and numeric character references after parsing (GDACS links contain `&amp;`). DTD/ENTITY documents are still rejected.

## Before enabling on Tiger (needs explicit authorization)

1. Apply migration 006 and the updated grants: `npm --prefix backend run setup:tiger -- --initialize` (applies only the missing migration, re-runs `db/roles/atlas_runtime.sql`, preserves the seed). Without 006, the GDACS location write and the live series write fail safely (refresh recorded as failed), and articles still import.
2. Run one pass by hand: `npm --prefix backend run ingest -- --all`, and check every source's status.
3. Deploy, then enable `atlas-ingest.timer` on the VM.

## Verified on 2026-10-18 (local only)

- `db/checks/validate-handoff.mts`: 124 checks pass on a fresh disposable database (migrations 001–006, runtime role, Helene seed). They include reviewed-row protection, provider-location links, series isolation by `series_id`, revision upserts, the identity guard and the daily aggregate.
- A local end-to-end pass used the real ingestion classes, contracts and source definitions, with live GDACS and USGS responses, into that database as `atlas_runtime`. It wrote 30 GDACS items (29 located) and four live series (~670 readings each from a 7-day backfill). Reading them back through `Retrieval` validated every row against the shared contracts. A second pass was idempotent: no duplicate articles, links or investigation series. That pass used a harness with a non-TLS local pool; the CLI itself requires TLS and was not run against a database.
- Tests: backend 105/107, contracts 19/20 and frontend 41/42 pass, and the frontend production build succeeds. The 4 failing tests also fail on `main` on this Windows machine: symlink permission, SIGTERM exit code, the seed-example parser not handling CRLF line endings, and a timing-sensitive research UI test (`findByRole` within 1 s) that passed in one of three runs.
- **Not done:** nothing ran against Tiger, nothing was deployed, and the timer has not been installed. Flights remain disabled; the ADSB.lol message is drafted in `scripts/source-definitions/README.md` and has not been sent.
