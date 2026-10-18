import type { AircraftState, FlightAreaQuery, FlightGlobalResponse, FlightRegion } from '@atlas/contracts';
import type { Coordinates, FlightMode, FlightTrailSegment, ViewportSnapshot } from '../app/map-interface';

export const POSITION_TTL = 5 * 60_000;
export const HISTORY_TTL = 30 * 60_000;
export const GLOBAL_POSITION_TTL = 10 * 60_000;
export const GLOBAL_STALE_AFTER = 6 * 60_000;
const RAD = Math.PI / 180;
export const normalizeLongitude = (longitude: number) => longitude >= -180 && longitude < 180 ? longitude : ((longitude + 180) % 360 + 360) % 360 - 180;
export function distanceNm(a: readonly number[], b: readonly number[]): number {
  const lat = (b[1]! - a[1]!) * RAD, lon = normalizeLongitude(b[0]! - a[0]!) * RAD;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1]! * RAD) * Math.cos(b[1]! * RAD) * Math.sin(lon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function canonicalFlightArea(query: FlightAreaQuery): FlightAreaQuery {
  return {
    latitude: Number(query.latitude.toFixed(1)),
    longitude: normalizeLongitude(Number(query.longitude.toFixed(1))),
    radius_nm: Math.min(100, Math.ceil(query.radius_nm / 5) * 5),
  };
}
export function viewportFlightArea(viewport: ViewportSnapshot): { query: FlightAreaQuery; oversized: boolean } | null {
  if (![...viewport.center, ...viewport.bounds].every(Number.isFinite)) return null;
  const [west, south, east, north] = viewport.bounds;
  const center: Coordinates = [normalizeLongitude(viewport.center[0]), Math.max(-90, Math.min(90, viewport.center[1]))];
  const span = east >= west ? east - west : normalizeLongitude(east - west) + (normalizeLongitude(east - west) < 0 ? 360 : 0);
  const distances = [west, east].flatMap(lon => [south, north].map(lat => distanceNm(center, [normalizeLongitude(lon), Math.max(-90, Math.min(90, lat))])));
  // Wrapped whole-world bounds can have identical corners. They still exceed bounded coverage.
  const radius = Math.abs(east - west) >= 360 || span >= 180 ? 10800 : Math.max(1, Math.ceil(Math.max(...distances)));
  return { query: { latitude: center[1], longitude: center[0], radius_nm: Math.min(100, radius) }, oversized: radius > 100 };
}
export const withinFlightArea = (coordinates: Coordinates, area: FlightRegion) => distanceNm(coordinates, [area.longitude, area.latitude]) <= area.radius_nm + 0.001;
export const observationKey = (a: AircraftState) => `${a.provider}:${a.id}`;
type FlightObservation = Pick<AircraftState, 'coordinates' | 'observed_at' | 'callsign'> & Partial<Pick<AircraftState, 'provider' | 'id' | 'flight_iata'>>;
/** Shared by trail segmentation and marker transitions; drawing never invents evidence. */
export function observationsConnect(a: FlightObservation, b: FlightObservation, mode: FlightMode = 'area'): boolean {
  const elapsed = Date.parse(b.observed_at) - Date.parse(a.observed_at);
  return a.provider === b.provider && a.id === b.id && a.callsign === b.callsign &&
    (mode !== 'global' || (a.flight_iata ?? null) === (b.flight_iata ?? null)) &&
    elapsed > 0 && elapsed <= (mode === 'global' ? 11 * 60_000 : 120_000) &&
    distanceNm(a.coordinates, b.coordinates) / (elapsed / 3_600_000) <= 1200;
}

/** Only the newest snapshot supplies markers. No session accumulator or sampling cap. */
export function globalFlightGeometry(items: FlightGlobalResponse['items'], trails: FlightGlobalResponse['trails'], now: number) {
  let nextChangeAt = Infinity;
  const aircraft = items.filter(item => {
    const expires = Date.parse(item.observed_at) + GLOBAL_POSITION_TTL;
    if (now > expires) return false;
    nextChangeAt = Math.min(nextChangeAt, expires + 1);
    return true;
  });
  const byId = new Map(aircraft.map(item => [item.id, item]));
  const segments: FlightTrailSegment[] = [];
  for (const trail of trails) {
    if (!byId.has(trail.aircraft_id)) continue;
    const groups: (typeof trail.points)[] = [];
    // The service orders observations; sort a copy so out-of-order input cannot make a backwards line.
    for (const point of [...trail.points].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))) {
      const expires = Date.parse(point.observed_at) + HISTORY_TTL;
      if (now > expires) continue;
      nextChangeAt = Math.min(nextChangeAt, expires + 1);
      if (!groups.length || !observationsConnect(groups.at(-1)!.at(-1)!, point, 'global')) groups.push([point]);
      else groups.at(-1)!.push(point);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      for (const coordinates of splitDateline(group.map(point => point.coordinates))) segments.push({
        aircraftId: trail.aircraft_id, coordinates, observedFrom: group[0]!.observed_at, observedTo: group.at(-1)!.observed_at,
      });
    }
  }
  return { aircraft, trails: segments, byId, nextChangeAt };
}

