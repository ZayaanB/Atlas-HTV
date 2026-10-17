# Expanded news corpus — 2026-10-17

The running frontend's same-origin `/api/news?limit=100` and the browser both returned **21 articles**: 10 curated Helene records, 10 NASA RSS articles and one GDELT discovery. Eleven are unreviewed and have no verified location/theme/entity links. Coverage stays `mode:stored`, `live:false`. The map still has three sourced locations; no coordinates or event times were guessed for imports.

## Source results

| Reviewed source | Result |
| --- | --- |
| `gdelt-asheville-flooding` | Live refresh succeeded with a bounded 30-second timeout; one normalized article imported. The query matched a national economic story, so no Asheville location/theme link was inferred. |
| `gdelt-ontario-flooding` | The old eight-second timeout expired; source backoff recorded. |
| `gdelt-asheville-water-system` | Response failed the expected article-list shape; no data imported, backoff recorded. |
| `rss-nasa-earth-observatory` | HTTP 200 feed contained a malformed namespace delimiter. Ten articles were recovered from the already downloaded response after the narrow header fix; no additional provider request or refresh-state reset occurred during reprocessing. |

The NASA response was captured at `2026-10-17T22:21:08.294Z`; SHA-256 `9ae98db698075abc180ef563a1a1e150d1cf1b093699084bab2ff494b0fbe9ee`. It remains an uncommitted temporary diagnostic artifact. Article `fetched_at` and source retrieval metadata use that capture time. The canonical RSS adapter, `normalizeArticle`, shared Article validation and existing transactional `upsert_articles` plan processed the response. Its original publication assertions and excerpts were preserved. Provider refresh status correctly remains failed until a later successful network refresh; reprocessing did not clear its recorded backoff.

## Backend changes

- Manual imports now use `INGESTION_PROVIDER_TIMEOUT_MS` (default/max 30,000 ms), separately from the interactive provider timeout. The whole import still has a 60-second deadline.
- For reviewed `science.nasa.gov/feed/` only, the adapter inserts the single missing space between the exact observed APOD and media namespace attributes in the RSS root header. It does not rewrite titles, URLs, dates, excerpts or body XML. Strict validation still rejects other malformed XML, entities and document types.
- All 78 backend tests, source/test typechecks and production build pass. Tests verify the repair's host/root restriction, preserved data, unrelated XML rejection and isolated ingestion timeout.

After a source's stored backoff expires, refresh it with:

```bash
npm --prefix backend run ingest -- rss-nasa-earth-observatory
```

Refresh GDELT sources sequentially and at least five seconds apart; do not bypass source backoff. No automatic timer was enabled. Repeated refreshes deduplicate URLs; they do not manufacture new stories.

Person 4 still owns global source expansion and reviewed location links. Person 1 should show GDELT discovery attribution wherever those records appear, as required by the reviewed source definition. NASA's publisher/source links and unreviewed/unlocated labels are already visible. See [the global discovery handoff](global-discovery-handoff.md) for worldwide coverage and audience contracts.
