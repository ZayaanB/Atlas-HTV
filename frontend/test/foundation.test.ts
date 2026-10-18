import { describe, expect, it, vi } from 'vitest';
import examples from '@atlas/contracts/examples/helene-api.json';
import { ApiFailure, createHttpApi, isSearchableBounds, normalizeNewsQuery, serializeQuery } from '../src/lib/api';
import { createFixtureApi } from '../src/lib/fixture-api';
import { readContract } from '../src/lib/validation';
import { articleLocationIds, createQueryClient, locationOptions, newsOptions } from '../src/lib/queries';
import { createWorkspaceStore } from '../src/app/state';

const signal = () => new AbortController().signal;
const locations = readContract('LocationsResponse', examples.locations).items;
describe('HTTP and shared contracts', () => {
  it('normalizes equivalent filters and serializes arrays/numbers in backend wire format', () => {
    const a = normalizeNewsQuery({ location_ids: ['loc-b', 'loc-a', 'loc-a'], keyword: ' flood ', themes: [] });
    const b = normalizeNewsQuery({ keyword: 'flood', location_ids: ['loc-a', 'loc-b'] });
    expect(a).toEqual(b);
    expect(new URLSearchParams(serializeQuery({ ...a, bounds: [-83, 35, -82, 36] })).get('bounds')).toBe('-83,35,-82,36');
    expect(serializeQuery(a)).toContain('location_ids=loc-a%2Cloc-b');
    const categories = normalizeNewsQuery({event_types:['flood','earthquake','flood'],topics:['science','health'],has_location:false});
    expect(categories.event_types).toEqual(['earthquake','flood']);
    expect(new URLSearchParams(serializeQuery(categories)).get('has_location')).toBe('false');
    expect(normalizeNewsQuery({event_types:[],topics:[]})).toEqual({limit:50,offset:0});
    expect(() => normalizeNewsQuery({ bounds: [170, -10, -170, 10] })).toThrow();
  });
  it('passes cancellation to fetch and validates incoming payloads', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(examples.news)));
    const api = createHttpApi(fetcher);
    expect((await api.news({}, controller.signal)).items).toHaveLength(10);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ...examples.news, items: [{ invalid: true }] })));
    await expect(api.news({}, signal())).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });
  it('preserves structured HTTP errors and never substitutes fixtures', async () => {
    const api = createHttpApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'CONTRACTS_UNAVAILABLE', message: 'Shared schema is missing', retryable: true, request_id: 'req-42'
    } }), { status: 503 })));
    await expect(api.news({}, signal())).rejects.toMatchObject({ code: 'CONTRACTS_UNAVAILABLE', requestId: 'req-42', status: 503 });
    expect(api.mode).toBe('api');
  });
  it('cancels obsolete requests through the Query signal', async () => {
    let requestSignal: AbortSignal | null = null;
    const api = createHttpApi(vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      requestSignal = init!.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => requestSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }));
    const client = createQueryClient();
    const request = client.fetchQuery(newsOptions(api, { keyword: 'flood' }));
    const rejected = expect(request).rejects.toBeDefined();
    await client.cancelQueries({ queryKey: ['api', 'news'] });
    await rejected;
    expect(requestSignal!.aborted).toBe(true);
    client.clear();
  });
});
describe('fixtures and queries', () => {
  it('filters shared historical records and respects paging, bounds, and date uncertainty', async () => {
    const api = createFixtureApi();
    const page = await api.news({ limit: 2, offset: 2 }, signal());
    expect(page.items.map(a => a.id)).toEqual(examples.news.items.slice(2, 4).map(a => a.id));
    expect(page.coverage.mode).toBe('fixture');
    const filtered = await api.news({ keyword: 'zz-no-match' }, signal());
    expect(filtered.items).toEqual([]);
    expect((await api.news({ published_from: '2024-01-01T00:00:00Z' }, signal())).items.every(a => a.published_at !== null)).toBe(true);
    expect((await api.news({ bounds: [0, 0, 1, 1] }, signal())).items).toEqual([]);
    await expect(api.news({}, AbortSignal.abort())).rejects.toBeDefined();
  });
  it('deduplicates location IDs, batches filters, and resolves batches without querying empty IDs', async () => {
    const api = createFixtureApi();
    const spy = vi.spyOn(api, 'locations');
    const client = createQueryClient();
    expect(await client.fetchQuery(locationOptions(api, []))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    const ids = articleLocationIds(readContract('NewsResponse', examples.news).items);
    const result = await client.fetchQuery(locationOptions(api, ids));
    expect(result.map(l => l.id).sort()).toEqual(ids);
    spy.mockClear();
    await client.fetchQuery(locationOptions(api, Array.from({ length: 201 }, (_, i) => `loc-${i}`)));
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.every(([query]) => query.ids!.length <= 100)).toBe(true);
    client.clear();
  });
  it('retries transient GET failures once and does not retry invalid responses', async () => {
    const client = createQueryClient();
    const api = createFixtureApi();
    const spy = vi.spyOn(api, 'news').mockRejectedValue(new ApiFailure('Invalid response', 'INVALID_RESPONSE', 502, false));
    await expect(client.fetchQuery(newsOptions(api, {}))).rejects.toThrow('Invalid response');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRejectedValueOnce(new ApiFailure('Offline', 'NETWORK_ERROR', 0, true)).mockResolvedValue(readContract('NewsResponse', examples.news));
    await expect(client.fetchQuery({ ...newsOptions(api, {}), retryDelay: 0 })).resolves.toHaveProperty('items');
    expect(spy).toHaveBeenCalledTimes(3);
    client.clear();
  });
});
describe('workspace transitions', () => {
  it('applies viewport bounds only on explicit search and preserves filters on return to globe', () => {
    const store = createWorkspaceStore();
    store.getState().applyFilters({ keyword: 'flood' });
    store.getState().setPage(50);
    store.getState().setViewport({ bounds: [-83, 35, -82, 36], center: [-82.5, 35.5], zoom: 8 });
    expect(store.getState().filters).not.toHaveProperty('bounds');
    store.getState().searchArea();
    expect(store.getState().filters).toMatchObject({ keyword: 'flood', offset: 0, bounds: [-83, 35, -82, 36] });
    const filters = store.getState().filters;
    store.getState().requestCamera({ type: 'return_to_globe' });
    expect(store.getState().filters).toBe(filters);
    expect(isSearchableBounds([170, -10, -170, 10])).toBe(false);
  });
  it('fits broad extents and prevents an old acknowledgement from clearing a newer command', () => {
    const store = createWorkspaceStore();
    store.getState().focusLocation(locations.find(l => l.precision === 'city')!);
    expect(store.getState().cameraCommand?.type).toBe('fit_bounds');
    const oldId = store.getState().cameraCommand!.id;
    store.getState().requestCamera({ type: 'return_to_globe' });
    const newId = store.getState().cameraCommand!.id;
    store.getState().acknowledgeCamera(oldId);
    expect(store.getState().cameraCommand!.id).toBe(newId);
    store.getState().acknowledgeCamera(newId);
    expect(store.getState().cameraCommand).toBeNull();
    store.getState().select({ articleId: 'article-a', locationId: 'loc-a' });
    store.getState().selectAircraft('abc123');
    expect(store.getState().selection.articleId).toBe('article-a');
    store.getState().requestCamera({ type: 'return_to_globe' });
    store.getState().applyFilters({ keyword: 'new context' });
    expect(store.getState().cameraCommand).toBeNull();
  });
});