/** Split drawing geometry at ±180 without adding synthetic observations to history. */
export function splitDateline(coordinates: readonly Coordinates[]): Coordinates[][] {
  if (!coordinates.length) return [];
  const parts: Coordinates[][] = [[coordinates[0]!]];
  for (let i = 1; i < coordinates.length; i++) {
    const previous = parts.at(-1)!.at(-1)!, next = coordinates[i]!;
    const delta = next[0] - previous[0];
    if (Math.abs(delta) > 180) {
      if (normalizeLongitude(delta) === 0) {
        parts.at(-1)!.push([previous[0], next[1]]);
        parts.push([next]);
        continue;
      }
      const unwrapped = previous[0] + normalizeLongitude(delta), edge = unwrapped > 180 ? 180 : -180;
      const latitude = previous[1] + (next[1] - previous[1]) * (edge - previous[0]) / (unwrapped - previous[0]);
      parts.at(-1)!.push([edge, latitude]);
      parts.push([[-edge, latitude], next]);
    } else parts.at(-1)!.push(next);
  }
  return parts.filter(part => part.length >= 2);
}

/** Session-only derived data. Repeated or older provider samples never append. */
export class FlightHistory {
  readonly records = new Map<string, AircraftState[]>();
  ingest(items: readonly AircraftState[], now: number) {
    this.prune(now);
    for (const item of [...items].sort((a,b) => Date.parse(a.observed_at) - Date.parse(b.observed_at))) {
      if (now - Date.parse(item.observed_at) > HISTORY_TTL) continue;
      const key = observationKey(item), observations = this.records.get(key) ?? [];
      const previous = observations.at(-1);
      if (previous && Date.parse(previous.observed_at) >= Date.parse(item.observed_at)) {
        if (previous.observed_at === item.observed_at && Date.parse(item.fetched_at) >= Date.parse(previous.fetched_at))
          observations[observations.length - 1] = item;
        continue;
      }
      this.records.set(key, [...observations, item].slice(-60));
    }
    if (this.records.size > 1000) {
      const oldest = [...this.records].sort((a,b) => Date.parse(a[1].at(-1)!.observed_at) - Date.parse(b[1].at(-1)!.observed_at));
      for (const [key] of oldest.slice(0, this.records.size - 1000)) this.records.delete(key);
    }
  }
  prune(now: number) {
    for (const [key, observations] of this.records) {
      const retained = observations.filter(a => now - Date.parse(a.observed_at) <= HISTORY_TTL);
      if (retained.length) this.records.set(key, retained); else this.records.delete(key);
    }
  }
  displayed(items: readonly AircraftState[], area: FlightRegion | null, now: number): AircraftState[] {
    if (!area) return [];
    const current = new Set(items.map(observationKey));
    const valid = (a: AircraftState) => now - Date.parse(a.observed_at) <= POSITION_TTL && withinFlightArea(a.coordinates, area);
    const latest = (a: AircraftState) => {
      const retained = this.records.get(observationKey(a))?.at(-1);
      return retained && Date.parse(retained.observed_at) > Date.parse(a.observed_at) ? retained : a;
    };
    const primary = [...new Map(items.map(a => [observationKey(a), latest(a)])).values()].filter(valid);
    const retained = [...this.records.values()].map(a => a.at(-1)!).filter(a => !current.has(observationKey(a)) && valid(a))
      .sort((a,b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    return [...primary, ...retained].slice(0, 500);
  }
  trails(aircraft: readonly AircraftState[]): FlightTrailSegment[] {
    return aircraft.flatMap(a => {
      const observations = this.records.get(observationKey(a)) ?? [];
      const groups: AircraftState[][] = [];
      for (const observation of observations) {
        if (!groups.length || !observationsConnect(groups.at(-1)!.at(-1)!, observation)) groups.push([observation]);
        else groups.at(-1)!.push(observation);
      }
      return groups.filter(group => group.length >= 2).flatMap(group => splitDateline(group.map(item => item.coordinates)).map(coordinates => ({
        aircraftId: a.id, coordinates, observedFrom: group[0]!.observed_at, observedTo: group.at(-1)!.observed_at,
      })));
    });
  }
}
