# Minimal-context assistant research — 2026-10-17

Assistant v2 now uses the existing bounded agent loop for on-demand database research. It reuses canonical validated retrieval functions and the official Gemini SDK. No database redesign, generic SQL tool, arbitrary URL fetching or new provider is required. V1 remains on its legacy retrieval path. Public v2 requests, responses and SSE events retain their existing protocol.

## What Gemini receives

Initial interpretation contains the current question, timezone, selected record IDs/explicit bounds, compact scope hints and at most six complete recent exchanges within 24,000 serialized UTF-8 bytes. Research adds audience guidance, server time/date resolution and authorized action names. Active filter values and full fetched records stay on the server. Search tools enforce those filters. No news page, investigation body, source list, observation array or complete workspace catalog is prefetched into the prompt.

The browser retains full completed answers and supplies up to six bounded exchanges in a request of at most 65,536 bytes. The server's `read_history` tool retrieves those supplied exchanges by newest-first index; it cannot reach older browser-only messages. Old answers resolve references and are never factual evidence or action authorization. An exchange too large for a tool reply is omitted whole with an explanation; messages are not summarized or truncated.

Explicitly selected articles/investigations may expose their linked evidence outside feed filters. General news searches stay inside active filters. Investigation discovery is limited to the current filtered news view when filters are present; the stored catalog and that intersection are capped at 100 entries/records. Unselected investigation details then expose matching articles only and explain that restriction. Explicit selection enables its other linked sections. This is bounded discovery, not exhaustive corpus search.

## Tools and budgets

| Tool | Data shown to Gemini |
| --- | --- |
| `search_news` | Three previews by default, at most five; bounded titles/excerpts with continuation/truncation metadata |
| `get_article` | One known/selected/linked article's permitted excerpt, paged by Unicode character offset |
| `search_locations` | At most five stored names, IDs and precision; geometry stays server-side |
| `search_catalog` | One category of labels/IDs, at most five at a time; discovery hints only |
| `get_investigation` | Header by default; explicit paginated articles, evidence, curated items, series, key observations or locations |
| `get_sources` | Original publication basis/date, publisher and licensing/attribution for exposed source IDs; URLs resolved server-side |
| `compare_observations` | At most two returned endpoints, exact times, units, qualifiers, limitations and a validated optional timeline target |
| `read_history` | One complete supplied exchange by default, at most two, subject to the byte cap |

Every serialized tool result is at most 8,000 bytes and contains at most five records. Detail excerpt requests default to 1,000 characters and allow at most 2,000; the current stored Article contract permits only 500, so the tool never implies a full article exists. Qualifiers, missing-data rules, units, dates and evidence limitations are preserved. Essential metadata that cannot fit produces a recoverable tool error instead of silently removing qualifications. Returned-page counts are never corpus totals. Filter-action receipts report the canonical page count without copying the page into model context.

The working prompt ceiling is `AI_MAX_CONTEXT_BYTES` bytes (128,000 by default). Accounting uses the same request builder as the SDK call, including system instructions, tool/response schemas, generated signatures and retained contents. The configured guard includes all request content; there is no separate hidden 48 KB ceiling. When history must shrink, remove oldest complete exchanges first, preserving recent exchanges without truncating strings. Completed model/tool-response blocks are evicted whole, preserving original parts/signatures in retained blocks. Duplicates become receipts while their data remains in context. Receipts depending on evicted data are also removed; a subsequent lookup re-emits the cached projection.

Sources are optional. The server resolves known source/record pairs from exposed evidence and omits unavailable pairs from the clickable source list. Missing references, unused sources, headings, uncited paragraphs and absent source metadata never reject the answer. Answer text and original citation-array numbering stay unchanged, including gaps; unresolved markers remain plain text. The browser matches links by number and does not repeat citation validation. Only referenced source metadata is fetched, and lookup failure preserves the answer. Response shapes/HTTPS links, tool arguments, action authorization/preflight, exact timeline ranges and cancellation remain checked. V1 retains its legacy citation behavior.

