import { AppError, checkAbort } from '../runtime/errors.js';
import type { Repository } from '../data/queries.js';
import { Contracts, type Data, bounds, object, page, range, records, string, strings } from './validation.js';
import type { Embeddings } from './embeddings.js';
export function matchesNews(article: Data, query: Data): boolean {
  for (const key of ['location_ids', 'themes', 'entity_ids']) {
    const requested = strings(query[key]);
    if (requested.length && !requested.some(id => strings(article[key]).includes(id))) return false;
  }
  const published = string(article.published_at);
  if ((query.published_from || query.published_to) && !published) return false;
  if (query.published_from && Date.parse(published) < Date.parse(string(query.published_from))) return false;
  if (query.published_to && Date.parse(published) > Date.parse(string(query.published_to))) return false;
  const keyword = string(query.keyword).trim().toLocaleLowerCase('en');
  if (keyword && !`${string(article.title)} ${string(article.excerpt)}`.toLocaleLowerCase('en').includes(keyword)) return false;
  return true;
}
export class Retrieval {
  constructor(readonly contracts: Contracts, readonly repository: Repository, private embeddings?: Embeddings) {}
  async workspace(capabilities: Data, regions: Data[], signal?: AbortSignal): Promise<Data> {
    const [catalog] = await this.repository.read('workspace', {}, signal);
    if (!catalog) throw new AppError('DATA_UNAVAILABLE', 'Workspace catalog is unavailable', 503, true);
    return this.contracts.parse('WorkspaceResponse', {
      ...catalog, capabilities, flight_regions: regions
    }, true);
  }
  newsInput(raw: unknown): Data {
    const query = this.contracts.parse('NewsQuery', raw);
    range(query, 'published_from', 'published_to'); bounds(query.bounds); page(query);
    return query;
  }
  async news(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.newsInput(raw), pagination = page(query);
    let ranked: Data[] | undefined, searchMode = 'keyword';
    if (query.semantic_query && this.embeddings?.available) {
      try {
        const vector = await this.embeddings.embed(string(query.semantic_query), 'RETRIEVAL_QUERY', signal);
        ranked = await this.repository.read('semantic_news', { ...query, ...vector, ...pagination }, signal);
        searchMode = 'semantic';
      } catch { checkAbort(signal); searchMode = 'keyword_fallback'; }
    } else if (query.semantic_query) searchMode = 'keyword_fallback';
    // Keyword fallback uses the semantic query as the literal search term.
    const effective = searchMode === 'keyword_fallback' && !query.keyword ? { ...query, keyword: query.semantic_query } : query;
    const rows = ranked ?? await this.repository.read('news', { ...effective, ...pagination }, signal);
    const candidates = rows.map(row => this.contracts.parse('Article', row, true)).filter(row => matchesNews(row, effective));
    let items = candidates;
    if (query.bounds) {
      const [w,s,e,n] = bounds(query.bounds)! as [number,number,number,number];
      const requested = [...new Set(candidates.flatMap(a => strings(a.location_ids)))];
      const places: Data[] = [];
      // A news page can reference more than 100 places. Respect the shared ID/page
      // bounds without dropping places after the default 50-row location page.
      for (let start=0;start<requested.length;start+=100) {
        checkAbort(signal);
        places.push(...await this.locationItems({ids:requested.slice(start,start+100),limit:100,offset:0},signal));
      }
      const ids = new Set(places.filter(p => {
        const c = p.coordinates;
        // A broad location must be contained as a whole, not given false point precision.
        if (p.bounds) {
          const b = bounds(p.bounds)!;
          return b[0]! >= w && b[2]! <= e && b[1]! >= s && b[3]! <= n;
        }
        return Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && c[0] >= w && c[0] <= e && c[1] >= s && c[1] <= n;
      }).map(p => string(p.id)));
      items = candidates.filter(a => strings(a.location_ids).some(id => ids.has(id)));
    }
    checkAbort(signal);
    return this.contracts.parse('NewsResponse', {
      items: items.slice(0, pagination.limit), limit: pagination.limit, offset: pagination.offset,
      coverage: await this.coverage(signal), search_mode: searchMode
    }, true);
  }
  async locations(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const items = await this.locationItems(raw,signal);
    checkAbort(signal);
    return this.contracts.parse('LocationsResponse', { items, coverage: await this.coverage(signal) }, true);
  }
  private async locationItems(raw: unknown, signal?: AbortSignal): Promise<Data[]> {
    const query = this.contracts.parse('LocationsQuery', raw);
    const rows = await this.repository.read('locations', { ...query, ...page(query) }, signal);
    const ids = strings(query.ids), term = string(query.query).toLocaleLowerCase('en');
    return rows.map(r => this.contracts.parse('Location', r, true))
      .filter(r => (!ids.length || ids.includes(string(r.id))) && (!term || string(r.name).toLocaleLowerCase('en').includes(term)))
      .slice(0, page(query).limit);
  }
  async location(id: string, signal?: AbortSignal): Promise<Data> {
    const result = await this.locations({ ids: [id] }, signal);
    const location = records(result.items).find(p => p.id === id);
    if (!location) throw new AppError('NOT_FOUND', 'Location not found', 404);
    return location;
  }
  async investigation(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('InvestigationQuery', raw);
    const [result] = await this.repository.read('investigation', query, signal);
    if (!result) throw new AppError('NOT_FOUND', 'Investigation not found', 404);
    return this.contracts.parse('InvestigationResponse', result, true);
  }
  async observations(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('ObservationsQuery', raw);
    range(query, 'observed_from', 'observed_to'); page(query);
    const rows = await this.repository.read('observations', { ...query, ...page(query) }, signal);
    const items = rows.map(r => this.contracts.parse('Observation', r, true)).filter(r =>
      (!query.location_id || r.location_id === query.location_id) && (!query.metric || r.metric === query.metric) &&
      (!query.series_id || r.series_id === query.series_id) &&
      (!query.observed_from || Date.parse(string(r.observed_at)) >= Date.parse(string(query.observed_from))) &&
      (!query.observed_to || Date.parse(string(r.observed_at)) <= Date.parse(string(query.observed_to))))
      .sort((a,b) => Date.parse(string(a.observed_at))-Date.parse(string(b.observed_at))).slice(0,page(query).limit);
    return this.contracts.parse('ObservationsResponse', { items, coverage: await this.coverage(signal), aggregation: 'raw' }, true);
  }
  async compare(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('CompareObservationsArgs', raw);
    const result = await this.observations(query, signal), items = records(result.items);
    const first = items[0], last = items.at(-1);
    if (!first || !last || first.id === last.id) return { ...result, comparison: null, limitation: 'Two observations are required' };
    if (items.some(r => r.unit !== first.unit || r.metric !== first.metric || r.location_id !== first.location_id || r.source_id !== first.source_id || !Number.isFinite(r.value)))
      throw new AppError('INCOMPARABLE_OBSERVATIONS', 'Comparison requires one location, metric, source, unit, and numeric values');
    // Never describe a capped result as the entire requested range.
    return { ...result, comparison: { first_id: first.id, last_id: last.id, difference: Number(last.value)-Number(first.value), unit: first.unit }, limitation: 'Difference between returned endpoints; capped raw observations, no causal inference' };
  }
  async sources(ids: string[], signal?: AbortSignal): Promise<Data[]> {
    if (!ids.length) return [];
    return (await this.repository.read('sources', { ids: [...new Set(ids)].slice(0,100) }, signal))
      .map(r => this.contracts.parse('Source', r, true)).filter(r => ids.includes(string(r.id)));
  }
  async coverage(signal?: AbortSignal): Promise<Data> {
    const [freshness] = await this.repository.read('freshness', {}, signal);
    return { ...object(freshness ?? {}), mode: this.repository.mode, live: false };
  }
}
