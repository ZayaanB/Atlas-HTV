# Shared contracts — Person 1

One authoritative JSON Schema draft-07 set for frontend and backend. `schemas/*.ts` contains plain, serializable schema definitions; `index.ts` exports the backend-compatible `schemas` registry and types inferred with `json-schema-to-ts`. There are no separately maintained frontend/backend interfaces or validators.

Frontend consumers use Zustand and TanStack Query. The assistant and research contracts match the existing backend payloads and frozen database projections. Backend/database executable implementations are unchanged; exact integration and external setup dependencies are recorded in [the research handoff](../frontend/docs/research-handoff.md).

## Available contracts

| Registry name / TypeScript type | Meaning |
| --- | --- |
| `NewsQuery` | Normalized filters for existing `GET /api/news` and the corresponding search tool. No `/api/filters` endpoint is introduced. |
| `Article` | Stored or normalized article metadata, source identity, distinct timestamps, verified links, provider provenance, and content hash. |
| `Location` | Sourced coordinates/bounds, geographic precision and provenance. Broad places require bounds; precise places require coordinates. |
| `Source` | The original reporting, dataset, imagery, or government record, including publication, licensing, attribution and retrieval metadata. |
| `Citation` | A resolved citation: `source_id`, `record_id`, original `url`, `title`. |
| `CitationReference` | An unresolved reference: `source_id`, `record_id` only. Supporting definition, not a new endpoint. |

Additional foundation contracts: `LocationsQuery`, `NewsResponse`, `LocationsResponse`, `Coverage`, and `ApiError`. Responses embed the authoritative Article/Location definitions. Coverage mirrors the existing database freshness projection, including nullable source-scope fields, per-feed state, datasets, and stored-corpus counts; it never supplies a matching-result total. Coverage always carries `mode` and `live:false`; absent freshness rows may omit other metadata. HTTP failures preserve the backend's `{error:{code,message,retryable,request_id}}` envelope.

## Build and checks

From the repository root, with Node >=22.12:

```bash
npm --prefix contracts ci
npm --prefix contracts run build
npm --prefix contracts run typecheck
npm --prefix contracts test
```

Build outputs are ignored by Git and must be rebuilt after schema changes:

- `contracts/dist/index.js`: portable ESM exporting `schemas`; no runtime dependency imports.
- `contracts/dist/index.d.ts`: schema-derived TypeScript exports, including `SchemaName`, `ContractMap`, and `Contract<Name>`.
- `contracts/dist/schemas/*.json`: named JSON Schemas generated for every exported name (register the complete registry to resolve references) from the same definitions. Do not edit or copy them into another workstream.

The package exports its root module, `@atlas/contracts/schemas/Article.json` (and the other named JSON files), and `@atlas/contracts/examples/helene-api.json` / `helene-research.json`. The frontend depends on `@atlas/contracts` via `file:../contracts`; build this package first. Type inference is type-only; `json-schema-to-ts` remains a package dependency because the exported declarations reference it.

```ts
import { schemas } from '@atlas/contracts';
import type { Article, Contract, NewsQuery } from '@atlas/contracts';

const query: NewsQuery = { location_ids: ['loc-asheville-nc'], limit: 20 };
type SelectedContract = Contract<'Citation'>;
// schemas.Article and Article originate from the same definition.
```

For a consumer using Ajv, register every named schema once, with `ajv-formats`, matching Person 3's existing configuration:

```ts
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { schemas } from '@atlas/contracts';
import type { Article } from '@atlas/contracts';

const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false });
addFormats.default(ajv); // NodeNext/CommonJS interop, matching the existing backend.
for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema, name);

const validateArticle = ajv.compile<Article>(schemas.Article);
function readArticle(input: unknown): Article {
  if (!validateArticle(input)) throw new Error('Invalid article');
  return input;
}
```

TypeScript checks property shapes, null handling, tuple lengths and enums. Numeric limits, timestamp formats, required geometry/publication relationships, and incoming JSON still require runtime validation. Schema shape validation does not establish the truth of a source or grounding of a citation.

## Existing backend handoff

After building, set this through the backend's existing configuration mechanism:

```dotenv
ATLAS_CONTRACTS_MODULE=contracts/dist/index.js
```

Its loader already accepts this module and registers the exported names with Ajv. There is no backend configuration edit in this delivery.

Integration checks require the backend's existing locked dependencies; installing them does not change its manifest:

```bash
npm --prefix backend ci
npm --prefix contracts run test:backend
```

These checks import the actual backend loader, query normalizer, article normalizer, and citation ledger. They also run its configuration checker with a sanitized environment and no `.env` file. They open no database connection and call no providers.

**Contract readiness is complete.** All 24 schemas required by the current backend are supplied, plus supporting research and workspace definitions (31 named schemas total). Runtime readiness still depends on the frozen query handoff, database configuration and service setup. No permissive schemas were introduced to hide missing integrations.

Additional contracts: `Investigation`, `InvestigationResponse`, `InvestigationQuery`, `Evidence`, `ObservationSeries`, `Observation`, `ObservationsQuery`, `ObservationsResponse`, `CompareObservationsArgs`, `AssistantRequest`, `AssistantDraft`, `AssistantResponse`, `UIAction`, `FocusLocationArgs`, `FlightRegion`, `FlightsQuery`, `FlightsResponse`, `FindAircraftArgs`, `AircraftState`, and `WorkspaceResponse`.

