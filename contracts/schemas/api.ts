import { bounds, draft, idList, pagination, utcDateTime } from './common.js';

// The existing backend normalizes GET strings before validating this object.
export const newsQuerySchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/NewsQuery',
  type: 'object',
  properties: {
    location_ids: idList,
    themes: idList,
    entity_ids: idList,
    bounds,
    keyword: { type: 'string', maxLength: 1000 },
    semantic_query: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
    published_from: utcDateTime,
    published_to: utcDateTime,
    ...pagination
  },
  additionalProperties: false
} as const;
