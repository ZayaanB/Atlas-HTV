// JSON Schema values only: shared by all records, emitted unchanged for Ajv consumers.
export const draft = 'http://json-schema.org/draft-07/schema#';

export const recordId = {
  type: 'string', minLength: 1, maxLength: 160,
  pattern: '^[a-z0-9][a-z0-9._:-]*$'
} as const;

// Citations may target a hypertable observation, whose public ID is not a database primary-key ID.
export const recordReferenceId = {
  anyOf: [recordId, {
    type: 'string', minLength: 18, maxLength: 177,
    pattern: '^[a-z0-9][a-z0-9._:-]*@[0-9]{8}T[0-9]{6}Z$'
  }]
} as const;

export const utcDateTime = {
  type: 'string', format: 'date-time',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9](?:\\.[0-9]{1,3})?Z$'
} as const;
export const calendarDate = {
  type: 'string', format: 'date', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
} as const;
export const nullableUtcDateTime = { anyOf: [utcDateTime, { type: 'null' }] } as const;
export const nullableCalendarDate = { anyOf: [calendarDate, { type: 'null' }] } as const;

export const httpsUrl = {
  type: 'string', format: 'uri', minLength: 9, maxLength: 2048,
  // HTTPS with an authority, no credentials or whitespace. This is not a network-access allowlist.
  pattern: '^https://[^/@\\s?#]+(?:[/?#]|$)'
} as const;
export const text = { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' } as const;
export const nullableText = { anyOf: [text, { type: 'null' }] } as const;
export const title = text;
export const publisher = { ...text, maxLength: 300 } as const;
export const precision = { enum: ['address', 'facility', 'city', 'region'] } as const;
export const verificationStatus = { enum: ['reviewed', 'unreviewed'] } as const;
export const publicationTimeBasis = {
  enum: ['feed_asserted', 'page_metadata', 'document_text', 'date_only', 'unavailable']
} as const;

const longitude = { type: 'number', minimum: -180, maximum: 180 } as const;
const latitude = { type: 'number', minimum: -90, maximum: 90 } as const;
export const coordinates = {
  type: 'array', items: [longitude, latitude], minItems: 2, maxItems: 2, additionalItems: false
} as const;
export const bounds = {
  type: 'array', items: [longitude, latitude, longitude, latitude],
  minItems: 4, maxItems: 4, additionalItems: false
} as const;
export const idList = { type: 'array', items: recordId, maxItems: 100 } as const;
export const pagination = {
  limit: { type: 'integer', minimum: 1, maximum: 100 },
  offset: { type: 'integer', minimum: 0, maximum: 10000 }
} as const;
