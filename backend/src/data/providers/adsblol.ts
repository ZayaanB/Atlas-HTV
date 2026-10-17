import { AppError } from '../../runtime/errors.js';
import { Contracts, type Data, publicUrl, records, string } from '../../services/validation.js';
import { fetchText, jsonObject, type Fetch } from './http.js';
export class AdsbLol {
  constructor(private contracts: Contracts, private timeoutMs: number, private fetcher: Fetch = fetch, private clock = Date.now) {}
  async region(raw: Data, signal?: AbortSignal): Promise<Data[]> {
    const region = this.contracts.parse('FlightRegion', raw);
    const latitude = Number(region.latitude), longitude = Number(region.longitude), radius = Number(region.radius_nm);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isInteger(radius) || radius < 1 || radius > 100)
      throw new AppError('INVALID_REGION', 'Flight regions must have valid coordinates and a radius of 1–100 nautical miles');
    const payload = jsonObject(await fetchText(this.fetcher,`https://api.adsb.lol/v2/point/${latitude}/${longitude}/${radius}`, {
      signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])]), redirect: 'error', headers: { accept: 'application/json' }
    }));
    const fetched = this.clock();
    if (!Array.isArray(payload.ac) || payload.ac.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new AppError('INVALID_FLIGHT_DATA','Provider did not return an aircraft list',502);
    const now = Number(payload.now);
    if (!Number.isFinite(now)) throw new AppError('INVALID_FLIGHT_DATA', 'Missing provider observation epoch', 502);
    // The v2 (jv2) envelope uses Unix milliseconds; seen_pos uses seconds.
    const epoch = now;
    if (epoch > fetched + 30000 || fetched - epoch > 3600000) throw new AppError('INVALID_FLIGHT_DATA', 'Provider clock is outside the freshness bound', 502);
    const result: Data[] = [];
    for (const a of records(payload.ac).slice(0,2000)) {
      const lat = a.lat, lon = a.lon, age = a.seen_pos;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || typeof age !== 'number' || !Number.isFinite(age) || age < 0 || age > 300 || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^[a-f0-9]{6}$/i.test(string(a.hex))) continue;
      const rad = (v: number) => v*Math.PI/180;
      const distance = 2*3440.065*Math.asin(Math.min(1,Math.sqrt(Math.sin(rad(lat-latitude)/2)**2+Math.cos(rad(lat))*Math.cos(rad(latitude))*Math.sin(rad(lon-longitude)/2)**2)));
      if (distance > radius) continue;
      const numberOrNull = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
      result.push(this.contracts.parse('AircraftState', {
        id: string(a.hex).toLowerCase(), provider: 'adsb.lol', callsign: string(a.flight).trim() || null,
        coordinates: [lon,lat], altitude: numberOrNull(a.alt_baro), altitude_unit: 'ft', altitude_reference: 'barometric',
        speed: numberOrNull(a.gs), speed_unit: 'kn', heading: numberOrNull(a.track),
        observed_at: new Date(epoch-age*1000).toISOString(), fetched_at: new Date(fetched).toISOString(),
        source_url: publicUrl('https://www.adsb.lol/'), license: 'ODbL-1.0'
      }, true));
    }
    return result.slice(0,500);
  }
}
