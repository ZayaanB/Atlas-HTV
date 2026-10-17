import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import type { Article, Location, NewsQuery } from '@atlas/contracts';
import type { AtlasApi } from './api';
import { ApiFailure, normalizeNewsQuery } from './api';

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: {
    staleTime: 30_000, refetchOnWindowFocus: false,
    retry: (count, error) => count < 1 && error instanceof ApiFailure && error.retryable &&
      (error.status === 0 || error.status === 429 || error.status >= 500),
    retryDelay: 1000
  } } });
}
export const newsOptions = (api: AtlasApi, filters: NewsQuery) => {
  const query = normalizeNewsQuery(filters);
  return queryOptions({ queryKey: [api.mode, 'news', query], queryFn: ({ signal }) => api.news(query, signal) });
};
export function articleLocationIds(articles: readonly Article[]): string[] {
  return [...new Set(articles.flatMap(article => article.location_ids))].sort();
}
export const locationOptions = (api: AtlasApi, ids: string[]) => {
  const normalized = [...new Set(ids)].sort();
  return queryOptions({
    queryKey: [api.mode, 'locations', normalized], enabled: normalized.length > 0,
    queryFn: async ({ signal }) => {
      if (!normalized.length) return [];
      const resolved: Location[] = [];
      // Batch ID filters and page each batch: a short page is not a complete-data claim.
      for (let start = 0; start < normalized.length; start += 100) {
        const batch = normalized.slice(start, start + 100);
        for (let offset = 0; offset <= 10000; offset += 100) {
          const page = await api.locations({ ids: batch, limit: 100, offset }, signal);
          resolved.push(...page.items);
          if (batch.every(id => resolved.some(location => location.id === id)) || page.items.length === 0) break;
        }
      }
      const requested = new Set(normalized);
      return [...new Map(resolved.filter(l => requested.has(l.id)).map(l => [l.id, l])).values()];
    }
  });
};
export const placeSearchOptions = (api: AtlasApi, query: string) => queryOptions({
  queryKey: [api.mode, 'place-search', query], enabled: query.trim().length > 0,
  queryFn: ({ signal }) => api.locations({ query: query.trim(), limit: 20, offset: 0 }, signal)
});
export function useWorkspaceData(api: AtlasApi, filters: NewsQuery) {
  const news = useQuery(newsOptions(api, filters));
  const ids = articleLocationIds(news.data?.items ?? []);
  const locations = useQuery(locationOptions(api, ids));
  const missingLocationIds = locations.isSuccess ? ids.filter(id => !locations.data.some(l => l.id === id)) : [];
  return { news, locations, missingLocationIds };
}
