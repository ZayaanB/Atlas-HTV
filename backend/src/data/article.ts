import type { QueryPlan } from './queries.js';

// Backend-owned read of the frozen atlas-p3-v1 article projection. No migration,
// provider access, full-text fetch, or request/model-provided SQL.
export const articlePlan: QueryPlan = {
  text: `SELECT a.id, a.source_id, a.title, a.publisher, a.url, a.excerpt,
  atlas.utc_iso(a.published_at) AS published_at, a.published_date::text AS published_date,
  atlas.utc_iso(a.event_at) AS event_at, atlas.utc_iso(a.discovered_at) AS discovered_at,
  atlas.utc_iso(a.fetched_at) AS fetched_at, a.location_ids, a.entity_ids, a.themes,
  a.provider, a.provider_source_id, a.publication_time_basis, a.verification_status,
  a.geographic_precision, a.content_hash
FROM atlas.article_records a WHERE a.id = $1::text LIMIT 1`,
  parameters: ['id']
};
