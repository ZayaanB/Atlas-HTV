import { AppError } from '../../runtime/errors.js';
import { Contracts, type Data, publicUrl, records, string } from '../../services/validation.js';
import { fetchText, jsonObject, type Fetch } from './http.js';
import type { FlightSample } from '../../services/flights.js';
import { flightUserAgent } from './flight-identity.js';
export class AdsbLol {
  private readonly userAgent: string;
  constructor(private contracts: Contracts, private timeoutMs: number, contact: string, private fetcher: Fetch = fetch, private clock = Date.now) {
    this.userAgent = flightUserAgent(contact);
  }
  async region(raw: Data, signal?: AbortSignal): Promise<Data[]> {
    return (await this.sample(raw, false, signal)).items;
  }
  async area(raw: Data, signal?: AbortSignal): Promise<FlightSample> {
    return this.sample(raw, true, signal);
  }
  private async sample(raw: Data, identity: boolean, signal?: AbortSignal): Promise<FlightSample> {
    const region = this.contracts.parse('FlightRegion', raw);
    const latitude = Number(region.latitude), longitude = Number(region.longitude), radius = Number(region.radius_nm);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isInteger(radius) || radius < 1 || radius > 100)
      throw new AppError('INVALID_REGION', 'Flight regions must have valid coordinates and a radius of 1–100 nautical miles');
    const payload = jsonObject(await fetchText(this.fetcher,`https://api.adsb.lol/v2/point/${latitude}/${longitude}/${radius}`, {
      signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])]), redirect: 'error',
      headers: { accept: 'application/json', 'User-Agent': this.userAgent }
    }));
    const fetched = this.clock();
    if (!Array.isArray(payload.ac) || payload.ac.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new AppError('INVALID_FLIGHT_DATA','Provider did not return an aircraft list',502);
    const now = payload.now;
    if (typeof now !== 'number' || !Number.isFinite(now)) throw new AppError('INVALID_FLIGHT_DATA', 'Missing provider observation epoch', 502);
    // The v2 (jv2) envelope uses Unix milliseconds; seen_pos uses seconds.
    const epoch = now;
    if (epoch > fetched + 30000 || fetched - epoch > 3600000) throw new AppError('INVALID_FLIGHT_DATA', 'Provider clock is outside the freshness bound', 502);
    const result = new Map<string, Data>();
    for (const a of records(payload.ac).slice(0,2000)) {
      const lat = a.lat, lon = a.lon, age = a.seen_pos;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || typeof age !== 'number' || !Number.isFinite(age) || age < 0 || age > 300 || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^[a-f0-9]{6}$/i.test(string(a.hex))) continue;
      const rad = (v: number) => v*Math.PI/180;
      const distance = 2*3440.065*Math.asin(Math.min(1,Math.sqrt(Math.sin(rad(lat-latitude)/2)**2+Math.cos(rad(lat))*Math.cos(rad(latitude))*Math.sin(rad(lon-longitude)/2)**2)));
      if (distance > radius) continue;
      const numberOrNull = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
      const nullableText = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
      const track = numberOrNull(a.track), speed = numberOrNull(a.gs);
      const aircraft = this.contracts.parse('AircraftState', {
        id: string(a.hex).toLowerCase(), provider: 'adsb.lol', callsign: string(a.flight).trim() || null,
        coordinates: [lon,lat], altitude: numberOrNull(a.alt_baro), altitude_unit: 'ft', altitude_reference: 'barometric',
        speed: speed !== null && speed >= 0 ? speed : null, speed_unit: 'kn',
        // Legacy wire name; this is ground track, not nose heading.
        heading: track !== null && track >= 0 && track < 360 ? track : null,
        observed_at: new Date(epoch-age*1000).toISOString(), fetched_at: new Date(fetched).toISOString(),
        source_url: publicUrl('https://www.adsb.lol/'), license: 'ODbL-1.0',
        ...(identity ? {
          registration: nullableText(a.r, 32), aircraft_type: nullableText(a.t, 16),
          // The reviewed v2 response supplies no verified operator field.
          operator: null, on_ground: a.alt_baro === 'ground' ? true : numberOrNull(a.alt_baro) !== null ? false : null
        } : {})
      }, true);
      const previous = result.get(string(aircraft.id));
      if (!previous || Date.parse(string(aircraft.observed_at)) > Date.parse(string(previous.observed_at))) result.set(string(aircraft.id), aircraft);
    }
    return {
      items: [...result.values()].sort((a, b) => string(a.id).localeCompare(string(b.id))).slice(0, 500),
      truncated: payload.ac.length > 2000 || result.size > 500 ||
        typeof payload.total === 'number' && payload.total > payload.ac.length
    };
  }
}
