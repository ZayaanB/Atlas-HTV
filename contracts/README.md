# Shared contracts — Person 1

One authoritative JSON Schema draft-07 set for frontend and backend. `schemas/*.ts` contains plain, serializable schema definitions; `index.ts` exports the backend-compatible `schemas` registry and types inferred with `json-schema-to-ts`. There are no separately maintained frontend/backend interfaces or validators.

This includes the authorized core-contract and frontend-foundation slices, not the complete API. Frontend consumers use Zustand and TanStack Query; backend/database/map implementations remain unchanged by this slice.

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
- `contracts/dist/schemas/*.json`: self-contained JSON Schemas generated for every exported name from the same definitions. Do not edit or copy them into another workstream.

The package exports its root module, `@atlas/contracts/schemas/Article.json` (and the other named JSON files), and `@atlas/contracts/examples/helene-api.json`. The frontend depends on `@atlas/contracts` via `file:../contracts`; build this package first. Type inference is type-only; `json-schema-to-ts` remains a package dependency because the exported declarations reference it.

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

**Partial readiness is intentional.** Eight of the backend's 24 required schemas are supplied; `CitationReference`, `Coverage`, and `ApiError` are supporting definitions. Its configuration check still reports **16 missing schemas**. News/location retrieval now has the necessary schemas, but actual API success depends on backend/database setup; overall readiness remains incomplete. No permissive schemas are added to make the backend report ready.

## Field conventions and boundaries

- Objects are closed. Unknown fields are rejected, not stripped. Validation does not coerce values or inject defaults.
- GET arrays/numbers/bounds must be normalized before validation by the existing backend adapter. `limit` is 1–100 and `offset` is 0–10,000. The backend currently defaults them to 50 and 0, respectively.
- Filter arrays contain up to 100 stable IDs. `keyword` allows 0–1,000 characters; `semantic_query` requires non-whitespace text of at most 4,000 characters. OR within arrays and AND across fields remain backend query semantics.
- Coordinates are `[longitude, latitude]`; bounds are `[west, south, east, north]`. Schema validation enforces axis ranges and tuple sizes. Ordered bounds, antimeridian handling and ordered/limited query time ranges remain existing backend/database responsibilities; draft-07 schemas do not compare sibling values.
- Instants require UTC `Z` and at most three fractional digits. Calendar dates remain `YYYY-MM-DD`. Unknown values remain `null`; retrieval/discovery times never fill publication/event timestamps.
- `Article.published_date` is optional and nullable because current ingestion normalization omits it. `date_only` publication requires a real calendar date and a null instant. An unavailable publication requires null publication values; a known publication basis requires an instant.
- Article fields emitted by SQL are preserved, including `provider:"curated"`, `content_hash`, date-only metadata and empty verified link arrays for imports. `Source` matches the SQL source projection, including explicit nullable licensing and retrieval fields.
- Scalar primary-key IDs use the database's lowercase pattern and 160-character bound. Citation `record_id` also accepts the public observation ID form `<series-id>@YYYYMMDDTHHMMSSZ`. It is not restricted to Article IDs.
- Citation grounding, known-ID resolution, source–record relationships, filter execution, provider rights and SQL remain Person 3/Person 4 responsibilities. No network fetch policy is implemented by these schemas.
- Schema `$id` values use the reserved `atlas.invalid` namespace as identifiers, never as URLs to fetch. Register the local schemas before compiling references.

See [shared examples](examples/README.md) for seed provenance and regeneration. Future investigation, evidence, observation and action schemas belong here when separately implemented; consumers must not create private replacements.
