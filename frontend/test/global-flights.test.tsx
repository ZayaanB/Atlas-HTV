import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FlightGlobalResponse } from '@atlas/contracts';
import { resolveFlightMode, useFlightOverlay } from '../src/lib/flights';
import { globalFlightRetryTime } from '../src/lib/global-flights';
import { ApiFailure, type AtlasApi } from '../src/lib/api';
import { createFixtureApi } from '../src/lib/fixture-api';
import { globalAircraft, globalSample, INITIAL_TIME, stamp, viewport } from './flight-samples';

const clients: QueryClient[] = [];
function visibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(INITIAL_TIME); visibility(false); });
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; vi.useRealTimers(); visibility(false); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function mount(flightGlobal = vi.fn<NonNullable<AtlasApi['flightGlobal']>>(async () => globalSample())) {
  const api = { ...createFixtureApi(), flightGlobal, flightArea: vi.fn(), flights: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, refetchOnWindowFocus: true, refetchOnReconnect: true } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const options = { enabled: true, mode: 'global' as 'global' | 'area', areaEnabled: false, viewport, region: null, selectedId: null as string | null };
  const hook = renderHook(props => useFlightOverlay(api, props), { wrapper, initialProps: options });
  return { ...hook, api, client, options, flightGlobal };
}

it('prefers global capability with both legacy flags false, and never falls back after failure', async () => {
  const workspace = await createFixtureApi().workspace!(new AbortController().signal);
  expect(resolveFlightMode({ ...workspace, capabilities: { ...workspace.capabilities, flights: false, flight_areas: false, flight_global: true } })).toBe('global');
  const h = mount(vi.fn().mockRejectedValue(new ApiFailure('Offline', 'NETWORK_ERROR', 0, true)));
  await advance(1); expect(h.api.flightGlobal).toHaveBeenCalledTimes(1);
  expect(h.api.flightArea).not.toHaveBeenCalled(); expect(h.api.flights).not.toHaveBeenCalled();
  expect(h.result.current.aircraft).toEqual([]);
});
it('fetches immediately, has one global query family, and ignores camera, focus and reconnect changes', async () => {
  const h = mount(); await advance(1);
  const markers = h.result.current.aircraft, trails = h.result.current.trails;
  h.rerender({ ...h.options, viewport: { center: [0,0], bounds: [-180,-90,180,90], zoom: 1 } });
  act(() => { focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
  await advance(59_998); expect(h.flightGlobal).toHaveBeenCalledTimes(1);
  expect(h.result.current.aircraft).toBe(markers); expect(h.result.current.trails).toBe(trails);
  expect(h.client.getQueryData(['fixture','flight-global'])).toEqual(globalSample());
  await advance(240_001); expect(h.flightGlobal).toHaveBeenCalledTimes(2);
});
it('applies waiting five-second and normal sixty-second floors, respects later retries and coalesces manual checks', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(globalSample([], { status: 'waiting', fetched_at: null, retry_at: stamp() }))
    .mockResolvedValue(globalSample([], { retry_at: null, pause_reason: 'quota' }));
  const h = mount(fetcher); await advance(4999); expect(fetcher).toHaveBeenCalledTimes(1);
  await advance(1); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(globalFlightRetryTime(globalSample([], { retry_at: stamp() }), INITIAL_TIME)).toBe(INITIAL_TIME + 60_000);
  expect(globalFlightRetryTime(globalSample([], { status: 'unavailable', retry_at: stamp() }), INITIAL_TIME)).toBe(INITIAL_TIME + 60_000);
  expect(globalFlightRetryTime(globalSample([], { retry_at: stamp(900_000) }), INITIAL_TIME)).toBe(INITIAL_TIME + 900_000);
  act(() => { h.result.current.checkAgain?.(); h.result.current.checkAgain?.(); });
  await advance(1); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('preserves HTTP backoff across visibility and toggles without implicit retries', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new ApiFailure('Busy', 'RATE_LIMIT', 429, true, null, INITIAL_TIME + 180_000)).mockResolvedValue(globalSample());
  const h = mount(fetcher); await advance(1);
  act(() => h.result.current.checkAgain?.()); await advance(1); expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => visibility(true)); await advance(30_000); act(() => visibility(false));
  h.rerender({ ...h.options, enabled: false }); await advance(1); h.rerender(h.options);
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
  await advance(149_996); expect(fetcher).toHaveBeenCalledTimes(1);
  await advance(2); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('pauses indefinitely; Check again performs one Atlas request and a repeated pause stays stopped', async () => {
  const fetcher = vi.fn().mockResolvedValue(globalSample([], { snapshot_id: null, fetched_at: null, status: 'unavailable', retry_at: null, pause_reason: 'quota', error: 'Paused' }));
  const h = mount(fetcher); await advance(1); expect(h.result.current.paused).toBe(true);
  await advance(3_600_000); expect(fetcher).toHaveBeenCalledTimes(1);
  h.rerender({ ...h.options, enabled: false }); h.rerender(h.options);
  act(() => visibility(true)); await advance(1000); act(() => visibility(false)); await advance(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => h.result.current.checkAgain?.()); await advance(1); expect(fetcher).toHaveBeenCalledTimes(2);
  await advance(3_600_000); expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['hidden','off','mode'] as const)('aborts %s requests and rejects responses from adapters that ignore the signal', async reason => {
  let resolve!: (value: FlightGlobalResponse) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<FlightGlobalResponse>(r => resolve = r)).mockResolvedValue(globalSample());
  const h = mount(fetcher); await advance(1);
  const signal = fetcher.mock.calls[0]![0] as AbortSignal;
  if (reason === 'hidden') act(() => visibility(true));
  else h.rerender({ ...h.options, ...(reason === 'off' ? { enabled: false } : { mode: 'area', areaEnabled: true }) });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(globalSample())); await advance(1);
  expect(h.result.current.aircraft).toEqual([]);
  expect(h.client.getQueryData(['fixture','flight-global','snapshot'])).toBeUndefined();
});
it('uses shared trails on first load, removes missing markers on the next snapshot and retains only selected details', async () => {
  const one = globalAircraft(), two = globalAircraft('def456');
  const points = [globalAircraft('abc123', -300_000), one].map(a => ({ coordinates: a.coordinates, observed_at: a.observed_at, callsign: a.callsign, flight_iata: a.flight_iata ?? null }));
  const fetcher = vi.fn().mockResolvedValueOnce(globalSample([one,two], { trails: [{ aircraft_id: one.id, points }], retry_at: stamp(60_000) }))
    .mockResolvedValue(globalSample([globalAircraft('def456',60_000)], { snapshot_id: `airlabs-${INITIAL_TIME+60_000}`, fetched_at: stamp(60_000) }));
  const h = mount(fetcher); await advance(1); expect(h.result.current.trails).toHaveLength(1);
  h.rerender({ ...h.options, selectedId: one.id }); await advance(1);
  expect(h.result.current.selected?.id).toBe(one.id);
  await advance(60_000);
  expect(h.result.current.aircraft.map(a => a.id)).toEqual([two.id]); expect(h.result.current.lastKnownIds).toEqual([]);
  expect(h.result.current.selected?.id).toBe(one.id); expect(h.result.current.selectedMissing).toBe(true);
  expect(h.result.current.coverage).toBeNull(); expect(h.result.current.trails).toEqual([]);
  h.rerender(h.options); expect(h.result.current.selected).toBeNull();
});
it('keeps successful data after an HTTP failure, becomes stale at six minutes and expires locally while paused', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(globalSample(undefined, { retry_at: stamp(60_000) }))
    .mockRejectedValueOnce(new ApiFailure('Offline', 'NETWORK_ERROR', 0, true))
    .mockResolvedValue(globalSample(undefined, { retry_at: null, pause_reason: 'authentication', error: 'Paused' }));
  const h = mount(fetcher); await advance(1); h.rerender({ ...h.options, selectedId: 'abc123' });
  await advance(60_000); expect(h.result.current.stale).toBe(true); expect(h.result.current.aircraft).toHaveLength(1);
  await advance(60_000); expect(h.result.current.paused).toBe(true);
  await advance(480_001); expect(h.result.current.aircraft).toEqual([]); expect(h.result.current.selectedExpired).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const age = mount(vi.fn().mockResolvedValue(globalSample(undefined, { retry_at: stamp(3_600_000) })));
  await advance(1); expect(age.result.current.stale).toBe(true);
});
it('recomputes marker expiry immediately on visibility restoration without spending a paused request', async () => {
  const h = mount(vi.fn().mockResolvedValue(globalSample(undefined, { retry_at: null, pause_reason: 'quota' })));
  await advance(1); act(() => visibility(true)); await advance(601_000);
  act(() => visibility(false)); expect(h.result.current.aircraft).toEqual([]); expect(h.flightGlobal).toHaveBeenCalledTimes(1);
});
it('expires an off-layer cached snapshot immediately when re-enabled without resetting its pause', async () => {
  const h=mount(vi.fn().mockResolvedValue(globalSample(undefined,{retry_at:null,pause_reason:'quota'})));
  await advance(1);h.rerender({...h.options,enabled:false});await advance(601_000);
  h.rerender(h.options);expect(h.result.current.aircraft).toEqual([]);expect(h.flightGlobal).toHaveBeenCalledTimes(1);
});
it('marks a quiet snapshot stale only after six minutes and clears all previous-mode data on capability change', async () => {
  const h = mount(vi.fn().mockResolvedValue(globalSample(undefined, { retry_at: stamp(3_600_000) })));
  await advance(360_000); expect(h.result.current.stale).toBe(false);
  await advance(1000); expect(h.result.current.stale).toBe(true);
  h.rerender({ ...h.options, mode: 'area', areaEnabled: true, enabled: false }); await advance(1);
  expect(h.client.getQueriesData({ queryKey: ['fixture','flight-global'] })).toEqual([]);
  expect(h.result.current.selected).toBeNull(); expect(h.result.current.aircraft).toEqual([]);
});
