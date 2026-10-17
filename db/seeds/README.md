# Verified seed records — Person 4

Seeds are reviewed data, not code. They are loaded with `psql` after migrations 001–005. The approved import runs from the repository root:

```bash
psql "$ATLAS_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/<seed>/load.sql
```

| Seed | Content | Label |
| --- | --- | --- |
| [`helene-asheville-2024/`](helene-asheville-2024/SOURCES.md) | One investigation, `inv-helene-asheville-2024`: Hurricane Helene's record French Broad River flood at Asheville, NC (Sept 2024). | Curated seed (`content_status = 'curated_seed'`, `provider = 'curated'`). Real sources; not live and not synthetic. |

The Helene seed contains:
- 23 sources and 10 title-and-link articles.
- 4 locations: two USGS gauge points at facility precision, the Asheville city extent and the Buncombe County extent.
- 5 entities and 5 themes.
- 9 evidence records, including an aligned HLS L30 before/after pair.
- A brief of 23 items, each linked to its sources.
- 5 observation series with 7,467 real USGS observations (15-minute discharge and gage height at two gauges, plus 130 annual peaks).
- 32 embeddable text chunks.

Files in each seed folder:

| File | Role |
| --- | --- |
| `records.sql` | Relational rows (INSERT statements, no upserts). |
| `observations.csv` | Observation rows (UTC). |
| `build-observations.mjs` | Offline, deterministic converter from the archived provider files to the CSV. |
| `load.sql` | Transaction, integrity checks and aggregate refresh. |
| `SOURCES.md` | Exact URLs, retrieval times, checksums, licences, time conventions and the facts the brief relies on. |

Rules: never invent articles, values, coordinates, company relationships, quotes or licences. Keep event, publication, observation and retrieval times separate. Publisher articles are stored as title and link only unless a source definition records excerpt permission. Any synthetic demo content must use `content_status = 'prepared_fixture'` and be labeled in the UI.
