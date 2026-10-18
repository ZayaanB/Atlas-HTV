import type { WindSample } from '../../../../contracts/dist/index.js';
import { AppError } from '../../runtime/errors.js';
import { object } from '../../services/validation.js';
import { fetchText, type Fetch } from './http.js';

export type WindPoint = WindSample['coordinates'];
export interface WindProvider { samples(points: WindPoint[], signal: AbortSignal): Promise<WindSample[]> }

export class OpenMeteo implements WindProvider {
  constructor(private fetcher: Fetch = globalThis.fetch) {}
  async samples(points: WindPoint[], signal: AbortSignal): Promise<WindSample[]> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', points.map(point => point[1]).join(','));
    url.searchParams.set('longitude', points.map(point => point[0]).join(','));
    url.searchParams.set('current', 'wind_speed_10m,wind_direction_10m');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('timezone', 'GMT');
    url.searchParams.set('cell_selection', 'nearest');
    url.searchParams.set('forecast_days', '1');
    let raw: unknown;
    try { raw = JSON.parse(await fetchText(this.fetcher, url, { signal, redirect: 'error' }, 65536)); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_PROVIDER_DATA', 'Wind provider returned unreadable data', 502);
    }
    const invalid = () => new AppError('INVALID_PROVIDER_DATA', 'Wind provider returned invalid data or units', 502);
    const asObject = (value: unknown) => { try { return object(value); } catch { throw invalid(); } };
    if (!Array.isArray(raw) || raw.length !== points.length) throw invalid();
    const samples: WindSample[] = [];
    for (let i = 0; i < raw.length; i++) {
      const row = asObject(raw[i]), current = asObject(row.current), units = asObject(row.current_units);
      const coordinate = (value: unknown, min: number, max: number): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
      if (row.utc_offset_seconds !== 0 || units.time !== 'unixtime' || units.wind_speed_10m !== 'km/h' || units.wind_direction_10m !== '°' ||
        !coordinate(row.longitude, -180, 180) || !coordinate(row.latitude, -90, 90) ||
        !coordinate(current.time, 1, 4102444800) || !Number.isInteger(current.time)) throw invalid();
      if (current.wind_speed_10m === null) continue;
      if (!coordinate(current.wind_speed_10m, 0, 500) || (current.wind_direction_10m !== null && !coordinate(current.wind_direction_10m, 0, 360))) throw invalid();
      const point = points[i]!;
      samples.push({
        id: `wind-${point[0].toFixed(6)}:${point[1].toFixed(6)}`,
        coordinates: point, model_coordinates: [row.longitude, row.latitude],
        speed_kmh: current.wind_speed_10m, direction_from_degrees: current.wind_direction_10m,
        valid_at: new Date(current.time * 1000).toISOString(),
      });
    }
    return samples;
  }
}
