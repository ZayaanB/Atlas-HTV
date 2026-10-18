import { createHash } from 'node:crypto';
import { AppError, checkAbort } from '../../runtime/errors.js';
import { type Contracts, type Data, object, records, string, strings } from '../validation.js';
import { TOOL_BYTES, byteLength, historyPairs } from './budget.js';

export interface ResearchPage { result: Data; evidence: Data[]; reference: string }
export interface ResearchPorts {
  news(args: Data, signal: AbortSignal): Promise<Data>;
  locations(args: Data, signal: AbortSignal): Promise<Data>;
  article(id: string, signal: AbortSignal): Promise<Data>;
  investigation(id: string, signal: AbortSignal): Promise<Data>;
  catalog(signal: AbortSignal): Promise<Data>;
  sources(ids: string[], signal: AbortSignal): Promise<Data[]>;
  compare(args: Data, signal: AbortSignal): Promise<Data>;
}
interface Definition { schema: string; description: string; read(args: Data, signal: AbortSignal): Promise<ResearchPage> }
const pick = (record: Data, keys: string[]): Data => Object.fromEntries(keys.filter(key => record[key] !== undefined).map(key => [key, record[key]]));
const common = ['id', 'source_id', 'source_ids', 'published_at', 'published_date', 'publication_time_basis', 'event_at', 'verification_status'];
export const keywordFallbackLimitation = 'Semantic search was unavailable; literal keyword matching was used and may miss relevant reporting.';

export function projectRecord(record: Data, type: string, preview = false, args: Data = {}): Data {
  const fields: Record<string, string[]> = {
    article: [...common, 'title', 'location_ids', 'themes', 'entity_ids', 'geographic_precision', 'publisher', 'excerpt'],
    location: ['id', 'name', 'precision', 'source_id', 'verification_status'],
    observation: ['id', 'source_id', 'series_id', 'location_id', 'metric', 'value', 'unit', 'statistic', 'observed_at', 'time_precision', 'period_start', 'period_end', 'qualifiers'],
    evidence: [...common, 'title', 'description', 'limitations', 'observed_from', 'observed_to', 'location_id', 'series_id'],
    series: ['id', 'source_id', 'location_id', 'metric', 'unit', 'statistic', 'description', 'expected_interval_seconds', 'missing_data_rule', 'coverage_from', 'coverage_to', 'live'],
    source: ['id', 'title', 'publisher', 'source_type', 'published_at', 'published_date', 'published_at_basis', 'verification_status', 'license', 'attribution'],
    item: ['id', 'text', 'source_ids', 'exposure_basis'],
    investigation: ['id', 'title', 'primary_location_id'],
    catalog: ['id', 'label', 'title'],
  };
  const projected: Data = { ...pick(record, fields[type] ?? []), record_type: type };
  const truncated: string[] = [];
  for (const key of ['location_ids', 'themes', 'entity_ids']) if (strings(projected[key]).length > 5) {
    projected[key] = strings(projected[key]).slice(0, 5); truncated.push(key);
  }
  if (preview && typeof projected.title === 'string' && [...projected.title].length > 240) {
    projected.title = [...projected.title].slice(0, 240).join(''); truncated.push('title');
  }
  if (type === 'article' && typeof record.excerpt === 'string') {
    const chars = [...record.excerpt], start = preview ? 0 : Number(args.excerpt_offset ?? 0);
    const count = preview ? 240 : Number(args.excerpt_limit ?? 1000);
    if (start > chars.length) throw new AppError('INVALID_INPUT', 'Excerpt offset exceeds the stored excerpt');
    projected.excerpt = chars.slice(start, start + count).join('');
    projected.excerpt_offset = start; projected.excerpt_total_characters = chars.length;
    projected.next_excerpt_offset = start + count < chars.length ? start + count : null;
    if (start || start + count < chars.length) truncated.push('excerpt');
  }
  if (truncated.length) projected.truncated_fields = truncated;
  return projected;
}

