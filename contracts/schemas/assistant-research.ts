import type { FromSchema } from 'json-schema-to-ts';
import { draft, recordId, recordReferenceId, nullableUtcDateTime, nullableCalendarDate } from './common.js';
import { newsQuerySchema } from './api.js';
import { locationsQuerySchema } from './responses.js';
import { articleSchema, sourceSchema } from './records.js';
import { observationSchema, seriesSchema, evidenceSchema } from './workspace.js';
import { assistantFilterPatchSchema } from './assistant-v2.js';

const shape = <N extends string, const P extends Record<string, object>, const R extends readonly (keyof P & string)[]>(name: N, properties: P, required: R) => ({
  $schema: draft, $id: `https://atlas.invalid/contracts/${name}`, type: 'object', properties, required, additionalProperties: false,
}) as const;
const offset = { type: 'integer', minimum: 0, maximum: 10000 } as const;
const limit = { type: 'integer', minimum: 1, maximum: 5 } as const;
const short = { type: 'string', maxLength: 1000 } as const;
const nullableShort = { anyOf: [short, { type: 'null' }] } as const;
const ids = { type: 'array', items: recordId, maxItems: 100 } as const;
const reference = (name: string) => ({ $ref: `https://atlas.invalid/contracts/${name}` }) as const;

