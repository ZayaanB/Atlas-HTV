# Manual topic labels — 2026-10-18

Status: **applied and verified** after the user restored Tiger authentication. The batch inserted 90 theme links across 44 existing provider articles on the configured READY DEV service. The runtime role's privileges were preserved; the saved owner credential was used only for this metadata transaction. The committed receipt is `backend/data/manual-topic-labels-2026-10-18.receipt.json`.

The batch is `backend/data/manual-topic-labels-2026-10-18.json`. It targets 44 of the 45 unreviewed provider articles in the observed 55-article corpus and adds 90 `atlas.article_themes` links. Each entry records the original URL, title, expected content hash, selected theme IDs, and topical rationale. The generic AP news roundup has neither a useful subject headline nor a stored excerpt and is explicitly skipped. The 10 curated articles are excluded. Including the existing curated tags, 54 of 55 articles now have stored topic tags.

This is a review of topical metadata in stored headlines and permitted excerpts, **not factual verification of the reporting**. Provider article/source review statuses stay unreviewed. No entity links, coordinates, location links, dates, imagery claims, or source-refresh metadata are added or changed. Scientific spacecraft “environmental testing” is tagged science/technology, not environment; tropical cyclones are not all labelled hurricanes. No external article pages or paid APIs were fetched.

| Stored tag | Articles receiving the tag |
| --- | ---: |
| Environment & climate | 35 |
| Droughts | 12 |
| Flooding | 11 |
| Science & space | 10 |
| Cyclones & storms | 5 |
| Technology | 5 |
| Earthquakes | 4 |
| Business & markets | 2 |
| Politics & policy | 2 |
| Hurricanes | 2 |
| Infrastructure | 1 |
| Wildfires | 1 |

## Execution

From `backend/`, using the existing private `.env` and trusted CA:

```bash
# Read-only preview, using the runtime connection:
node --env-file-if-exists=.env --import tsx src/label-stored-news.ts
# After restoring Tiger authentication, apply to the same READY DEV service:
node --env-file-if-exists=.env --import tsx src/label-stored-news.ts --apply
```

The executable uses parameterized inserts into the existing theme vocabulary and association table. It checks every target article's URL, title, content hash, provider, and unreviewed status before writing. Apply obtains the saved owner connection in memory, checks the service is READY/DEV and matches the configured database, locks target articles, and commits the entire batch atomically. Existing tags and vocabulary labels are retained. Repeating the batch adds zero duplicate links. Provider refreshes do not delete theme associations, but this batch does not classify future imports.

An apply receipt records only the vocabulary rows and associations inserted by this batch, permitting selective reversal without touching older labels. It is created immediately before commit and marked committed afterward; a `pending_commit` receipt requires checking the database before concluding whether the commit succeeded. A no-op rerun preserves the original receipt.

Validation performed: initial database dry run reported 44 target articles and 90 missing links; backend source/test typechecks passed. After apply, a second read-only dry run reported zero missing additions. The running `/api/news` response contained every expected tag and preserved all non-theme article fields and all existing tags exactly. `/api/workspace` exposed every batch theme. All 12 individual stored-theme filter queries returned exactly their expected article IDs. The total corpus remains 55 articles. Broad category matching still has the shared-mapping limitation below.

## Shared category mapping handoff — Person 1

The current `contracts/schemas/news-categories.ts` category matcher only consults each rule's explicit `themes` array, alongside English title/excerpt terms. Adding database tags exposes them through `/api/workspace` and **Stored topic tags** without code changes, but broad category filters do not yet recognize all new stored tags. For example, the NASA “Fires Arrive in the Amazon Rainforest” story can receive the stored `wildfire` tag while still missing the broad Wildfires filter's existing literal terms. The politics headline mentioning voters/candidates similarly lacks the existing politics terms.

Person 1 should extend the authoritative rule `themes` arrays with these exact persisted IDs, retaining all existing values:

| Category rule | Add stored theme ID |
| --- | --- |
| event_types / earthquake | earthquake |
| event_types / cyclone | cyclone |
| event_types / drought | drought |
| event_types / wildfire | wildfire |
| topics / politics | politics |
| topics / business | business |
| topics / technology | technology |
| topics / science | science |
| topics / environment | environment |

Existing `flooding`, `hurricanes`, and `infrastructure` mappings already work. No volcano, tsunami, or health tags are proposed by this batch. Backend SQL filtering consumes the same shared rules, so updating and rebuilding that single module preserves frontend/fixture/backend parity; no private backend category dictionary is needed. Verify that the wildfire article and voters/candidates article match through their stored tags, and that untagged ambiguous stories still do not match. The owning workstream integrates this shared-contract change.