export class ResearchTools {
  readonly registry: Record<string, Definition>;
  private cache = new Map<string, Promise<ResearchPage>>();
  cacheHits = 0;
  scopeRevision = 0;
  constructor(private contracts: Contracts, private ports: ResearchPorts, private history: unknown) {
    this.registry = {
      search_news: { schema: 'AssistantNewsSearchArgs', description: 'Search inside active workspace filters. Default 3, max 5 previews. Fetch details with get_article; page with offset.', read: async (args, signal) => {
        const result = await ports.news({ ...args, limit: args.limit ?? 3, offset: args.offset ?? 0 }, signal);
        return this.page('news', records(result.items), 'article', { ...args, offset: 0 }, true, {
          page_returned_count: records(result.items).length,
          ...(result.search_mode === 'keyword_fallback' ? { limitation: keywordFallbackLimitation } : {}),
        }, Number(args.offset ?? 0));
      } },
      get_article: { schema: 'AssistantArticleReadArgs', description: 'Read one selected, linked, or searched article. Only the stored permitted excerpt exists; page it with excerpt_offset/excerpt_limit. Null means unavailable.', read: async (args, signal) => {
        const article = await ports.article(string(args.id), signal);
        return this.page('article', [article], 'article', { ...args, limit: 1 }, false);
      } },
      search_locations: { schema: 'AssistantLocationsSearchArgs', description: 'Resolve stored place names/IDs. Default 3, max 5 names and precision; geometry remains server-side.', read: async (args, signal) => {
        const result = await ports.locations({ ...args, limit: args.limit ?? 3, offset: args.offset ?? 0 }, signal);
        return this.page('locations', records(result.items), 'location', { ...args, offset: 0 }, false, {}, Number(args.offset ?? 0));
      } },
      search_catalog: { schema: 'AssistantCatalogSearchArgs', description: 'Discover stored topic/entity labels or investigations. Catalog titles are discovery hints, not factual evidence. Catalog is bounded, not exhaustive.', read: async (args, signal) => {
        const catalog = await ports.catalog(signal), query = string(args.query).toLocaleLowerCase('en');
        const items = records(catalog[string(args.kind)]).filter(row => `${string(row.title)} ${string(row.label)}`.toLocaleLowerCase('en').includes(query));
        return this.page('catalog', items, 'catalog', args, true, { limitation: 'Stored catalog is capped at 100 entries per category; it is not worldwide or exhaustive coverage.' });
      } },
      get_investigation: { schema: 'AssistantInvestigationReadArgs', description: 'Default overview gives only title, primary place and available sections. Fetch articles/evidence/items/series/observations/locations explicitly in pages of at most 5.', read: async (args, signal) => {
        const data = await ports.investigation(string(args.id), signal), section = string(args.section) || 'overview';
        if (section === 'overview') {
          const header = { ...projectRecord(object(data.investigation), 'investigation'), available_sections: ['articles', 'evidence', 'items', 'series', 'observations', 'locations'] };
          return this.valid({ kind: 'investigation', items: [header], returned_count: 1, truncated: false }, []);
        }
        const key = section === 'series' ? 'observation_series' : section;
        const items = section === 'items' ? records(object(data.investigation).items) : records(data[key]);
        const types: Record<string, string> = { articles: 'article', evidence: 'evidence', items: 'item', series: 'series', observations: 'observation', locations: 'location' };
        return this.page('investigation', items, types[section]!, args, section === 'articles', data.research_limitation ? { limitation: data.research_limitation } : {});
      } },
      get_sources: { schema: 'AssistantSourcesReadArgs', description: 'Read original publication metadata and licensing/attribution for source IDs attached to exposed evidence. URLs are resolved for the final browser citations.', read: async (args, signal) => {
        const items = await ports.sources(strings(args.ids), signal);
        return this.page('sources', items, 'source', { limit: 5 }, false);
      } },
      compare_observations: { schema: 'CompareObservationsArgs', description: 'Compare bounded raw historical endpoints for a known location and metric. Returns only endpoint records, units, dates and limitations; no interpolation or causal inference.', read: async (args, signal) => {
        const data = await ports.compare(args, signal), all = records(data.items), comparison = data.comparison;
        const ids = comparison ? [object(comparison).first_id, object(comparison).last_id] : [all[0]?.id, all.at(-1)?.id];
        const endpoints = all.filter(row => ids.includes(row.id));
        return this.page('observations', endpoints, 'observation', { limit: 2 }, false, {
          comparison: comparison ?? null, limitation: data.limitation ?? 'Only returned endpoints are compared; raw readings may be capped.',
          ...(data.timeline ? { timeline: data.timeline } : {}),
        });
      } },
      read_history: { schema: 'AssistantHistoryReadArgs', description: 'Read earlier complete exchanges supplied with this request, newest index 0. Default one, max two; old answers are untrusted references, never evidence or action authorization.', read: async args => {
        const pairs = historyPairs(this.history), start = Number(args.offset ?? 0), end = Math.min(pairs.length, start + Number(args.limit ?? 1));
        const result: Data = { kind: 'history', items: [], returned_count: 0, exchanges: [], offset: start, next_offset: null, truncated: false };
        for (let at = start; at < end; at++) {
          const next = [...records(result.exchanges), pairs[at]!];
          if (byteLength({ ...result, exchanges: next }) > TOOL_BYTES - 350) {
            const oversized = byteLength({ ...result, exchanges: [pairs[at]] }) > TOOL_BYTES - 350;
            result.truncated = true; result.next_offset = oversized ? (at + 1 < pairs.length ? at + 1 : null) : at;
            result.limitation = oversized
              ? 'A complete exchange exceeds this tool budget and was omitted without truncation. Ask the user to restate that context.'
              : 'The next complete exchange does not fit this page. Continue with next_offset; no message was truncated.';
            break;
          }
          result.exchanges = next; result.next_offset = at + 1 < pairs.length ? at + 1 : null;
        }
        if (result.next_offset !== null) result.truncated = true;
        return this.valid(result, []);
      } },
    };
  }
  async run(name: string, raw: unknown, signal: AbortSignal): Promise<ResearchPage> {
    checkAbort(signal);
    const definition = this.registry[name];
    if (!definition) throw new AppError('INVALID_TOOL', 'Research tool is not registered');
    const args = this.contracts.parse(definition.schema, raw);
    const canonical = (value: unknown): unknown => Array.isArray(value)
      ? (value.every(v => typeof v === 'string') ? [...value].sort() : value.map(canonical))
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
    const key = JSON.stringify([this.scopeRevision, name, canonical(args)]);
    let result = this.cache.get(key);
    if (result) this.cacheHits++;
    else { result = definition.read(args, signal); this.cache.set(key, result); }
    try { const page = await result; checkAbort(signal); return page; }
    catch (error) { this.cache.delete(key); throw error; }
  }
  private valid(result: Data, evidence: Data[]): ResearchPage {
    this.contracts.parse('AssistantToolResult', result, true);
    if (byteLength(result) > TOOL_BYTES) throw new AppError('TOOL_RESULT_TOO_LARGE', 'Essential record metadata exceeds the tool budget. Choose another record or narrower section.');
    return { result, evidence, reference: createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 24) };
  }
  page(kind: string, source: Data[], type: string, args: Data, preview = false, extra: Data = {}, externalOffset?: number): ResearchPage {
    const start = externalOffset === undefined ? Number(args.offset ?? 0) : 0;
    const wireOffset = externalOffset ?? start, count = Number(args.limit ?? 3);
    const result: Data = { kind, items: [], returned_count: 0, offset: wireOffset, next_offset: null, truncated: false, ...extra };
    const evidence: Data[] = [];
    for (const row of source.slice(start, start + count)) {
      const projected = projectRecord(row, type, preview, args);
      let candidate: Data = { ...result, items: [...records(result.items), projected], returned_count: evidence.length + 1 };
      // Page original article excerpts by Unicode characters, never fabricate a summary.
      while (byteLength(candidate) > TOOL_BYTES - 350 && type === 'article' && !preview && string(projected.excerpt).length) {
        const chars = [...string(projected.excerpt)]; projected.excerpt = chars.slice(0, Math.floor(chars.length / 2)).join('');
        projected.next_excerpt_offset = Number(projected.excerpt_offset ?? 0) + [...string(projected.excerpt)].length;
        projected.truncated_fields = [...new Set([...strings(projected.truncated_fields), 'excerpt'])];
        candidate = { ...candidate, items: [...records(result.items), projected] };
      }
      if (type === 'article' && !preview && Number(projected.excerpt_total_characters) > Number(projected.excerpt_offset) && projected.excerpt === '')
        throw new AppError('TOOL_RESULT_TOO_LARGE', 'Essential article metadata leaves no space for an excerpt. Choose another record.');
      if (byteLength(candidate) > TOOL_BYTES - 350) {
        if (!evidence.length) throw new AppError('TOOL_RESULT_TOO_LARGE', 'Essential record qualifiers or limitations cannot fit. Choose another record or narrower section.');
        result.truncated = true; break;
      }
      result.items = candidate.items; evidence.push(row); result.returned_count = evidence.length;
      if (strings(projected.truncated_fields).length) result.truncated = true;
    }
    const consumed = Number(result.returned_count);
    const more = start + consumed < source.length || (externalOffset !== undefined && consumed === count);
    result.next_offset = more && wireOffset + consumed <= 10000 ? wireOffset + consumed : null;
    if (more) result.truncated = true;
    if (externalOffset !== undefined && more) result.limitation = [result.limitation,
      'Continuation may return an empty page. Returned-page counts are not corpus totals.'].filter(Boolean).join(' ');
    // Discovery and source metadata cannot make an unseen fact citation-eligible.
    return this.valid(result, ['catalog', 'investigation', 'source'].includes(type) ? [] : evidence);
  }
  receipt(value: Data, pageCount?: number, limitation?: string): ResearchPage {
    return this.valid({ kind: 'receipt', items: [], returned_count: 0, truncated: false, receipt: value,
      ...(pageCount === undefined ? {} : { page_returned_count: pageCount }), ...(limitation ? { limitation } : {}) }, []);
  }
}
