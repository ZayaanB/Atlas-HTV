import {
  bounds, calendarDate, coordinates, draft, httpsUrl, idList, nullableCalendarDate,
  nullableText, nullableUtcDateTime, precision, publicationTimeBasis, publisher,
  recordId, text, title, utcDateTime, verificationStatus
} from './common.js';

export const articleSchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/Article',
  type: 'object',
  properties: {
    id: recordId,
    source_id: recordId,
    title,
    publisher,
    url: httpsUrl,
    excerpt: { anyOf: [{ ...text, maxLength: 500 }, { type: 'null' }] },
    published_at: nullableUtcDateTime,
    // SQL emits this field; current normalizeArticle() omits it.
    published_date: nullableCalendarDate,
    publication_time_basis: publicationTimeBasis,
    event_at: nullableUtcDateTime,
    discovered_at: nullableUtcDateTime,
    fetched_at: utcDateTime,
    location_ids: idList,
    entity_ids: idList,
    themes: idList,
    provider: { enum: ['curated', 'gdelt', 'rss'] },
    provider_source_id: recordId,
    verification_status: verificationStatus,
    geographic_precision: { anyOf: [precision, { type: 'null' }] },
    content_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' }
  },
  required: [
    'id', 'source_id', 'title', 'publisher', 'url', 'excerpt', 'published_at',
    'publication_time_basis', 'event_at', 'discovered_at', 'fetched_at',
    'location_ids', 'entity_ids', 'themes', 'provider', 'provider_source_id',
    'verification_status', 'geographic_precision', 'content_hash'
  ],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { publication_time_basis: { const: 'date_only' } }, required: ['publication_time_basis'] },
      then: { properties: { published_at: { type: 'null' }, published_date: calendarDate }, required: ['published_date'] }
    },
    {
      if: { properties: { publication_time_basis: { const: 'unavailable' } }, required: ['publication_time_basis'] },
      then: { properties: { published_at: { type: 'null' }, published_date: { type: 'null' } } }
    },
    {
      if: { properties: { publication_time_basis: { enum: ['feed_asserted', 'page_metadata', 'document_text'] } }, required: ['publication_time_basis'] },
      then: { properties: { published_at: utcDateTime } }
    }
  ]
} as const;

export const locationSchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/Location',
  type: 'object',
  properties: {
    id: recordId,
    name: { ...text, maxLength: 300 },
    precision,
    coordinates: { anyOf: [coordinates, { type: 'null' }] },
    bounds: { anyOf: [bounds, { type: 'null' }] },
    coordinates_basis: nullableText,
    bounds_basis: nullableText,
    source_id: { anyOf: [recordId, { type: 'null' }] },
    verification_status: verificationStatus
  },
  required: ['id', 'name', 'precision', 'coordinates', 'bounds', 'coordinates_basis', 'bounds_basis', 'source_id', 'verification_status'],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { precision: { enum: ['city', 'region'] } }, required: ['precision'] },
      then: { properties: { bounds } }
    },
    {
      if: { properties: { precision: { enum: ['address', 'facility'] } }, required: ['precision'] },
      then: { properties: { coordinates } }
    },
    {
      if: { properties: { coordinates: { type: 'null' } }, required: ['coordinates'] },
      then: { properties: { coordinates_basis: { type: 'null' } } },
      else: { properties: { coordinates_basis: text } }
    },
    {
      if: { properties: { bounds: { type: 'null' } }, required: ['bounds'] },
      then: { properties: { bounds_basis: { type: 'null' } } },
      else: { properties: { bounds_basis: text } }
    }
  ]
} as const;

export const sourceSchema = {
  $schema: draft,
  $id: 'https://atlas.invalid/contracts/Source',
  type: 'object',
  properties: {
    id: recordId,
    url: httpsUrl,
    title,
    publisher,
    source_type: { enum: ['news_article', 'government_report', 'dataset', 'imagery', 'web_page'] },
    license: nullableText,
    license_url: { anyOf: [httpsUrl, { type: 'null' }] },
    attribution: nullableText,
    published_at: nullableUtcDateTime,
    published_date: nullableCalendarDate,
    published_at_basis: publicationTimeBasis,
    retrieved_at: nullableUtcDateTime,
    verification_status: verificationStatus
  },
  required: [
    'id', 'url', 'title', 'publisher', 'source_type', 'license', 'license_url',
    'attribution', 'published_at', 'published_date', 'published_at_basis',
    'retrieved_at', 'verification_status'
  ],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { published_at_basis: { const: 'date_only' } }, required: ['published_at_basis'] },
      then: { properties: { published_at: { type: 'null' }, published_date: calendarDate } }
    },
    {
      if: { properties: { published_at_basis: { const: 'unavailable' } }, required: ['published_at_basis'] },
      then: { properties: { published_at: { type: 'null' }, published_date: { type: 'null' } } }
    },
    {
      if: { properties: { published_at_basis: { enum: ['feed_asserted', 'page_metadata', 'document_text'] } }, required: ['published_at_basis'] },
      then: { properties: { published_at: utcDateTime } }
    }
  ]
} as const;
