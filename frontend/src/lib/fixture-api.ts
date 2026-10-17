import examples from '@atlas/contracts/examples/helene-api.json';
import type { Article, Location, NewsQuery } from '@atlas/contracts';
import type { AtlasApi } from './api';
import { normalizeNewsQuery } from './api';
import { readContract } from './validation';

const news = readContract('NewsResponse', examples.news);
const locations = readContract('LocationsResponse', examples.locations);
function within(location: Location, bounds: NonNullable<NewsQuery['bounds']>): boolean {
  const [w, s, e, n] = bounds;
  if (location.bounds) {
    const [lw, ls, le, ln] = location.bounds;
    return lw >= w && ls >= s && le <= e && ln <= n;
  }
  return !!location.coordinates && location.coordinates[0] >= w && location.coordinates[0] <= e && location.coordinates[1] >= s && location.coordinates[1] <= n;
}
function matches(article: Article, query: NewsQuery): boolean {
  for (const key of ['location_ids', 'themes', 'entity_ids'] as const) {
    if (query[key]?.length && !query[key].some(id => article[key].includes(id))) return false;
  }
  const keyword = (query.keyword || query.semantic_query || '').trim().toLocaleLowerCase('en');
  if (keyword && !`${article.title} ${article.excerpt}`.toLocaleLowerCase('en').includes(keyword)) return false;
  if ((query.published_from || query.published_to) && !article.published_at) return false;
  if (query.published_from && Date.parse(article.published_at!) < Date.parse(query.published_from)) return false;
  if (query.published_to && Date.parse(article.published_at!) > Date.parse(query.published_to)) return false;
  if (query.bounds && !locations.items.some(l => article.location_ids.includes(l.id) && within(l, query.bounds!))) return false;
  return true;
}
export function createFixtureApi(): AtlasApi {
  return {
    mode: 'fixture',
    async news(raw, signal) {
      signal.throwIfAborted();
      const query = normalizeNewsQuery(raw), offset = query.offset!, limit = query.limit!;
      return readContract('NewsResponse', {
        ...news, items: news.items.filter(a => matches(a, query)).slice(offset, offset + limit), offset, limit,
        search_mode: query.semantic_query ? 'keyword_fallback' : 'keyword'
      });
    },
    async locations(query, signal) {
      signal.throwIfAborted();
      readContract('LocationsQuery', query);
      const offset = query.offset ?? 0, limit = query.limit ?? 50;
      return readContract('LocationsResponse', {
        ...locations, items: locations.items.filter(l => (!query.ids?.length || query.ids.includes(l.id)) &&
          (!query.query || l.name.toLocaleLowerCase('en').includes(query.query.toLocaleLowerCase('en')))).slice(offset, offset + limit)
      });
    }
  };
}
