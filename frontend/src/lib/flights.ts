import { useEffect, useMemo, useRef, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AircraftState, FlightAreaResponse, FlightRegion, FlightsResponse, WorkspaceResponse } from '@atlas/contracts';
import type { FlightMode, ViewportSnapshot } from '../app/map-interface';
import { ApiFailure, type AtlasApi } from './api';
import { readContract } from './validation';
import { canonicalFlightArea, FlightHistory, POSITION_TTL, viewportFlightArea, withinFlightArea } from './flight-observations';
import { useGlobalFlightOverlay } from './global-flights';

type Sample = FlightAreaResponse | FlightsResponse;
type SampleKey = readonly [string, string, string];
interface Options {
  enabled: boolean;
  areaEnabled: boolean;
  mode?: FlightMode | null;
  viewport: ViewportSnapshot | null;
  region: FlightRegion | null;
  selectedId: string | null;
}
export function flightRetryTime(sample: Sample, now: number): number {
  return Math.max(now + ('status' in sample && sample.status !== 'ready' ? 1000 : 60_000), Date.parse(sample.retry_at));
}
export function flightErrorRetryTime(error: unknown, now: number): number {
  return error instanceof ApiFailure && error.retryable ? Math.max(now + 1000, error.retryAt ?? now + 60_000) : Infinity;
}

