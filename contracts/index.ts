import type { FromSchema } from 'json-schema-to-ts';
import { newsQuerySchema } from './schemas/api.js';
import { articleSchema, locationSchema, sourceSchema } from './schemas/records.js';
import { citationReferenceSchema, citationSchema } from './schemas/assistant.js';

// Existing backend handoff: each name is registered once with Ajv.addSchema(schema, name).
export const schemas = {
  NewsQuery: newsQuerySchema,
  Article: articleSchema,
  Location: locationSchema,
  Source: sourceSchema,
  CitationReference: citationReferenceSchema,
  Citation: citationSchema
} as const;

export type SchemaName = keyof typeof schemas;
export type ContractMap = { [Name in SchemaName]: FromSchema<(typeof schemas)[Name]> };
export type Contract<Name extends SchemaName> = ContractMap[Name];
export type NewsQuery = Contract<'NewsQuery'>;
export type Article = Contract<'Article'>;
export type Location = Contract<'Location'>;
export type Source = Contract<'Source'>;
export type CitationReference = Contract<'CitationReference'>;
export type Citation = Contract<'Citation'>;
