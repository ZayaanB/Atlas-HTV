import type { FromSchema } from 'json-schema-to-ts';
import { bounds, coordinates, draft, recordId, utcDateTime } from './common.js';
import { newsQuerySchema } from './api.js';
import { assistantRequestV2Schema, assistantResponseV2Schema, assistantDraftV2Schema, assistantV2References, uiActionV2Schema } from './assistant-v2.js';
import { assistantStreamEventSchema } from './assistant-stream.js';
import { aircraftSchema, flightRegionSchema } from './workspace.js';
import { windSchemas } from './wind.js';

const shape = <N extends string, const P extends Record<string, object>, const R extends readonly (keyof P & string)[]>(name: N, properties: P, required: R) => ({
  $schema: draft, type: 'object', properties, required, additionalProperties: false,
}) as const;
const inline = <const T extends { $schema: string; $id?: string }>(schema: T) => { const { $id: _id, $schema: _schema, ...body } = schema; return body; };
const short = { type: 'string', maxLength: 300 } as const;
const nullable = <const T extends object>(schema: T) => ({ anyOf: [schema, { type: 'null' }] }) as const;
const ids = { type: 'array', items: recordId, maxItems: 100, uniqueItems: true } as const;
const selection = shape('AssistantSelectionV3', {
  article_id: nullable(recordId), investigation_id: nullable(recordId), location_id: nullable(recordId), aircraft_id: nullable(recordId),
}, ['article_id', 'investigation_id', 'location_id', 'aircraft_id']);
const layers = shape('AssistantLayersV3', { flights: { type: 'boolean' }, wind: { type: 'boolean' } }, ['flights', 'wind']);
const panel = shape('AssistantPanelContextV3', {
  view: { enum: ['search', 'news', 'article', 'investigation', 'saved', 'coverage', 'coordinates', 'aircraft'] },
  id: recordId, tab: { enum: ['brief', 'timeline', 'evidence', 'sources'] },
}, ['view']);
export const workspaceSnapshotV3Schema = shape('AssistantWorkspaceSnapshotV3', {
  revision: { type: 'integer', minimum: 0 }, captured_at: utcDateTime,
  viewport: nullable(shape('AssistantViewportV3', { bounds, center: coordinates, zoom: { type: 'number', minimum: -1, maximum: 24 } }, ['bounds', 'center', 'zoom'])),
  filters: inline(newsQuerySchema), selection, origin: nullable(panel), visible_article_ids: ids,
  timeline: nullable(shape('AssistantTimelineContextV3', { investigation_id: recordId, series_id: recordId, observed_from: utcDateTime, observed_to: utcDateTime }, ['investigation_id', 'series_id'])),
  basemap: { enum: ['auto', 'map', 'satellite'] }, layers,
  capabilities: shape('AssistantCapabilitiesV3', { flights: { type: 'boolean' }, wind: { type: 'boolean' } }, ['flights', 'wind']),
  flight_context: nullable(shape('AssistantFlightContextV3', {
    mode: { enum: ['global', 'area', 'region'] }, region_id: recordId, fetched_at: nullable(utcDateTime), stale: { type: 'boolean' },
  }, ['mode', 'fetched_at', 'stale'])),
  evidence_overlay: nullable(shape('AssistantEvidenceContextV3', { id: recordId, opacity: { type: 'number', minimum: 0, maximum: 1 } }, ['id', 'opacity'])),
}, ['revision', 'captured_at', 'viewport', 'filters', 'selection', 'origin', 'visible_article_ids', 'timeline', 'basemap', 'layers', 'capabilities', 'flight_context']);
const action = <const P extends Record<string, object>, const R extends readonly (keyof P & string)[]>(properties: P, required: R) => ({ type: 'object', properties, required, additionalProperties: false }) as const;
export const uiActionV3Schema = {
  $schema: draft, $id: 'https://atlas.invalid/contracts/UIActionV3', oneOf: [
    ...uiActionV2Schema.oneOf,
    action({ type: { const: 'open_record' }, record_type: { enum: ['article', 'investigation', 'aircraft'] }, id: recordId }, ['type', 'record_type', 'id']),
    action({ type: { const: 'set_basemap' }, basemap: { enum: ['auto', 'map', 'satellite'] } }, ['type', 'basemap']),
    { ...action({ type: { const: 'set_layers' }, ...layers.properties }, ['type']), minProperties: 2 },
    action({ type: { const: 'navigate_map' }, command: { enum: ['zoom_in', 'zoom_out', 'globe'] } }, ['type', 'command']),
  ],
} as const;
const actions = { type: 'array', items: inline(uiActionV3Schema), minItems: 1, maxItems: 8 } as const;
const reference = shape('AssistantRecordReferenceV3', { record_type: { enum: ['article', 'investigation', 'location', 'aircraft'] }, id: recordId, label: short }, ['record_type', 'id', 'label']);
const references = { type: 'array', items: reference, maxItems: 20 } as const;
const pending = shape('AssistantPendingV3', {
  id: recordId, question: { type: 'string', minLength: 1, maxLength: 1000 },
  choices: { type: 'array', items: short, maxItems: 5 }, actions: { ...actions, minItems: 0 },
}, ['id', 'question', 'choices', 'actions']);
const request = shape('AssistantRequestV3', {
  protocol_version: { const: 3 }, request_id: assistantRequestV2Schema.properties.request_id,
  turn_id: recordId, conversation_id: recordId, message: assistantRequestV2Schema.properties.message,
  timezone: assistantRequestV2Schema.properties.timezone, audience: assistantRequestV2Schema.properties.audience,
  interaction_mode: assistantRequestV2Schema.properties.interaction_mode, history: assistantRequestV2Schema.properties.history,
  workspace: workspaceSnapshotV3Schema,
}, ['protocol_version', 'request_id', 'turn_id', 'message', 'timezone', 'workspace']);
const response = {
  ...assistantResponseV2Schema, $id: 'https://atlas.invalid/contracts/AssistantResponseV3',
  properties: { ...assistantResponseV2Schema.properties, protocol_version: { const: 3 }, actions: { ...actions, minItems: 0 },
    conversation_id: recordId, context: workspaceSnapshotV3Schema, research_scope: inline(newsQuerySchema), references,
    pending: nullable(pending),
  },
  required: [...assistantResponseV2Schema.required, 'conversation_id', 'context', 'research_scope', 'references', 'pending'],
  allOf: [...assistantResponseV2Schema.allOf, {
    if: { properties: { mode: { const: 'fallback' } } },
    then: { properties: { references: { type: 'array', maxItems: 0 }, pending: { type: 'null' } } },
  }],
} as const;
const draftV3 = shape('AssistantDraftV3', {
  ...assistantDraftV2Schema.properties, actions: { ...actions, minItems: 0, maxItems: 0 }, references,
  clarification: nullable(shape('AssistantClarificationV3', {
    question: pending.properties.question, choices: pending.properties.choices, proposed_actions: { ...actions, minItems: 0 },
  }, ['question', 'choices', 'proposed_actions'])),
}, [...assistantDraftV2Schema.required]);
const stream = { ...assistantStreamEventSchema, $id: 'https://atlas.invalid/contracts/AssistantStreamEventV3',
  oneOf: [assistantStreamEventSchema.oneOf[0], assistantStreamEventSchema.oneOf[1],
    action({ request_id: assistantRequestV2Schema.properties.request_id, type: { const: 'complete' }, response: { $ref: response.$id } }, ['request_id', 'type', 'response']),
    assistantStreamEventSchema.oneOf[3]],
} as const;
export const assistantV3Schemas = {
  AssistantWorkspaceSnapshotV3: workspaceSnapshotV3Schema, UIActionV3: uiActionV3Schema,
  AssistantRequestV3: request, AssistantResponseV3: response, AssistantDraftV3: draftV3, AssistantStreamEventV3: stream,
  AssistantScopeArgsV3: shape('AssistantScopeArgsV3', { filters: inline(newsQuerySchema), visible_only: { type: 'boolean' } }, ['filters']),
  AssistantWorkspaceArgsV3: shape('AssistantWorkspaceArgsV3', {}, []),
  AssistantActionsArgsV3: shape('AssistantActionsArgsV3', { request_quote: { type: 'string', minLength: 1, maxLength: 4000 }, actions }, ['request_quote', 'actions']),
  AssistantResolvePendingArgsV3: shape('AssistantResolvePendingArgsV3', { id: recordId, choice: short, decision: { enum: ['accept', 'reject', 'answer'] } }, ['id', 'choice', 'decision']),
  AssistantDateArgsV3: shape('AssistantDateArgsV3', { expression: { type: 'string', minLength: 1, maxLength: 200 }, target: { enum: ['publication', 'observation'] } }, ['expression', 'target']),
  AssistantResolvedRangeV3: assistantResponseV2Schema.properties.resolved_range,
  AssistantAircraftArgsV3: shape('AssistantAircraftArgsV3', { identifier: { type: 'string', maxLength: 16 } }, []),
  AssistantWorkspaceResultV3: shape('AssistantWorkspaceResultV3', {
    workspace: workspaceSnapshotV3Schema, research_scope: inline(newsQuerySchema), pending: nullable(pending), references,
    turns: { type: 'array', maxItems: 6, items: shape('AssistantReferenceTurnV3', { turn_id: recordId, references, research_scope: inline(newsQuerySchema) }, ['turn_id', 'references', 'research_scope']) },
    selected: { type: 'array', items: reference, maxItems: 4 },
    resolution: nullable(short),
  }, ['workspace', 'research_scope', 'pending', 'references', 'turns', 'selected', 'resolution']),
  AssistantAircraftResultV3: shape('AssistantAircraftResultV3', {
    items: { type: 'array', items: inline(aircraftSchema), maxItems: 5 }, fetched_at: nullable(utcDateTime), stale: { type: 'boolean' },
    replay: { type: 'boolean' }, mode: { enum: ['live', 'fixture', 'replay'] }, attribution: { type: 'string', maxLength: 1000 }, truncated: { type: 'boolean' },
    coverage: nullable(inline(flightRegionSchema)), limitation: { type: 'string', maxLength: 1000 },
  }, ['items', 'fetched_at', 'stale', 'replay', 'mode', 'attribution', 'truncated', 'coverage', 'limitation']),
  AssistantWindResultV3: windSchemas.WindResponse,
} as const;
type Refs = [...typeof assistantV2References];
export type AssistantV3Contracts = {
  AssistantWorkspaceSnapshotV3: FromSchema<typeof workspaceSnapshotV3Schema>;
  UIActionV3: FromSchema<typeof uiActionV3Schema, { references: Refs }>;
  AssistantRequestV3: FromSchema<typeof request>;
  AssistantResponseV3: FromSchema<typeof response, { references: Refs }>;
  AssistantDraftV3: FromSchema<typeof draftV3, { references: Refs }>;
  AssistantStreamEventV3: FromSchema<typeof stream, { references: [typeof response, ...Refs] }>;
  AssistantScopeArgsV3: FromSchema<typeof assistantV3Schemas.AssistantScopeArgsV3>;
  AssistantWorkspaceArgsV3: FromSchema<typeof assistantV3Schemas.AssistantWorkspaceArgsV3>;
  AssistantActionsArgsV3: FromSchema<typeof assistantV3Schemas.AssistantActionsArgsV3, { references: Refs }>;
  AssistantResolvePendingArgsV3: FromSchema<typeof assistantV3Schemas.AssistantResolvePendingArgsV3>;
  AssistantDateArgsV3: FromSchema<typeof assistantV3Schemas.AssistantDateArgsV3>;
  AssistantResolvedRangeV3: FromSchema<typeof assistantV3Schemas.AssistantResolvedRangeV3>;
  AssistantAircraftArgsV3: FromSchema<typeof assistantV3Schemas.AssistantAircraftArgsV3>;
  AssistantWorkspaceResultV3: FromSchema<typeof assistantV3Schemas.AssistantWorkspaceResultV3, { references: Refs }>;
  AssistantAircraftResultV3: FromSchema<typeof assistantV3Schemas.AssistantAircraftResultV3>;
  AssistantWindResultV3: FromSchema<typeof assistantV3Schemas.AssistantWindResultV3>;
};
