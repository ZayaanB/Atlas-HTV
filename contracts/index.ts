import type { FromSchema } from 'json-schema-to-ts';
import { newsQuerySchema } from './schemas/api.js';
import { articleSchema, locationSchema, sourceSchema } from './schemas/records.js';
import { citationReferenceSchema, citationSchema } from './schemas/assistant.js';
import { apiErrorSchema, coverageSchema, locationsQuerySchema, locationsResponseSchema, newsResponseSchema } from './schemas/responses.js';

// Existing backend handoff: each name is registered once with Ajv.addSchema(schema, name).
export const schemas = {
  NewsQuery: newsQuerySchema,
  Article: articleSchema,
  Location: locationSchema,
  Source: sourceSchema,
  CitationReference: citationReferenceSchema,
  Citation: citationSchema,
  Coverage: coverageSchema,
  LocationsQuery: locationsQuerySchema,
  NewsResponse: newsResponseSchema,
  LocationsResponse: locationsResponseSchema,
  ApiError: apiErrorSchema
} as const;

export type SchemaName = keyof typeof schemas;
// Resolve schemas individually: inferring the entire registry as a generic union
// makes TypeScript expand unrelated response schemas at every validation call.
export type ContractMap = {
  NewsQuery: FromSchema<typeof newsQuerySchema>;
  Article: FromSchema<typeof articleSchema>;
  Location: FromSchema<typeof locationSchema>;
  Source: FromSchema<typeof sourceSchema>;
  CitationReference: FromSchema<typeof citationReferenceSchema>;
  Citation: FromSchema<typeof citationSchema>;
  Coverage: FromSchema<typeof coverageSchema>;
  LocationsQuery: FromSchema<typeof locationsQuerySchema>;
  NewsResponse: FromSchema<typeof newsResponseSchema>;
  LocationsResponse: FromSchema<typeof locationsResponseSchema>;
  ApiError: FromSchema<typeof apiErrorSchema>;
};
export type Contract<Name extends SchemaName> = ContractMap[Name];
export type NewsQuery = Contract<'NewsQuery'>;
export type Article = Contract<'Article'>;
export type Location = Contract<'Location'>;
export type Source = Contract<'Source'>;
export type CitationReference = Contract<'CitationReference'>;
export type Citation = Contract<'Citation'>;
export type Coverage = Contract<'Coverage'>;
export type LocationsQuery = Contract<'LocationsQuery'>;
export type NewsResponse = Contract<'NewsResponse'>;
export type LocationsResponse = Contract<'LocationsResponse'>;
export type ApiError = Contract<'ApiError'>;
