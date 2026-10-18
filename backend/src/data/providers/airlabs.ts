import { AppError } from '../../runtime/errors.js';
import { Contracts, type Data, string } from '../../services/validation.js';
import { fetchText, jsonObject, type Fetch } from './http.js';
import type { FlightSample } from '../../services/flights.js';

export class AirLabs {
  constructor(private contracts: Contracts, private key: string, private timeout: number, private fetcher: Fetch = fetch, private clock = Date.now) {}
  async snapshot(signal: AbortSignal): Promise<FlightSample> {
    const url = new URL('https://airlabs.co/api/v9/flights');
    url.searchParams.set('api_key', this.key);
    url.searchParams.set('_fields', 'hex,lat,lng,updated,status,reg_number,aircraft_icao,flight_icao,flight_iata,airline_icao,airline_iata,dep_iata,arr_iata,alt,dir');
    const payload = jsonObject(await fetchText(this.fetcher, url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]), redirect: 'error', headers: { accept: 'application/json' }
    }, 16_000_000));
    // AirLabs may encode errors in a successful HTTP response. Never expose its envelope.
    if (payload.error) {
      const error = payload.error as Data;
      const code = `${error?.code ?? ''} ${string(error?.message)}`.toLowerCase();
      throw new AppError(code.includes('limit') ? 'AIRLABS_QUOTA' : /key|access|subscription|auth/.test(code) ? 'AIRLABS_AUTH' : 'AIRLABS_RESPONSE', 'Flight provider rejected the request', 503, true);
    }
    if (!Array.isArray(payload.response)) throw new AppError('INVALID_FLIGHT_DATA', 'Provider did not return a flight list', 502);
    const now = this.clock(), result = new Map<string, Data>();
    const text = (v: unknown, max = 32) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
    for (const row of payload.response.slice(0, 50000)) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const a = row as Data, observed = typeof a.updated === 'number' ? a.updated * 1000 : NaN;
      if (a.status !== 'en-route' || !/^[a-f0-9]{6}$/i.test(string(a.hex)) ||
        typeof a.lat !== 'number' || !Number.isFinite(a.lat) || Math.abs(a.lat) > 90 ||
        typeof a.lng !== 'number' || !Number.isFinite(a.lng) || Math.abs(a.lng) > 180 ||
        !Number.isFinite(observed) || observed > now + 30000 || now - observed > 300000) continue;
      const item = this.contracts.parse('AircraftState', {
        id: string(a.hex).toLowerCase(), provider: 'airlabs', callsign: text(a.flight_icao),
        registration: text(a.reg_number), aircraft_type: text(a.aircraft_icao, 16), operator: null, on_ground: false,
        coordinates: [a.lng, a.lat], altitude: typeof a.alt === 'number' && Number.isFinite(a.alt) ? a.alt : null,
        altitude_unit: 'm', altitude_reference: 'unknown', speed: null, speed_unit: 'kn',
        heading: typeof a.dir === 'number' && a.dir >= 0 && a.dir < 360 ? a.dir : null, direction_kind: 'direction',
        flight_iata: text(a.flight_iata), airline_icao: text(a.airline_icao), airline_iata: text(a.airline_iata),
        departure_iata: text(a.dep_iata), arrival_iata: text(a.arr_iata),
        observed_at: new Date(observed).toISOString(), fetched_at: new Date(now).toISOString(),
        source_url: 'https://airlabs.co/', license: 'AirLabs-terms'
      }, true);
      const previous = result.get(string(item.id));
      if (!previous || string(item.observed_at) > string(previous.observed_at)) result.set(string(item.id), item);
    }
    return { items: [...result.values()].sort((a,b) => string(a.id).localeCompare(string(b.id))).slice(0,25000), truncated: result.size > 25000 || payload.response.length > 50000 };
  }
}
