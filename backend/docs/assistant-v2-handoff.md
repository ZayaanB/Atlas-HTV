# Core assistant v2 — Person 3 → Person 1

The backend consumer is implemented; activation awaits Person 1's authoritative
runtime schemas and UI. This document specifies the handoff, not a second schema
registry. Do not copy schemas into `backend/` or relax existing validation.

## Delivery order and current status

1. Person 1 implements the eight exports below in `contracts/`, using its existing
   JSON Schema/inferred TypeScript approach, and builds the package. Restart the
   backend to load the new registry. Use the example's `AI_MAX_ROUNDS=6` deliberately
   for the additional interpretation turn; do not overwrite populated secret files.
2. Run backend typechecks/tests/build and the shared compatibility test. That test
   is explicitly skipped while the v2 schemas are missing. Existing domain records
   are already checked against the real shared registry. Opaque v2 contract-port
   doubles exercise orchestration only; they do not establish v2 schema compatibility.
3. Person 1 integrates the request, citations, history, and timeline UI behavior.
4. Perform a separately authorized live smoke check. No provider/database access,
   migration/import, embedding activation, flight activation, or deployment was
   performed for this slice.

Until step 1, an explicit `protocol_version:2` request returns a structured 503
`CONTRACTS_UNAVAILABLE` before retrieval or generation. Legacy requests continue
using the existing authoritative schemas and opt-in `allow_ui_actions` behavior.
V2 readiness does not change core health readiness. Once the real exports exist,
the backend consumes them directly; no environment feature switch is needed.

## Required authoritative exports

All objects are closed (`additionalProperties:false`), strings/arrays bounded,
and existing `NewsQuery`, ID, UTC, date-only, source and location definitions reused.
All eight names must be present before v2 can execute.

### `AssistantRequestV2`

- Required: `protocol_version:2`, `request_id`, `message`, `timezone`. Preserve
  existing limits (160, 4,000, and 100 characters respectively), nonblank text and
  server-side IANA timezone checks.
- Optional: `filters:NewsQuery`, `selected_investigation_id`, `selected_article_id`,
  `selected_location_id`, and `selected_bounds` using existing bounds semantics.
  Bounds must represent an explicitly chosen search area, not an incidental viewport.
- Optional `audience`: existing general_public/journalist/investor values.
- Optional `interaction_mode:intent|read_only`; omission means intent.
  `allow_ui_actions` is forbidden in v2.
- Optional `history`: at most 12 entries (six exchanges), each a closed
  `{role:user|assistant,content:string}` object with 1–4,000 characters. Send only
  previous completed turns, not the current message or tool outputs.
- The assistant route permits 65,536-byte JSON bodies; v2 enforces that total
  bound and v1 retains its existing 24,000-byte service bound. The frontend must
  take the most recent complete exchanges that fit, never truncate a message
  mid-string or silently trim the user's current question.

### `AssistantIntent` — model-only interpretation

All fields required:

- `actions`: at most three `{type:set_filters|focus_location|open_timeline,quote}`
  objects. Quotes are 1–4,000 characters, verbatim unquoted commands from the
  current user message. Quotes must include the command verb and target.
- `filter_keys`, `clear_filters`: unique arrays, at most eight entries, from
  `location_ids,bounds,themes,entity_ids,keyword,semantic_query,published_from,published_to`.
  Clear keys are also filter keys. Identify only changes/clears explicitly requested.
- `clarification_reason`: null or `ambiguous_intent|missing_location|ambiguous_location|
  missing_metric|unsupported_period|unsupported_coverage`.
- `use_current_area`: boolean, true when the request refers to this area/current place.
- `date_expression`: null or a verbatim expression (1–200 characters).
- `date_target`: null or `publication|observation`. Expression and target are both
  null or both populated.

Interpretation has no retrieved text. The backend independently checks command
quotes, negative/meta/quoted wording, and action kinds before advertising action
tools. V1 retains its existing behavior; v2's conservative command gate supports
English commands. Uncertain action authorization permits read-only research; it
does not produce a generic workspace-permission question. Article discovery
defaults to a recommendation in chat. Only specific blocking missing details
require clarification. See assistant-research.md for current history/model budgets.