Keep six configured generation rounds and eight tool calls. Interpretation counts toward both. The final round/call and up to 15 seconds are reserved for supported finalization (one third for request budgets shorter than 45 seconds). Research-stage timeout stops that stage even when an adapter ignores abort. With evidence, the final model call has only the response schema/tool and can return a partial answer with `RESEARCH_LIMIT_REACHED`. Without evidence, Atlas asks for a narrower place/topic/period in a labeled fallback. Completed authorized workspace commands can return server-generated status. Global cancellation/deadlines still terminate the request; provider errors are not automatically replayed.

## Adding another dataset

1. Add a canonical bounded retrieval function using the parameterized repository boundary. Reuse it for manual queries and assistant access; agree database/source handoffs separately.
2. Author closed argument/result schemas and inferred types in `contracts/`, register them in the existing registry, build contracts first, and gate required schema availability.
3. Add a named port/registry handler in `gemini/research.ts`, an explicit compact projection and `page`/bounded-result validation. Define geography/filter/selection semantics and pagination. Keep full records private; never expose arbitrary tables/SQL.
4. Add supported source relationships to the ledger only after the projection enters model context. Extend the authoritative record enum/metadata if needed, preserving dates, precision, nulls, units and limitations.
5. Test the real registry, caching, paging, byte overflow, unavailable-source omission, scope conflicts and cancellation with injected models/repositories before a separately authorized live check.

The registry caches canonical arguments per question. Filter changes increment its scope revision. Raw reads also reuse private cached records. Research state does not persist across requests, so every question starts bounded.

Filter receipts reuse the authoritative filter-patch key set, including all 12
keys for a complete reset. When semantic retrieval falls back to literal keywords,
compact news results and filter-action receipts retain an explicit limitation,
including empty pages. The limitation also stays in request prompt state after
context compaction. Successful assistant responses carry the non-retryable
`SEMANTIC_SEARCH_UNAVAILABLE` notice in `errors`, which the existing chat renders
alongside answers and status messages even if the model omits the disclosure.
Pagination limitations remain visible; ordinary keyword searches and successful
semantic searches do not receive this notice.

Review-fix verification (October 18, 2026): 29 contract tests, 13 actual backend
compatibility checks, 212 backend tests and 155 frontend tests pass, along with
contracts/backend/frontend typechecks and builds. Regression cases reproduce both
original failures and cover empty/populated resets, unavailable/failed embeddings,
empty/matching fallback results, successful semantic retrieval, filter-command
receipts and streamed chat notices. All models/repositories/providers are injected;
no provider or database access was used.

## Offline profile and activation

```sh
npm --prefix contracts run build
npm --prefix backend run profile:assistant
npm --prefix backend run build
# Restart the backend after building contracts to load the registry.
```

`profile:assistant` loads no `.env`, creates no database pool and contacts no provider. It runs the production orchestrator with authoritative historical fixtures and a scripted model. Output contains sizes/counts only.

| Offline scenario | Interpretation | Initial research | Peak input | Largest tool reply | Initially included exchanges |
| --- | ---: | ---: | ---: | ---: | ---: |
| Selected Helene investigation | 5,278 B | 11,910 B | 13,873 B | 1,168 B | 0 |
| Same selection, six supplied exchanges | 10,599 B | 17,231 B | 19,194 B | 1,168 B | 6 |

These are fixture measurements, not live latency/token counts or guarantees for all questions. Structured `assistant_research` diagnostics contain a hashed request key, round, input bytes, exposed-record count, cache hits, compactions, history omission and stopping reason. They exclude prompts/answers, records, raw provider errors and credentials. A final event reports stopping state even after fallback.

No migrations, imports, provider requests, live database probes, deployment or publishing are included. Populated secret files are preserved. Full sourced generation, provider acceptance of the new declarations and streaming under actual provider latency still need a separately authorized smoke check.

