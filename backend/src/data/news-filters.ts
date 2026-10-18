import { AppError } from '../runtime/errors.js';
import { strings, type Data, type NewsFiltering } from '../services/validation.js';

// Adapt the frozen article view at the repository boundary. Filter the relation
// before the handoff's ranking, LIMIT and OFFSET, including semantic retrieval.
// Only static reviewed SQL is composed; every rule and client value is bound.
export function filterNewsPlan(plan: {text:string;values:unknown[]}, input: Data, filtering?: NewsFiltering) {
  const active = ['event_types','topics','verification_status','has_location'].some(key => input[key] !== undefined);
  if (!active) return plan;
  if (!filtering || !plan.text.includes('atlas.article_records') || !/^(SELECT|WITH)\s/i.test(plan.text.trimStart()))
    throw new AppError('SCHEMA_HANDOFF_UNAVAILABLE','News filter adapter requires the agreed article view and rebuilt shared contracts',503);
  const values = [...plan.values];
  const bind = (value: unknown) => {values.push(value); return `$${values.length}`;};
  const clauses: string[] = [];
  for (const field of ['event_types','topics']) {
    const ids = strings(input[field]);
    if (!ids.length) continue;
    const rules = filtering.categories.filter(rule => rule.field === field && ids.includes(String(rule.id)));
    if (rules.length !== ids.length) throw new AppError('INVALID_INPUT','Unknown news category');
    const parameter = bind(JSON.stringify(rules));
    clauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(${parameter}::jsonb) rule
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(rule->'themes') theme
        WHERE theme = ANY(a.themes))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(rule->'terms') term
        WHERE strpos(' ' || regexp_replace(lower(coalesce(a.title,'') || ' ' || coalesce(a.excerpt,'')), '[^a-z0-9]+', ' ', 'g') || ' ', ' ' || term || ' ') > 0))`);
  }
  if (input.verification_status !== undefined) clauses.push(`a.verification_status = ${bind(input.verification_status)}::text`);
  if (input.has_location !== undefined) clauses.push(`(cardinality(a.location_ids) > 0) = ${bind(input.has_location)}::boolean`);
  if (!clauses.length) return plan;
  const cte = `atlas_filtered_articles AS (SELECT * FROM atlas.article_records a WHERE ${clauses.join(' AND ')})`;
  const body = plan.text.trimStart().replaceAll('atlas.article_records','atlas_filtered_articles');
  const text = /^WITH\s/i.test(body) ? body.replace(/^WITH\s/i,`WITH ${cte}, `) : `WITH ${cte}\n${body}`;
  return {text,values};
}
