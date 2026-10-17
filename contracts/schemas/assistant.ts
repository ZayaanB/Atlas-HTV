import { draft, httpsUrl, recordId, recordReferenceId, title } from './common.js';

const referenceProperties = { source_id: recordId, record_id: recordReferenceId } as const;

// An unresolved reference carries no model-supplied URL or title.
export const citationReferenceSchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/CitationReference',
  type: 'object',
  properties: referenceProperties,
  required: ['source_id', 'record_id'],
  additionalProperties: false
} as const;

// The backend resolves the URL/title against retrieved original sources.
export const citationSchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/Citation',
  type: 'object',
  properties: { ...referenceProperties, url: httpsUrl, title },
  required: ['source_id', 'record_id', 'url', 'title'],
  additionalProperties: false
} as const;