export const researchSchemas = {
  AssistantNewsSearchArgs: shape('AssistantNewsSearchArgs', { ...newsQuerySchema.properties, limit, offset }, []),
  AssistantLocationsSearchArgs: shape('AssistantLocationsSearchArgs', { ...locationsQuerySchema.properties, limit, offset }, []),
  AssistantArticleReadArgs: shape('AssistantArticleReadArgs', {
    id: recordId, excerpt_offset: { type: 'integer', minimum: 0, maximum: 1000000 },
    excerpt_limit: { type: 'integer', minimum: 1, maximum: 2000 },
  }, ['id']),
  AssistantInvestigationReadArgs: shape('AssistantInvestigationReadArgs', {
    id: recordId, section: { enum: ['overview', 'articles', 'evidence', 'series', 'observations', 'locations', 'items'] }, limit, offset,
  }, ['id']),
  AssistantCatalogSearchArgs: shape('AssistantCatalogSearchArgs', {
    kind: { enum: ['themes', 'entities', 'investigations'] }, query: { type: 'string', maxLength: 200 }, limit, offset,
  }, ['kind']),
  AssistantSourcesReadArgs: shape('AssistantSourcesReadArgs', { ids: { type: 'array', items: recordId, minItems: 1, maxItems: 5, uniqueItems: true } }, ['ids']),
  AssistantHistoryReadArgs: shape('AssistantHistoryReadArgs', {
    offset: { ...offset, maximum: 5 }, limit: { ...limit, maximum: 2 },
  }, []),
  AssistantResearchRecord: shape('AssistantResearchRecord', {
    id: recordReferenceId,
    record_type: { enum: ['article', 'investigation', 'evidence', 'series', 'observation', 'location', 'source', 'catalog', 'item'] },
    title: short, name: short, label: short, excerpt: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    description: evidenceSchema.properties.description, limitations: evidenceSchema.properties.limitations,
    text: { type: 'string', maxLength: 1200 }, exposure_basis: { anyOf: [{ enum: ['direct', 'sector_association'] }, { type: 'null' }] },
    source_id: { anyOf: [recordId, { type: 'null' }] }, source_ids: ids, location_ids: ids,
    location_id: { anyOf: [recordId, { type: 'null' }] }, primary_location_id: recordId, investigation_id: recordId,
    series_id: { anyOf: [recordId, { type: 'null' }] }, themes: ids, entity_ids: ids,
    published_at: nullableUtcDateTime, published_date: nullableCalendarDate,
    publication_time_basis: articleSchema.properties.publication_time_basis,
    geographic_precision: articleSchema.properties.geographic_precision,
    published_at_basis: sourceSchema.properties.published_at_basis,
    event_at: nullableUtcDateTime, observed_at: nullableUtcDateTime, observed_from: nullableUtcDateTime, observed_to: nullableUtcDateTime,
    period_start: nullableUtcDateTime, period_end: nullableUtcDateTime,
    metric: observationSchema.properties.metric, value: observationSchema.properties.value,
    unit: observationSchema.properties.unit, statistic: observationSchema.properties.statistic,
    time_precision: observationSchema.properties.time_precision, qualifiers: observationSchema.properties.qualifiers,
    expected_interval_seconds: seriesSchema.properties.expected_interval_seconds,
    missing_data_rule: seriesSchema.properties.missing_data_rule, coverage_from: nullableUtcDateTime, coverage_to: nullableUtcDateTime,
    live: { type: 'boolean' },
    precision: { enum: ['address', 'facility', 'city', 'region'] }, verification_status: { enum: ['reviewed', 'unreviewed'] },
    publisher: short, source_type: sourceSchema.properties.source_type, attribution: nullableShort, license: nullableShort,
    excerpt_offset: { type: 'integer', minimum: 0 }, next_excerpt_offset: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    excerpt_total_characters: { type: 'integer', minimum: 0 },
    truncated_fields: { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 20 },
    available_sections: { type: 'array', items: { enum: ['articles', 'evidence', 'series', 'observations', 'locations', 'items'] }, maxItems: 6 },
  }, ['id', 'record_type']),
  AssistantToolResult: shape('AssistantToolResult', {
    kind: { enum: ['news', 'article', 'investigation', 'locations', 'catalog', 'sources', 'observations', 'history', 'receipt', 'error'] },
    items: { type: 'array', items: reference('AssistantResearchRecord'), maxItems: 5 },
    returned_count: { type: 'integer', minimum: 0, maximum: 5 },
    page_returned_count: { type: 'integer', minimum: 0, maximum: 100 },
    offset, next_offset: { anyOf: [offset, { type: 'null' }] }, truncated: { type: 'boolean' },
    limitation: { type: 'string', maxLength: 2000 },
    exchanges: { type: 'array', maxItems: 2, items: {
      type: 'object', properties: { index: { type: 'integer', minimum: 0, maximum: 5 }, user: { type: 'string', maxLength: 4000 }, assistant: { type: 'string', maxLength: 4000 } },
      required: ['index', 'user', 'assistant'], additionalProperties: false,
    } },
    receipt: { type: 'object', properties: {
      action_type: { enum: ['set_filters', 'focus_location', 'open_timeline', 'suggest_timeline'] },
      location_id: recordId, investigation_id: recordId, series_id: recordId,
      observed_from: nullableUtcDateTime, observed_to: nullableUtcDateTime,
      changed_keys: assistantFilterPatchSchema.properties.clear,
      reference: { type: 'string', maxLength: 64 }, already_in_context: { type: 'boolean' },
    }, additionalProperties: false },
    comparison: { anyOf: [{ type: 'object', properties: {
      first_id: recordReferenceId, last_id: recordReferenceId, difference: { type: 'number' }, unit: observationSchema.properties.unit,
    }, required: ['first_id', 'last_id', 'difference', 'unit'], additionalProperties: false }, { type: 'null' }] },
    timeline: { type: 'object', properties: { investigation_id: recordId, series_id: recordId, observed_from: nullableUtcDateTime, observed_to: nullableUtcDateTime }, required: ['investigation_id', 'series_id'], additionalProperties: false },
    error: { type: 'object', properties: { code: { type: 'string', maxLength: 100 }, message: { type: 'string', maxLength: 1000 } }, required: ['code', 'message'], additionalProperties: false },
  }, ['kind', 'items', 'returned_count', 'truncated']),
} as const;
// Infer each definition independently. A mapped generic FromSchema makes
// consumers expand every research schema even when reading an unrelated API.
export type ResearchContracts = {
  AssistantNewsSearchArgs: FromSchema<typeof researchSchemas.AssistantNewsSearchArgs>;
  AssistantLocationsSearchArgs: FromSchema<typeof researchSchemas.AssistantLocationsSearchArgs>;
  AssistantArticleReadArgs: FromSchema<typeof researchSchemas.AssistantArticleReadArgs>;
  AssistantInvestigationReadArgs: FromSchema<typeof researchSchemas.AssistantInvestigationReadArgs>;
  AssistantCatalogSearchArgs: FromSchema<typeof researchSchemas.AssistantCatalogSearchArgs>;
  AssistantSourcesReadArgs: FromSchema<typeof researchSchemas.AssistantSourcesReadArgs>;
  AssistantHistoryReadArgs: FromSchema<typeof researchSchemas.AssistantHistoryReadArgs>;
  AssistantResearchRecord: FromSchema<typeof researchSchemas.AssistantResearchRecord>;
  AssistantToolResult: FromSchema<typeof researchSchemas.AssistantToolResult, { references: [typeof researchSchemas.AssistantResearchRecord] }>;
};