### `AssistantFilterPatch` — model tool arguments

Required `{set,clear}`. `set` reuses the filter properties of `NewsQuery` except
`limit` and `offset`; `clear` is a unique array of at most eight filter keys above.
Empty arrays, blank strings and null values in `set` are rejected; use `clear`.
Setting and clearing the same key is rejected.

Only interpreter-authorized keys can change. Clearing requires a separately
authorized clear instruction. Unnamed filters and page size persist; offset resets
to zero. A new geographic constraint removes prior location IDs/bounds. A new
publication range replaces both publication endpoints. For a full date-clear
instruction, name both endpoints in the interpreter/patch. For a full geography
clear, name both geographic keys.

### `OpenTimelineArgs`

Required `investigation_id` and `series_id` (existing record IDs); optional
`observed_from`/`observed_to` (existing UTC timestamps). The backend verifies the
series is linked to that investigation and that its returned rows match the
series/source/units. Existing observation range limits remain authoritative.

### `UIActionV2` — server-authored UI output

One of:

- Existing `{type:set_filters,filters:NewsQuery}` with the **complete effective** query.
- Existing `{type:focus_location,location_id}`.
- `{type:open_timeline,...OpenTimelineArgs}`.

At most eight actions. The backend collapses repeated action kinds to their final
state and validates every action before responding. The browser resolves every
target before applying any actions, checks request ID/context revision again after
async resolution, and applies through canonical workspace state with Undo filters.

### `AssistantDraftV2` — model-only finalization

All required:

- `kind:answer|clarification|empty|action_summary`.
- `answer`: string, maximum 16,000 characters; may be empty for non-answer kinds.
- `citations`: at most 30 existing `CitationReference` objects.
- `result_ids`: at most 100 existing record-reference IDs.
- `actions`: at most eight model-action objects. Focus/timeline actions have their
  usual argument shapes. **Model `set_filters` actions are `{type:set_filters,set,clear}`**
  using AssistantFilterPatch; they are not canonical UIActionV2 replacements.
- `clarification_reason`: the nullable enum from AssistantIntent, populated for
  clarification. The server supplies the actual question from fixed templates.

Respond must be the only call in its turn. Final-draft actions execute through the
same dispatch as tools, count against the request tool bound, and are not trusted
as already applied. Invalid output drops the whole pending action set.

For factual answers, use `[1]`, `[2]`, etc. matching citation-array order. Every
number must resolve, every paragraph needs a reference, and every returned citation must be used. Previous answers
are not evidence; factual records must be retrieved again. Non-answer text is
generated by the backend from validated state. A model cannot hide uncited prose
inside a status answer.
Non-answer kinds require empty citations/result_ids arrays. Every authorized
workspace operation must have completed before a non-clarification response can
be accepted; otherwise synthesis fails with zero actions.

### `CitationV2`

Existing Citation fields plus required `number` (integer 1–30) and these required,
nullable original metadata fields:

- `published_at` (UTC), `published_date` (date-only), from the stored Source.
- `observed_at`, `observed_from`, `observed_to`, `period_start`, `period_end` (UTC),
  from the cited record.

Do not derive a publication instant from a date-only publication. Do not reinterpret
an evidence observation range as a publication range. The backend supplies all
URLs, titles, numbering and date metadata. Provenance validation does not prove
the truth or entailment of every generated sentence.

### `AssistantResponseV2`

Required existing request_id/answer/result_ids/actions/coverage/mode/errors fields,
plus required `protocol_version:2`, `kind`, `citations:CitationV2[]` and:

- `search`: null or `{filters:NewsQuery,returned_count,limit,offset}`. Count is 0–100
  and describes the returned news page, not the corpus or a total match count.
  When filters change, it describes the final applied query. Otherwise it describes
  the last read-only news query (or the initial query). Only actions change UI filters.
- `resolved_range`: null or `{from,to,timezone,label,target:publication|observation}`.
- `timeline`: null or OpenTimelineArgs, representing a validated suggested link.

