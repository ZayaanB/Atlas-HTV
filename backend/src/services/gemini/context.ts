import { AppError, checkAbort } from '../../runtime/errors.js';
import { type Data, records, strings } from '../validation.js';
import { Retrieval } from '../retrieval.js';

export async function assistantContext(input: Data, retrieval: Retrieval, signal?: AbortSignal): Promise<Data> {
  const catalog = await retrieval.catalog(signal);
  const article = input.selected_article_id ? await retrieval.article(String(input.selected_article_id), signal) : null;
  let investigationId = input.selected_investigation_id;
  if (!investigationId && article) {
    const linked = records(catalog.investigations).filter(i => strings(i.article_ids).includes(String(article.id)));
    if (linked.length === 1) investigationId = linked[0]!.id;
  }
  const investigation = investigationId ? await retrieval.investigation({ id: investigationId }, signal) : null;
  let location: Data | null = null;
  if (input.selected_location_id) location = await retrieval.location(String(input.selected_location_id), signal);
  else if (article && strings(article.location_ids).length === 1) location = await retrieval.location(strings(article.location_ids)[0]!, signal);
  else if (investigation) {
    const primary = (investigation.investigation as Data).primary_location_id;
    if (primary) location = await retrieval.location(String(primary), signal);
  }
  checkAbort(signal);
  return { catalog, article, investigation, location, bounds: location ? null : input.selected_bounds ?? null };
}

export async function timelineTarget(raw: Data, retrieval: Retrieval, signal?: AbortSignal): Promise<Data> {
  const investigation = await retrieval.investigation({ id: raw.investigation_id }, signal);
  const series = records(investigation.observation_series).find(s => s.id === raw.series_id);
  if (!series) throw new AppError('NOT_FOUND', 'Observation series is not linked to this investigation', 404);
  const query: Data = { location_id: series.location_id, metric: series.metric, series_id: series.id, limit: 100 };
  for (const key of ['observed_from', 'observed_to']) if (raw[key] !== undefined) query[key] = raw[key];
  const comparison = await retrieval.compare(query, signal);
  if (records(comparison.items).some(row => row.series_id !== series.id || row.source_id !== series.source_id || row.unit !== series.unit))
    throw new AppError('INCOMPARABLE_OBSERVATIONS', 'Timeline data does not match the linked series');
  return { investigation_id: raw.investigation_id, series_id: series.id,
    ...(raw.observed_from === undefined ? {} : { observed_from: raw.observed_from }),
    ...(raw.observed_to === undefined ? {} : { observed_to: raw.observed_to }) };
}
