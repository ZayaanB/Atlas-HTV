import type { QueryPlan } from './queries.js';

// Backend-owned optional discovery read against Person 4's frozen atlas-p3-v1
// tables (002_records). No migration, inferred associations or provider calls.
export const workspacePlan: QueryPlan = {
  text: `SELECT
    (SELECT COALESCE(json_agg(t ORDER BY t.id), '[]') FROM
      (SELECT id, label FROM atlas.themes ORDER BY id LIMIT 100) t) AS themes,
    (SELECT COALESCE(json_agg(e ORDER BY e.id), '[]') FROM
      (SELECT id, name AS label FROM atlas.entities ORDER BY id LIMIT 100) e) AS entities,
    (SELECT COALESCE(json_agg(i ORDER BY i.id), '[]') FROM
      (SELECT id, title,
        (SELECT COALESCE(json_agg(a.article_id ORDER BY a.position, a.article_id), '[]') FROM
          (SELECT article_id, position FROM atlas.investigation_articles
           WHERE investigation_id = inv.id ORDER BY position, article_id LIMIT 100) a) AS article_ids
       FROM atlas.investigations inv ORDER BY id LIMIT 100) i) AS investigations`,
  parameters: []
};
