import { bounds, draft, idList, pagination, utcDateTime } from './common.js';
import { eventTypeIds, topicIds } from './news-categories.js';

// The existing backend normalizes GET strings before validating this object.
export const newsQuerySchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/NewsQuery',
  type: 'object',
  properties: {
    location_ids: idList,
    themes: idList,
    entity_ids: idList,
    event_types: {type:'array',items:{type:'string',enum:eventTypeIds},maxItems:7,uniqueItems:true},
    topics: {type:'array',items:{type:'string',enum:topicIds},maxItems:7,uniqueItems:true},
    verification_status: {type:'string',enum:['reviewed','unreviewed']},
    has_location: {type:'boolean'},
    bounds,
    keyword: { type: 'string', maxLength: 1000 },
    semantic_query: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
    published_from: utcDateTime,
    published_to: utcDateTime,
    ...pagination
  },
  additionalProperties: false
} as const;
