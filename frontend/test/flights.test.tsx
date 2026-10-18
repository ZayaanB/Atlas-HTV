import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FlightAreaResponse } from '@atlas/contracts';
import { useFlightOverlay, flightRetryTime } from '../src/lib/flights';
import { ApiFailure, type AtlasApi } from '../src/lib/api';
import { createFixtureApi } from '../src/lib/fixture-api';
import { aircraft, INITIAL_TIME, sample, stamp, viewport } from './flight-samples';

const clients: QueryClient[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(INITIAL_TIME); visibility(false); });
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; vi.useRealTimers(); visibility(false); });
function visibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function mount(flightArea = vi.fn<NonNullable<AtlasApi['flightArea']>>(async () => sample())) {
  const api = { ...createFixtureApi(), flightArea }, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options = { enabled: true, areaEnabled: true, viewport, region: null, selectedId: null as string | null };
  const hook = renderHook(props => useFlightOverlay(api, props), { wrapper, initialProps: options });
  return { ...hook, flightArea, client, options };
}
it('debounces all camera moves, deduplicates canonical areas, and polls no sooner than 60 seconds', async () => {
  const h = mount();
  await advance(299); expect(h.flightArea).not.toHaveBeenCalled();
  await advance(2); expect(h.flightArea).toHaveBeenCalledTimes(1);
  expect(h.flightArea.mock.calls[0]?.[0]).toEqual({ latitude: 43.7, longitude: -79.4, radius_nm: 10 });
  h.rerender({ ...h.options, viewport: { ...viewport, userInitiated: false, center: [-79.401, 43.701] } });
  await advance(1000); expect(h.flightArea).toHaveBeenCalledTimes(1);
  h.rerender({ ...h.options, viewport: { ...viewport, userInitiated: false, center: [-79.2, 43.7] } });
  expect(h.result.current.updatingArea).toBe(true);
  await advance(301); expect(h.flightArea).toHaveBeenCalledTimes(2);
  await advance(59_999); expect(h.flightArea).toHaveBeenCalledTimes(2);
  await advance(2); expect(h.flightArea).toHaveBeenCalledTimes(3);
});
it('stops hidden requests, refreshes on return only when due, and clears query data/history when off', async () => {
  const h = mount(); await advance(301);
  act(() => visibility(true)); await advance(30_000);
  act(() => visibility(false)); await advance(1); expect(h.flightArea).toHaveBeenCalledTimes(1);
  act(() => visibility(true)); await advance(360_000);
  expect(h.result.current.aircraft).toHaveLength(0);
  act(() => visibility(false)); await advance(1); expect(h.flightArea).toHaveBeenCalledTimes(2);
  h.rerender({ ...h.options, enabled: false }); await advance(1);
  expect(h.result.current.coverage).toBeNull(); expect(h.result.current.aircraft).toEqual([]);
  expect(h.client.getQueriesData({ queryKey: ['fixture', 'flight-area'] })).toEqual([]);
  await advance(360_000); expect(h.flightArea).toHaveBeenCalledTimes(2);
});
it('aborts and rejects late obsolete results even if the adapter ignores cancellation', async () => {
  let resolve!: (sample: FlightAreaResponse) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<FlightAreaResponse>(r => resolve = r)).mockResolvedValue(sample([aircraft('def456')]));
  const h = mount(fetch); await advance(301);
  const signal = fetch.mock.calls[0]![1] as AbortSignal;
  h.rerender({ ...h.options, viewport: { ...viewport, center: [-79.2, 43.7] } });
  expect(signal.aborted).toBe(true);
  await advance(301); expect(h.result.current.aircraft[0]?.id).toBe('def456');
  await act(async () => resolve(sample()));
  expect(h.result.current.aircraft[0]?.id).toBe('def456');
});
it('retains the original sample and circle until the new area is ready', async () => {
  const second = { id: 'second-area', latitude: 44, longitude: -79.4, radius_nm: 100 };
  const fetch = vi.fn().mockResolvedValueOnce(sample()).mockResolvedValueOnce(sample([], { area: second, status: 'waiting', fetched_at: null, retry_at: stamp(2000) }))
    .mockResolvedValue(sample([], { area: second, fetched_at: stamp(2000), retry_at: stamp(62_000) }));
  const h = mount(fetch); await advance(301);
  h.rerender({ ...h.options, viewport: { ...viewport, center: [-79.4, 44] } }); await advance(301);
  expect(h.result.current.updatingArea).toBe(true); expect(h.result.current.coverage?.id).toBe('area-43.7--79.4-10');
  expect(h.result.current.aircraft).toHaveLength(1);
  await advance(1400);
  expect(h.result.current.coverage?.id).toBe('second-area'); expect(h.result.current.updatingArea).toBe(false);
});
it('honors capacity backoff through pans, visibility and off/on toggles', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new ApiFailure('Busy', 'FLIGHT_REGION_CAPACITY', 429, true, null, INITIAL_TIME + 120_000)).mockResolvedValue(sample());
  const h = mount(fetch); await advance(301); expect(h.result.current.status).toBe('Flight coverage is busy. Retrying…');
  h.rerender({ ...h.options, viewport: { ...viewport, center: [-79.2, 43.7] } }); await advance(301);
  act(() => { visibility(true); visibility(false); window.dispatchEvent(new Event('focus')); });
  h.rerender({ ...h.options, enabled: false }); await advance(1);
  h.rerender(h.options); await advance(100_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await advance(20_000); expect(fetch).toHaveBeenCalledTimes(2);
});
it('retries errors without timing after 60 seconds and handles waiting/unavailable floors', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new ApiFailure('Offline', 'NETWORK_ERROR', 0, true)).mockResolvedValue(sample());
  const h = mount(fetch); await advance(301); await advance(59_999); expect(fetch).toHaveBeenCalledTimes(1);
  await advance(2); expect(fetch).toHaveBeenCalledTimes(2);
  for (const status of ['waiting', 'unavailable'] as const) {
    expect(flightRetryTime(sample([], { status, fetched_at: null, retry_at: stamp() }), INITIAL_TIME)).toBe(INITIAL_TIME + 1000);
  }
  expect(flightRetryTime(sample([], { retry_at: stamp(90_000) }), INITIAL_TIME)).toBe(INITIAL_TIME + 90_000);
});
it('shows the returned circle for initial waiting/unavailable samples without claiming a successful sample', async () => {
  for (const status of ['waiting', 'unavailable'] as const) {
    const h = mount(vi.fn().mockResolvedValue(sample([], { status, fetched_at: null, stale: true })));
    await advance(301);
    expect(h.result.current.coverage).toEqual(sample().area);
    expect(h.result.current.sample).toBeUndefined(); expect(h.result.current.aircraft).toEqual([]);
    expect(h.result.current.status).toContain(status === 'waiting' ? 'Waiting' : 'unavailable');
    h.unmount();
  }
});
it('retains missing selection outside coverage and after position expiry, then releases it on panel exit', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(sample()).mockResolvedValue(sample([], { area: { id: 'away', latitude: 0, longitude: 0, radius_nm: 10 } }));
  const h = mount(fetch); await advance(301); h.rerender({ ...h.options, selectedId: 'abc123' });
  await advance(1); expect(h.result.current.selected?.id).toBe('abc123');
  await advance(60_000); expect(h.result.current.selectedMissing).toBe(true); expect(h.result.current.selectedOutside).toBe(true);
  await advance(300_000); expect(h.result.current.selectedExpired).toBe(true); expect(h.result.current.aircraft).toHaveLength(0);
  expect(h.result.current.selected?.id).toBe('abc123');
  h.rerender(h.options); expect(h.result.current.selected).toBeNull();
});
