// Synthetic protocol samples only. No fixture/provider/live-operation claim.
import type { AircraftState, FlightAreaResponse, FlightGlobalResponse } from '@atlas/contracts';
import type { ViewportSnapshot } from '../src/app/map-interface';
export const INITIAL_TIME = Date.parse('2026-10-17T12:00:00Z');
export const stamp = (offset = 0) => new Date(INITIAL_TIME + offset).toISOString();
export function aircraft(id = 'abc123', offset = 0, overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    id, provider: 'adsb.lol', callsign: 'TEST', coordinates: [-79.4, 43.7], altitude: 10000,
    altitude_unit: 'ft', altitude_reference: 'barometric', speed: 250, speed_unit: 'kn', heading: 90,
    registration: null, aircraft_type: null, operator: null, on_ground: null,
    observed_at: stamp(offset), fetched_at: stamp(offset), source_url: 'https://example.invalid/synthetic-aircraft', license: 'ODbL-1.0', ...overrides,
  };
}
export function sample(items = [aircraft()], overrides: Partial<FlightAreaResponse> = {}): FlightAreaResponse {
  return {
    area: { id: 'area-43.7--79.4-10', latitude: 43.7, longitude: -79.4, radius_nm: 10 },
    items, fetched_at: stamp(), status: 'ready', stale: false, truncated: false, mode: 'live', replay: false,
    attribution: 'Synthetic protocol test · not live', retry_at: stamp(60_000), error: null, ...overrides,
  };
}
export const viewport: ViewportSnapshot = { center: [-79.4, 43.7], bounds: [-79.5, 43.6, -79.3, 43.8], zoom: 10 };
export function globalAircraft(id = 'abc123', offset = 0, overrides: Partial<AircraftState> = {}): AircraftState {
  return aircraft(id, offset, {
    provider: 'airlabs', altitude_unit: 'm', altitude_reference: 'unknown', speed: null,
    direction_kind: 'direction', flight_iata: 'AB12', airline_icao: 'ABC', airline_iata: 'AB',
    departure_iata: 'YYZ', arrival_iata: 'YVR', source_url: 'https://airlabs.co/', license: 'AirLabs-terms', ...overrides,
  });
}
export function globalSample(items = [globalAircraft()], overrides: Partial<FlightGlobalResponse> = {}): FlightGlobalResponse {
  return {
    snapshot_id: `airlabs-${INITIAL_TIME}`, items, trails: [], fetched_at: stamp(), status: 'ready',
    stale: false, truncated: false, mode: 'live', replay: false, attribution: 'Synthetic AirLabs · incomplete coverage',
    retry_at: stamp(300_000), pause_reason: null, error: null, ...overrides,
  };
}