Response kind values match AssistantDraftV2. Existing live/fixture/fallback modes
are retained: live generation can still describe stored historical data.
Fallback responses use kind answer, no citations/actions/result IDs, null search/
range/timeline, and structured sanitized errors. Successful status/clarification
responses may have no citations. The frontend's blanket v1 rejection of every
uncited live answer must become v2 kind-aware; factual answers still need citations.

## Tools, dates and UI behavior

V2 always permits canonical read tools `search_news`, `search_locations`,
`get_article`, `get_investigation`, `compare_observations`, `suggest_timeline`.
`get_article` uses the existing single-ID query shape. Workspace-changing tools
are declared only when authorized for the current request. Flights are excluded.

Context resolves explicit named targets before selection, and selection before
chosen bounds. Stored article/investigation links are used; ambiguous associations
are not guessed. Unsupported/ambiguous location lookup produces a server-generated
clarification (up to ten available location names). Prior pending actions are
discarded when clarification is necessary. Read searches preserve active filters,
using the same functions as manual queries.

Supported date expressions: YYYY-MM-DD; YYYY-MM-DD to/through YYYY-MM-DD; today;
yesterday; this/last week; this/last month; past N days (1–366). Relative expressions
are case-insensitive. Weeks start Monday; past N days includes today. This week/
month uses the whole local calendar period. Date endpoints are inclusive, converted
from local boundaries to UTC, ending one millisecond before the next local day.
DST is respected. Invalid, skipped, reversed, overlong, ambiguous or unsupported
periods request clarification. Date displays must use resolved_range, not reinterpret
UTC timestamps as browser-local date inputs.

Observation comparison remains a bounded raw endpoint comparison, never a full-
period aggregate. Missing readings remain present and yield a useful limitation;
incompatible series yield a limitation rather than a generated difference. A
linked series produces a timeline suggestion. Render “Open timeline” below the
answer without automatic navigation. An explicit “Open/show the timeline” command
produces open_timeline; opening it preserves news filters and current chat history.
The timeline must use the validated UTC range exactly; its current date-only
controls must not round a timezone-derived range to different UTC days.

Remove the v2 authorization checkbox. Clear show/filter/zoom/open instructions
authorize only relevant actions. Questions preserve workspace state. Ambiguous
instructions ask before changing state. Maintain abort/stale-response rejection,
atomic target validation, keyboard controls, action summaries, coverage labels and
filter Undo. Retain history in browser memory until refresh or explicit clearing;
selection changes preserve the conversation but current selection takes precedence.

## Examples and acceptance

Explicit command request after Person 1's schema/UI delivery:

```json
{"protocol_version":2,"request_id":"filter-1","message":"Show flooding news in Asheville","timezone":"America/Toronto","filters":{"limit":20},"interaction_mode":"intent","history":[]}
```

Contextual follow-up (the backend retrieves the selected investigation again):

```json
{"protocol_version":2,"request_id":"followup-2","message":"Who was affected, and what remains unclear?","timezone":"America/Toronto","selected_investigation_id":"inv-helene-asheville-2024","audience":"general_public","history":[{"role":"user","content":"Explain the historical Helene investigation."},{"role":"assistant","content":"Previous answer text; context only, not source evidence."}]}
```

Person 1 acceptance: show dated inline references and mode/coverage; retain history
across selection changes; preserve unnamed filters; show returned-page counts;
handle no matches and “What about Toronto?” without unexpected changes; open the
matching timeline/UTC range only through an explicit instruction or link click;
discard stale responses before any action. Validate requests and responses through
the real shared schemas. No fixture or injected-model test establishes live Gemini,
Tiger access, production latency, or successful real-provider actions.

## Verification for this backend delivery

Backend source/test typechecks and production build pass. The full backend suite
reports 127 passed, zero failed, and one explicitly skipped real-v2-schema
compatibility test. The 10 existing contract/backend compatibility checks pass
against the actual shared schemas. New behavior checks use committed historical
records plus injected models/opaque v2 contract ports. Real local HTTP tests cover
successful POSTs, socket inactivity, deadlines, disconnect cancellation and shutdown.

The suite exposed an existing macOS `/var` versus `/private/var` root-alias issue
in the handoff loader. Canonicalizing the repository root fixes legitimate imports
while the existing traversal/symlink-escape rejection checks continue to pass.
