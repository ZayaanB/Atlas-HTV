// Compile-time checks only. @ts-expect-error must fail if a contract becomes too permissive.
import { schemas } from '../index.js';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import type { Article, Citation, CitationReference, Contract, ContractMap, Location, NewsQuery, SchemaName, Source } from '../index.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type _RegistryMatchesTypes = Expect<Equal<SchemaName, keyof ContractMap>>;
type _Provider = Expect<Equal<Article['provider'], 'curated' | 'gdelt' | 'rss'>>;
type _Coordinates = Expect<Equal<Location['coordinates'], [number, number] | null>>;
type _Bounds = Expect<Equal<NonNullable<NewsQuery['bounds']>, [number, number, number, number]>>;
type _OptionalDate = Expect<Equal<Article['published_date'], string | null | undefined>>;
type _NullableSourceTime = Expect<Equal<Source['retrieved_at'], string | null>>;
type _Citation = Expect<Equal<Citation, Contract<'Citation'>>>;
type _QueryKeys = Expect<Equal<keyof NewsQuery, 'location_ids' | 'themes' | 'entity_ids' | 'bounds' | 'keyword' | 'semantic_query' | 'published_from' | 'published_to' | 'limit' | 'offset'>>;

const query: NewsQuery = { location_ids: ['loc-asheville-nc'], bounds: [-83, 35, -82, 36], limit: 20 };
const citation: Citation = { source_id: 'src-usgs-alert-2024-09-30', record_id: 'art-usgs-alert-2024-09-30', url: 'https://water.usgs.gov/', title: 'USGS' };
const reference: CitationReference = { source_id: citation.source_id, record_id: citation.record_id };

// The schema registry is directly consumable by Ajv, including its type-guard API.
const ajv = new Ajv();
addFormats.default(ajv);
for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema, name);
const validateArticle = ajv.compile<Article>(schemas.Article);
declare const payload: unknown;
if (validateArticle(payload)) {
  const typedTitle: string = payload.title;
  void typedTitle;
}

// @ts-expect-error Domain schemas are a closed, named registry.
schemas.UnknownRecord;
// @ts-expect-error Unknown request fields are not accepted.
const unknownQuery: NewsQuery = { sql: 'SELECT 1' };
// @ts-expect-error GET strings must be normalized before validation.
const stringLimit: NewsQuery = { limit: '20' };
// @ts-expect-error A bounds tuple always contains four numbers.
const shortBounds: NewsQuery = { bounds: [1, 2] };
// @ts-expect-error An unresolved reference cannot supply its own URL.
const unsafeReference: CitationReference = { ...reference, url: citation.url };
// @ts-expect-error A resolved citation must carry the original URL and title.
const incompleteCitation: Citation = reference;

declare const article: Article;
declare const location: Location;
declare const source: Source;
// @ts-expect-error Provider is a closed enum.
const wrongProvider: Article = { ...article, provider: 'invented' };
// @ts-expect-error Missing measurements are represented by null, not absent coordinate fields.
const missingCoordinates: Location = { id: 'loc-test', name: 'Test', precision: 'city' };
// @ts-expect-error Geographic precision is an enum, not an arbitrary label.
const wrongPrecision: Location = { ...location, precision: 'exact' };
// @ts-expect-error Nullable fields must be handled before dereferencing.
source.retrieved_at.toUpperCase();

void [query, citation, reference, unknownQuery, stringLimit, shortBounds, unsafeReference, incompleteCitation, wrongProvider, missingCoordinates, wrongPrecision];