`WorkspaceResponse` remains optional catalog metadata for explicit article/investigation associations, option labels, and reviewed flight regions. Assistant and timeline access do not depend on this endpoint or its legacy context/series capability flags. Existing flight definitions are unchanged; no permissive readiness placeholders are added.

### Assistant and research contract details

`AssistantRequest` requires `request_id`, nonblank `message` (up to 4,000 characters) and `timezone` (up to 100 characters). Optional fields are `filters: NewsQuery`, `selected_investigation_id`, `allow_ui_actions`, and `audience: general_public | journalist | investor`. The old speculative history/selected-article fields are not accepted. An omitted `allow_ui_actions` does not authorize workspace changes; the backend validates IANA timezone names.

`AssistantDraft` is model-only: `answer` (up to 12,000 characters), up to 100 citation references, up to 100 result IDs and up to 8 actions. It embeds canonical definitions without external `$ref` values and compiles independently for deriving Gemini's `respond` declaration. Model citations carry source/record IDs only; the backend resolves URL/title through its retrieval ledger. `AssistantResponse` adds the matched request ID, resolved citations, coverage, live/fixture/fallback mode and bounded errors. HTTP error envelopes remain unchanged.

`UIAction` accepts only `{type:"set_filters",filters:NewsQuery}` and `{type:"focus_location",location_id}`. No arbitrary camera coordinates, SQL, code or URL fetching is accepted. Schema validation does not authorize actions or establish their grounding.

`InvestigationQuery` is `{id}`. `InvestigationResponse` includes the resolved investigation, articles, evidence, observations, observation series, locations and sources. All frozen observation fields are required: `id`, `series_id`, `location_id`, `metric`, `value`, `unit`, `statistic`, `source_id`, `observed_at`, `qualifiers`, `time_precision`, `period_start`, `period_end`, `fetched_at`. Values and both period boundaries preserve explicit nulls; precision/statistic enums match the database. Series metadata preserves coverage and retrieval timestamps, expected interval, licensing, attribution and missing-data rules.

`ObservationsQuery` uses optional `location_id`, `metric`, `observed_from`, `observed_to`, `limit`, `offset`. No unsupported `series_id` filter is accepted: the frozen database uniquely identifies each series by location and metric. `CompareObservationsArgs` requires that pair and allows observation range/limit, without offset. `ObservationsResponse` returns raw items and coverage; comparison optionally adds nullable endpoints/difference/unit and a limitation. It does not claim complete-period aggregates. Its dates are observation dates, distinct from publication/event/fetch times.

## Field conventions and boundaries

- Objects are closed. Unknown fields are rejected, not stripped. Validation does not coerce values or inject defaults.
- GET arrays/numbers/bounds must be normalized before validation by the existing backend adapter. `limit` is 1–100 and `offset` is 0–10,000. The backend currently defaults them to 50 and 0, respectively.
- Filter arrays contain up to 100 stable IDs. `keyword` allows 0–1,000 characters; `semantic_query` requires non-whitespace text of at most 4,000 characters. OR within arrays and AND across fields remain backend query semantics.
- `NewsQuery.event_types` allows `flood`, `earthquake`, `cyclone`, `drought`, `wildfire`, `volcano`, `tsunami`; `topics` allows `politics`, `business`, `technology`, `health`, `science`, `environment`, `infrastructure`. Each category array allows at most seven unique values. `verification_status` is `reviewed | unreviewed`; `has_location` is a boolean (GET accepts exactly `true`/`false`). These fields also flow into assistant request/action/tool schemas through the canonical NewsQuery definition.
- `newsFiltering` exports the one discovery-category dictionary and predicate from `schemas/news-categories.ts`. The backend loader consumes it alongside `schemas`; frontend fixtures use the same predicate. Matching uses stored theme tags or whole English headline/excerpt terms, with OR within groups and AND across groups. This is approximate discovery, not reviewed article classification. No article fields are added or rewritten. `themes` remains an exact stored-tag filter, separate from broad `topics`.
- Coordinates are `[longitude, latitude]`; bounds are `[west, south, east, north]`. Schema validation enforces axis ranges and tuple sizes. Ordered bounds, antimeridian handling and ordered/limited query time ranges remain existing backend/database responsibilities; draft-07 schemas do not compare sibling values.
- Instants require UTC `Z` and at most three fractional digits. Calendar dates remain `YYYY-MM-DD`. Unknown values remain `null`; retrieval/discovery times never fill publication/event timestamps.
- `Article.published_date` is optional and nullable because current ingestion normalization omits it. `date_only` publication requires a real calendar date and a null instant. An unavailable publication requires null publication values; a known publication basis requires an instant.
- Article fields emitted by SQL are preserved, including `provider:"curated"`, `content_hash`, date-only metadata and empty verified link arrays for imports. `Source` matches the SQL source projection, including explicit nullable licensing and retrieval fields.
- Scalar primary-key IDs use the database's lowercase pattern and 160-character bound. Citation `record_id` also accepts the public observation ID form `<series-id>@YYYYMMDDTHHMMSSZ`. It is not restricted to Article IDs.
- Citation grounding, known-ID resolution, source–record relationships, filter execution, provider rights and SQL remain Person 3/Person 4 responsibilities. No network fetch policy is implemented by these schemas.
- Schema `$id` values use the reserved `atlas.invalid` namespace as identifiers, never as URLs to fetch. Register the local schemas before compiling references.

See [shared examples](examples/README.md) for seed provenance and regeneration. Investigation, evidence, observation and action schemas live here; consumers must not create private replacements.