## Delivered verification

- Contracts: build/typechecks pass; 26 strict schema tests and 11 actual backend compatibility tests pass, with zero skips. All eight v2 definitions plus all nine research definitions compile and project through the backend's local registry. Legacy/manual limits remain covered.
- Backend: source/test typechecks, production build and 161 tests pass with zero skips. Real-loopback HTTP tests use injected providers/repositories; sandbox loopback access was approved for those tests. Coverage includes Unicode/large filters, private-versus-exposed evidence, cached lookups, complete-block/signature compaction and dependent receipts, timeout reserve/late model completion, final-round partial answers, history paging and essential qualifier overflow.
- Frontend: typecheck/build and 78 tests pass across eight files, including abandoned-preview replacement, source/action validation, atomic preflight, cancellation, retry/history, exact timeline ranges and Back/Undo. The existing Mapbox bundle-size advisory and Node test-environment localStorage warnings remain. No layout change was introduced by this research update.
- Local configuration check passes (`ready_for_data:true`, all core contracts/plans supplied, configured Gemini); it verifies no live connection. The offline profile above was rerun after implementation. `git diff --check` passes.

Frontend type expansion was kept bounded by inferring each research definition independently, rather than mapping generic `FromSchema` over the entire registry. This changes only type composition; wire validation remains strict. The earlier design-hook finding about the mobile sheet's height transition is resolved by its removal; no suppression was added, and nothing remains open for that finding. Fresh provider-backed/visual smoke verification remains outside this backend-focused change.

After the user's request to remove citation requirements, all 161 backend tests, 78 frontend tests, 26 schema tests and 11 contract/backend checks pass again with zero skips; builds/typechecks pass. Coverage now verifies complete streamed answers survive missing/unused references, uncited paragraphs, unavailable source metadata and valid action batches. The former paragraph/heading/number-completeness validator and duplicate frontend citation checks were deleted. Prompt/schema descriptions now make citations optional. No live provider/database request was made for this simplification.


## Conversational recovery (October 18, 2026)

Article discovery defaults to a recommendation in chat within active filters. The
prompt asks for a title, publisher, source reference, and brief reason to read,
using available excerpts and disclosing title-only coverage. Generic discovery
words are not literal keyword filters. Follow-ups use recent conversation as
reference context and retrieve evidence again. History never authorizes actions.

The previous generic workspace-permission question has been removed. Ambiguous
intent and rejected action quotes now continue with read-only research; action
tools remain unavailable. Specific missing place/metric/date/coverage questions
still stop for clarification. One generic final clarification can trigger one
bounded recovery turn within the existing round/tool/deadline budgets. Repetition
falls back to a specific topic/place question, never the old workspace question.
Profanity with a task is handled normally; a dismissal alone gets a brief reply.

The quality-first local profile uses `gemini-3.1-pro-preview`, medium thinking,
and `AI_MAX_OUTPUT_TOKENS=16384`. The example documents this opt-in model; the
application still requires an explicitly configured model and key. The model is
preview, and account availability and end-to-end response quality have not been
verified. No silent fallback to a different model is configured. Request deadlines
remain 50 seconds for AI and 60 seconds for the full route in the example/local
profile. Restart the backend to pick up environment changes.

Regression models and repositories are injected: they verify that orchestration
can recover from the supplied clarification loop, preserve filters/actions,
handle short replies, and retain complete history. They do not prove that the real
model interprets every phrasing correctly. Live model availability, tool/stream
acceptance, latency, and conversational quality still require a separately
authorized provider-backed smoke check. No provider/database access was made.

Validation for this update: all 225 backend tests pass with zero skips, including
loopback HTTP streaming/cancellation tests using injected services. Backend
typechecking, production build, offline context profiling, and `git diff --check`
pass. No live provider/database integration is claimed.
