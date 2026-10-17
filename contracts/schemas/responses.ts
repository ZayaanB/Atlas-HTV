import { draft, idList, nullableUtcDateTime, pagination, recordId, text, verificationStatus } from './common.js';
import { articleSchema, locationSchema } from './records.js';

// Embed self-contained definitions without registering the same nested $id twice.
const { $id: articleId, $schema: articleDraft, ...articleBody } = articleSchema;
const { $id: locationId, $schema: locationDraft, ...locationBody } = locationSchema;

const count = { type: 'integer', minimum: 0 } as const;
const status = { enum: ['success', 'failed'] } as const;
const nullable = <T extends object>(schema: T) => ({ anyOf: [schema, { type: 'null' }] } as const);
const feed = {
  type: 'object', properties: {
    source_id: recordId, status, attempted_at: nullableUtcDateTime,
    last_successful_at: nullableUtcDateTime, next_retry_at: nullableUtcDateTime,
    verification_status: verificationStatus, article_count: count, publication_time_known_count: count
  }, required: ['source_id', 'status', 'attempted_at', 'last_successful_at', 'next_retry_at', 'verification_status', 'article_count', 'publication_time_known_count'],
  additionalProperties: false
} as const;
const dataset = {
  type: 'object', properties: {
    series_id: recordId, location_id: recordId, metric: text, unit: text, source_id: recordId,
    coverage_from: nullableUtcDateTime, coverage_to: nullableUtcDateTime, retrieved_at: nullableUtcDateTime, live: { type: 'boolean' }
  }, required: ['series_id', 'location_id', 'metric', 'unit', 'source_id', 'coverage_from', 'coverage_to', 'retrieved_at', 'live'],
  additionalProperties: false
} as const;
const articleCounts = {
  type: 'object', properties: { total: count, reviewed: count, unreviewed: count, publication_time_known: count, publication_date_only: count },
  required: ['total', 'reviewed', 'unreviewed', 'publication_time_known', 'publication_date_only'], additionalProperties: false
} as const;

// Mirrors the existing freshness SQL projection. Counts describe the stored corpus,
// never a filtered result total. An unavailable repository may provide no freshness row.
export const coverageSchema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/Coverage', type: 'object',
  properties: {
    mode: { enum: ['stored', 'fixture', 'unavailable'] }, live: { const: false },
    scope: { enum: ['all', 'source'] }, source_id: nullable(recordId), status: nullable(status),
    attempted_at: nullableUtcDateTime, last_successful_at: nullableUtcDateTime, next_retry_at: nullableUtcDateTime,
    consecutive_failures: nullable(count), verification_status: nullable(verificationStatus),
    feeds: nullable({ type: 'array', items: feed, maxItems: 100 } as const),
    datasets: nullable({ type: 'array', items: dataset, maxItems: 100 } as const), articles: nullable(articleCounts)
  }, required: ['mode', 'live'], additionalProperties: false
} as const;

const { $id: coverageId, $schema: coverageDraft, ...coverageBody } = coverageSchema;
export const locationsQuerySchema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/LocationsQuery', type: 'object',
  properties: { ids: idList, query: { type: 'string', maxLength: 300 }, ...pagination }, additionalProperties: false
} as const;
export const newsResponseSchema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/NewsResponse', type: 'object',
  properties: {
    items: { type: 'array', items: articleBody, maxItems: 100 }, ...pagination,
    coverage: coverageBody, search_mode: { enum: ['keyword', 'semantic', 'keyword_fallback'] }
  }, required: ['items', 'limit', 'offset', 'coverage', 'search_mode'], additionalProperties: false
} as const;
export const locationsResponseSchema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/LocationsResponse', type: 'object',
  properties: { items: { type: 'array', items: locationBody, maxItems: 100 }, coverage: coverageBody },
  required: ['items', 'coverage'], additionalProperties: false
} as const;
export const apiErrorSchema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/ApiError', type: 'object',
  properties: { error: {
    type: 'object', properties: {
      code: { ...text, maxLength: 160 }, message: text, retryable: { type: 'boolean' },
      request_id: { type: 'string', minLength: 1, maxLength: 256 }
    }, required: ['code', 'message', 'retryable', 'request_id'], additionalProperties: false
  } }, required: ['error'], additionalProperties: false
} as const;