/** Explicit scheduler prevents viewport/focus changes from bypassing the shared provider gate. */
export function resolveFlightMode(workspace?: WorkspaceResponse): FlightMode | null {
  if (workspace?.capabilities.flight_global === true) return 'global';
  if (workspace?.capabilities.flight_areas === true) return 'area';
  if (workspace?.capabilities.flight_areas === undefined && workspace?.capabilities.flights && workspace.flight_regions.length) return 'region';
  return null;
}
export function useFlightOverlay(api: AtlasApi, options: Options) {
  const mode = options.mode === undefined ? (options.areaEnabled ? 'area' : 'region') : options.mode;
  const global = useGlobalFlightOverlay(api, { enabled: options.enabled && mode === 'global', activeMode: mode === 'global', selectedId: options.selectedId });
  const regional = useRegionalFlightOverlay(api, { ...options, enabled: options.enabled && mode !== 'global' });
  return mode === 'global' ? { ...global, mode } : { ...regional, mode, paused: false, canCheckAgain: false, checkAgain: undefined };
}
function useRegionalFlightOverlay(api: AtlasApi, options: Options) {
  const { enabled, areaEnabled, viewport, region, selectedId } = options;
  const client = useQueryClient();
  const [visible, setVisible] = useState(() => !document.hidden);
  const [now, setNow] = useState(Date.now);
  const [settled, setSettled] = useState<string | null>(null);
  const [sampleKey, setSampleKey] = useState<SampleKey | null>(null);
  // Keep the displayed success observed in Query even during a long area/backoff change.
  const savedSample = useQuery<Sample>({ queryKey: sampleKey ?? [api.mode, 'inactive-flight-sample'], queryFn: skipToken, enabled: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [error, setError] = useState<Error | null>(null);
  const [fetching, setFetching] = useState(false);
  const [version, setVersion] = useState(0);
  const history = useRef(new FlightHistory());
  const due = useRef(new Map<string, number>());
  const blockedUntil = useRef(0);
  const [selected, setSelected] = useState<{ aircraft: AircraftState; attribution: string } | null>(null);
  useEffect(() => {
    history.current.records.clear(); due.current.clear(); blockedUntil.current = 0;
    setSampleKey(null); setSelected(null); setError(null); setFetching(false);
    return () => {
      for (const name of ['flight-area', 'flights']) {
        void client.cancelQueries({ queryKey: [api.mode, name] });
        client.removeQueries({ queryKey: [api.mode, name] });
      }
    };
  }, [api.mode, options.mode, client]);
  const viewportArea = viewport ? viewportFlightArea(viewport) : null;
  const desired = areaEnabled && viewportArea ? JSON.stringify(canonicalFlightArea(viewportArea.query)) : null;
  const regionKey = region?.id ?? '';
  const target = areaEnabled ? settled : regionKey || null;
  const family = areaEnabled ? 'flight-area' : 'flights';
  // Snapshots include programmatic moves. Equivalent canonical areas keep their timer/cache.
  useEffect(() => {
    if (!enabled || !areaEnabled) { setSettled(null); return; }
    const timer = setTimeout(() => setSettled(desired), 300);
    return () => clearTimeout(timer);
  }, [enabled, areaEnabled, desired]);
  useEffect(() => {
    const visibility = () => { setVisible(!document.hidden); setNow(Date.now()); };
    document.addEventListener('visibilitychange', visibility);
    const timer = enabled ? setInterval(() => setNow(Date.now()), 1000) : undefined;
    return () => { document.removeEventListener('visibilitychange', visibility); clearInterval(timer); };
  }, [enabled]);
  useEffect(() => {
    if (enabled) return;
    history.current.records.clear(); due.current.clear();
    // HTTP/server backoff survives off/on toggles in this workspace session.
    setSampleKey(null); setSelected(null); setError(null); setFetching(false);
    for (const name of ['flight-area', 'flights']) {
      void client.cancelQueries({ queryKey: [api.mode, name] });
      client.removeQueries({ queryKey: [api.mode, name] });
    }
  }, [enabled, client, api.mode]);
  useEffect(() => {
    if (!enabled || !visible || !target || (areaEnabled ? !api.flightArea : !api.flights)) return;
    if (areaEnabled && target !== desired) return;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    const key = [api.mode, family, target] as const;
    const id = `${family}:${target}`;
    const schedule = () => {
      const next = Math.max(due.current.get(id) ?? 0, blockedUntil.current);
      if (!Number.isFinite(next)) return;
      if (next <= Date.now()) void run();
      else timer = setTimeout(schedule, Math.min(2_147_483_647, next - Date.now()));
    };
    const run = async () => {
      if (!active || document.hidden) return;
      setFetching(true);
      try {
        const sample = await client.fetchQuery({
          queryKey: key, staleTime: 0, retry: false, gcTime: 30 * 60_000,
          queryFn: async ({ signal }) => {
            const result = areaEnabled
              ? readContract('FlightAreaResponse', await api.flightArea!(JSON.parse(target), signal))
              : readContract('FlightsResponse', await api.flights!(target, signal));
            if (signal.aborted || !active) throw new DOMException('Obsolete flight sample', 'AbortError');
            return result;
          },
        });
        if (!active || document.hidden) return;
        due.current.set(id, flightRetryTime(sample, Date.now()));
        if (sample.error || ('status' in sample && sample.status !== 'ready'))
          blockedUntil.current = Math.max(blockedUntil.current, Date.parse(sample.retry_at));
        setError(null);
        if (!('status' in sample) || sample.status === 'ready') {
          history.current.ingest(sample.items, Date.now());
          setSampleKey(key);
        }
        setVersion(value => value + 1);
      } catch (failure) {
        if (!active) return;
        const next = flightErrorRetryTime(failure, Date.now());
        due.current.set(id, next);
        if (Number.isFinite(next)) blockedUntil.current = Math.max(blockedUntil.current, next);
        setError(failure instanceof Error ? failure : new Error('Aircraft unavailable.'));
      } finally {
        if (active) { setFetching(false); setNow(Date.now()); schedule(); }
      }
    };
    schedule();
    return () => {
      active = false; clearTimeout(timer);
      void client.cancelQueries({ queryKey: key, exact: true });
    };
  }, [api, client, enabled, visible, areaEnabled, target, desired, family]);

  const current = enabled && target ? client.getQueryData<Sample>([api.mode, family, target]) : undefined;
  const sample = enabled && sampleKey?.[0] === api.mode && sampleKey[1] === family ? savedSample.data : undefined;
  const coverage = sample && 'area' in sample ? sample.area : sample ? region
    : current && 'area' in current ? current.area : null;
  const legacyCoverage = useRef<FlightRegion | null>(null);
  if (sample && !('area' in sample) && sample.region_id === region?.id) legacyCoverage.current = region;
  const displayedCoverage = sample && !('area' in sample) ? legacyCoverage.current : coverage;
  const aircraft = useMemo(() => {
    history.current.prune(now);
    return enabled && sample ? history.current.displayed(sample.items, displayedCoverage, now) : [];
  }, [enabled, sample, displayedCoverage, now, version]);
  const trails = useMemo(() => history.current.trails(aircraft), [aircraft]);
  const currentIds = new Set(sample?.items.map(a => a.id));
  const lastKnownIds = aircraft.filter(a => !currentIds.has(a.id)).map(a => a.id);
  useEffect(() => {
    if (!enabled || !selectedId) { setSelected(null); return; }
    const observation = aircraft.find(a => a.id === selectedId);
    setSelected(previous => {
      if (observation && (previous?.aircraft.id !== selectedId || Date.parse(observation.observed_at) >= Date.parse(previous.aircraft.observed_at)))
        return { aircraft: observation, attribution: sample?.attribution ?? 'ADSB.lol · ODbL-1.0' };
      return previous?.aircraft.id === selectedId ? previous : null;
    });
  }, [enabled, selectedId, aircraft, sample]);
  const updatingArea = !!sample && (sampleKey?.[1] !== family || sampleKey?.[2] !== (areaEnabled ? desired : target));
  const stale = !!sample && (sample.stale || !!error || !sample.fetched_at || now - Date.parse(sample.fetched_at) > 120_000);
  const capacity = error instanceof ApiFailure && error.code === 'FLIGHT_REGION_CAPACITY';
  const status = capacity ? 'Flight coverage is busy. Retrying…'
    : error ? `Flight coverage unavailable. ${error instanceof ApiFailure && error.retryable ? 'Retrying…' : error.message}`
    : updatingArea ? 'Updating area'
    : current && 'status' in current && current.status === 'waiting' ? 'Waiting for flight coverage…'
    : current && 'status' in current && current.status === 'unavailable' ? 'Flight coverage unavailable. Retrying…'
    : !sample ? 'Loading flight coverage…'
    : stale ? 'Stale flight sample'
    : sample.items.length === 0 ? 'No aircraft received in this sample.'
    : `${aircraft.length} aircraft displayed`;
  const selectedAircraft = enabled && selectedId === selected?.aircraft.id ? selected.aircraft : null;
  return {
    aircraft, trails, coverage: displayedCoverage, lastKnownIds, now, stale, updatingArea, status, fetching,
    sample, current, error, oversized: viewportArea?.oversized ?? false,
    selected: selectedAircraft, selectedAttribution: selected?.attribution,
    selectedMissing: !!selectedAircraft && !sample?.items.some(a => a.id === selectedAircraft.id),
    selectedOutside: !!selectedAircraft && !!displayedCoverage && !withinFlightArea(selectedAircraft.coordinates, displayedCoverage),
    selectedExpired: !!selectedAircraft && now - Date.parse(selectedAircraft.observed_at) > POSITION_TTL,
  };
}
