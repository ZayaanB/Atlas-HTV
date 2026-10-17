import type { LocationsQuery, LocationsResponse, NewsQuery, NewsResponse } from '@atlas/contracts';
import { readContract } from './validation';

export type DataMode = 'api' | 'fixture';
export interface AtlasApi {
  readonly mode: DataMode;
  news: (query: NewsQuery, signal: AbortSignal) => Promise<NewsResponse>;
  locations: (query: LocationsQuery, signal: AbortSignal) => Promise<LocationsResponse>;
}
export class ApiFailure extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly retryable: boolean, readonly requestId: string | null = null) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/** Canonical arrays make equivalent filters share a cache key and wire format. */
export function normalizeNewsQuery(query: NewsQuery): NewsQuery {
  const normalized = { ...query, limit: query.limit ?? 50, offset: query.offset ?? 0 };
  for (const key of ['location_ids', 'themes', 'entity_ids'] as const) {
    if (normalized[key]?.length) normalized[key] = [...new Set(normalized[key])].sort();
    else delete normalized[key];
  }
  if (normalized.keyword?.trim()) normalized.keyword = normalized.keyword.trim();
  else delete normalized.keyword;
  readContract('NewsQuery', normalized);
  if (normalized.bounds && !isSearchableBounds(normalized.bounds)) throw new Error('Search bounds must be ordered and within geographic ranges');
  const from = normalized.published_from, to = normalized.published_to;
  if (from && to && (Date.parse(to) < Date.parse(from) || Date.parse(to) - Date.parse(from) > 366 * 86400000)) {
    throw new Error('Publication range must be ordered and no longer than 366 days');
  }
  return normalized;
}
export function isSearchableBounds(bounds: readonly number[]): boolean {
  const [w, s, e, n] = bounds;
  return bounds.length === 4 && bounds.every(Number.isFinite) && w! >= -180 && e! <= 180 && w! <= e! && s! >= -90 && n! <= 90 && s! <= n!;
}
export function serializeQuery(query: NewsQuery | LocationsQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
    if (value !== undefined) search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return search.toString();
}
export function createHttpApi(fetcher: typeof fetch = globalThis.fetch): AtlasApi {
  async function get(path: string, query: NewsQuery | LocationsQuery, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(`/api/${path}?${serializeQuery(query)}`, { signal, headers: { Accept: 'application/json' } }); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new ApiFailure('Cannot reach the Atlas API. Check the backend connection.', 'NETWORK_ERROR', 0, true);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch {
      if (signal.aborted) throw signal.reason;
      throw new ApiFailure('The API returned an unreadable response.', 'INVALID_RESPONSE', response.status, false);
    }
    if (!response.ok) {
      try {
        const { error } = readContract('ApiError', body);
        throw new ApiFailure(error.message, error.code, response.status, error.retryable, error.request_id);
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(`API request failed (${response.status}).`, 'HTTP_ERROR', response.status, response.status === 429 || response.status >= 500);
      }
    }
    return body;
  }
  async function validated<Name extends 'NewsResponse' | 'LocationsResponse'>(name: Name, body: Promise<unknown>) {
    const data = await body;
    try { return readContract(name, data); }
    catch { throw new ApiFailure('The API response does not match the shared contract.', 'INVALID_RESPONSE', 502, false); }
  }
  return {
    mode: 'api',
    news: (query, signal) => validated('NewsResponse', get('news', normalizeNewsQuery(query), signal)),
    locations: (query, signal) => validated('LocationsResponse', get('locations', readContract('LocationsQuery', query), signal))
  };
}
