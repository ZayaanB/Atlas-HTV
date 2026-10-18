import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AircraftState, FlightGlobalResponse } from '@atlas/contracts';
import { ApiFailure, type AtlasApi } from './api';
import { readContract } from './validation';
import { GLOBAL_POSITION_TTL, GLOBAL_STALE_AFTER, globalFlightGeometry } from './flight-observations';

const EMPTY_IDS: readonly string[] = [];
const EMPTY_ITEMS: FlightGlobalResponse['items'] = [];
const EMPTY_TRAILS: FlightGlobalResponse['trails'] = [];
const queryPolicy = { enabled: false, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: Infinity } as const;
export function globalFlightRetryTime(sample: FlightGlobalResponse, now: number): number {
  if (sample.pause_reason !== null && sample.retry_at === null) return Infinity;
  return Math.max(now + (sample.status === 'waiting' ? 5000 : 60_000), sample.retry_at ? Date.parse(sample.retry_at) : 0);
}
export function globalFlightErrorRetryTime(error: unknown, now: number): number {
  return error instanceof ApiFailure && error.retryable ? Math.max(now + 60_000, error.retryAt ?? 0) : Infinity;
}

/** One camera-independent scheduler. Records remain in Query; only selection is retained locally. */
export function useGlobalFlightOverlay(api: AtlasApi, { enabled, activeMode, selectedId }: {
  enabled: boolean; activeMode: boolean; selectedId: string | null;
}) {
  const client = useQueryClient();
  const key = useMemo(() => [api.mode, 'flight-global'] as const, [api.mode]);
  const snapshotKey = useMemo(() => [...key, 'snapshot'] as const, [key]);
  const currentQuery = useQuery<FlightGlobalResponse>({ queryKey: activeMode ? key : [api.mode, 'inactive-global-flights'], queryFn: skipToken, ...queryPolicy });
  const snapshotQuery = useQuery<FlightGlobalResponse>({ queryKey: activeMode ? snapshotKey : [api.mode, 'inactive-global-snapshot'], queryFn: skipToken, ...queryPolicy });
  const [visible, setVisible] = useState(() => !document.hidden);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<Error | null>(null);
  const [fetching, setFetching] = useState(false);
  const [manualRevision, setManualRevision] = useState(0);
  const manual = useRef(false), due = useRef(0), running = useRef(false);
  const [selected, setSelected] = useState<{ aircraft: AircraftState; attribution: string } | null>(null);
  // An actual workspace/provider-mode change releases its entire old cache and schedule.
  // A toggle only hides it: retry gates and pauses survive off/on cycles.
  useEffect(() => {
    due.current = 0; manual.current = false; setError(null); setSelected(null);
    return () => {
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
    };
  }, [client, key, activeMode]);
  useEffect(() => {
    setNow(Date.now());
    const visibility = () => { setVisible(!document.hidden); setNow(Date.now()); };
    document.addEventListener('visibilitychange', visibility);
    // Hidden tabs do no animation/age work; visibility restoration recomputes expiry synchronously.
    const timer = enabled && visible ? setInterval(() => setNow(Date.now()), 1000) : undefined;
    return () => { document.removeEventListener('visibilitychange', visibility); clearInterval(timer); };
  }, [enabled, visible]);
  useEffect(() => {
    if (!enabled || !visible || !activeMode || !api.flightGlobal) { setFetching(false); return; }
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!active) return;
      const next = manual.current ? 0 : due.current;
      if (!Number.isFinite(next)) return;
      if (next <= Date.now()) void run();
      else timer = setTimeout(schedule, Math.min(2_147_483_647, next - Date.now()));
    };
    const run = async () => {
      if (!active || document.hidden) return;
      manual.current = false; running.current = true; setFetching(true);
      try {
        const result = await client.fetchQuery({
          queryKey: key, staleTime: 0, retry: false, gcTime: Infinity,
          queryFn: async ({ signal }) => {
            const response = readContract('FlightGlobalResponse', await api.flightGlobal!(signal));
            if (!active || signal.aborted || document.hidden) throw new DOMException('Obsolete global flight response', 'AbortError');
            return response;
          },
        });
        if (!active || document.hidden) return;
        due.current = globalFlightRetryTime(result, Date.now());
        setError(null);
        if (result.status === 'ready') client.setQueryData(snapshotKey, result);
      } catch (failure) {
        if (!active) return;
        due.current = globalFlightErrorRetryTime(failure, Date.now());
        setError(failure instanceof Error ? failure : new Error('Global airline traffic is unavailable.'));
      } finally {
        if (active) { running.current = false; setFetching(false); setNow(Date.now()); schedule(); }
      }
    };
    schedule();
    return () => {
      active = false; running.current = false; clearTimeout(timer);
      void client.cancelQueries({ queryKey: key, exact: true });
    };
  }, [api, client, key, snapshotKey, enabled, visible, activeMode, manualRevision]);
  const checkAgain = useCallback(() => {
    if (!enabled || document.hidden || running.current || (Number.isFinite(due.current) && due.current > Date.now())) return;
    manual.current = true;
    setManualRevision(value => value + 1);
  }, [enabled]);

  const sample = enabled && activeMode ? snapshotQuery.data : undefined;
  const current = enabled && activeMode ? currentQuery.data : undefined;
  const items = sample?.items ?? EMPTY_ITEMS, observations = sample?.trails ?? EMPTY_TRAILS;
  const geometryCache = useRef<{
    items: typeof items; observations: typeof observations; geometry: ReturnType<typeof globalFlightGeometry>;
  } | null>(null);
  const geometry = useMemo(() => {
    const cached = geometryCache.current;
    if (cached?.items === items && cached.observations === observations && now < cached.geometry.nextChangeAt) return cached.geometry;
    const geometry = globalFlightGeometry(items, observations, now);
    geometryCache.current = { items, observations, geometry };
    return geometry;
  }, [items, observations, now]);
  useEffect(() => {
    if (!enabled || !visible || !Number.isFinite(geometry.nextChangeAt)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, geometry.nextChangeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [enabled, visible, geometry.nextChangeAt]);
  const latestById = useMemo(() => new Map(items.map(a => [a.id, a])), [items]);
  useEffect(() => {
    if (!enabled || !selectedId) { setSelected(null); return; }
    const aircraft = latestById.get(selectedId);
    setSelected(previous => aircraft ? { aircraft, attribution: sample?.attribution ?? 'AirLabs · Partial provider coverage' }
      : previous?.aircraft.id === selectedId ? previous : null);
  }, [enabled, selectedId, latestById, sample?.attribution]);
  const selectedAircraft = enabled && selected?.aircraft.id === selectedId ? selected.aircraft : null;
  const stale = !!sample && (sample.stale || !!sample.error || !!error || current?.status === 'unavailable' ||
    !sample.fetched_at || now - Date.parse(sample.fetched_at) > GLOBAL_STALE_AFTER);
  const paused = current?.pause_reason != null && current.retry_at === null;
  const status = paused ? `Flight updates paused: ${current.pause_reason}.`
    : error ? 'Global airline traffic unavailable. Cached observations may be stale.'
    : current?.status === 'waiting' ? 'Waiting for global airline traffic…'
    : current?.status === 'unavailable' ? 'Global airline traffic unavailable. Retrying…'
    : !sample ? 'Loading global airline traffic…'
    : stale ? 'Stale global snapshot'
    : geometry.aircraft.length === 0 ? 'No current aircraft received. Coverage is incomplete.'
    : `${geometry.aircraft.length.toLocaleString()} aircraft displayed`;
  return {
    ...geometry, coverage: null, lastKnownIds: EMPTY_IDS, now, stale, updatingArea: false,
    status, fetching, sample, current, error, oversized: false, paused, checkAgain,
    canCheckAgain: paused || (!!error && !Number.isFinite(due.current)),
    selected: selectedAircraft, selectedAttribution: selected?.attribution,
    selectedMissing: !!selectedAircraft && !latestById.has(selectedAircraft.id), selectedOutside: false,
    selectedExpired: !!selectedAircraft && now - Date.parse(selectedAircraft.observed_at) > GLOBAL_POSITION_TTL,
  };
}
