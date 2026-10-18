import type { GlobalFlights } from './global-flights.js';
import type { Config } from '../config.js';
import { AppError, bounded, checkAbort, unavailable } from '../runtime/errors.js';
import { Contracts, type Data, records, string } from './validation.js';

// Adapter ports only; public domain schemas remain in contracts/.
export interface FlightSample { items: Data[]; truncated: boolean }
export interface FlightProvider {
  region(region: Data, signal?: AbortSignal): Promise<Data[]>;
  area?(area: Data, signal?: AbortSignal): Promise<FlightSample>;
}
interface Entry {
  region: Data;
  kind: 'region' | 'area';
  items: Data[];
  fetched?: number;
  used: number;
  next: number;
  failures: number;
  truncated: boolean;
  wanted?: number;
  pending?: Promise<void>;
  error?: string;
}
const attribution = 'ADSB.lol — ODbL 1.0; receiver coverage is incomplete';

export class Flights {
  private cache = new Map<string, Entry>();
  private globalNext = 0;
  private shutdown = new AbortController();
  constructor(private contracts: Contracts, private config: Config, private regions: Data[], private provider?: FlightProvider, private clock = Date.now, private globalService?: GlobalFlights) {}

  get globalAvailable(): boolean { return this.config.flightsEnabled && !!this.globalService?.available; }
  async global(signal?: AbortSignal): Promise<Data> {
    if (!this.config.flightsEnabled || !this.globalService) throw unavailable('FLIGHTS_UNAVAILABLE', 'Global flights are not configured');
    return this.globalService.get(signal);
  }

  catalog(): Data[] { return this.regions.map(region => this.contracts.parse('FlightRegion', structuredClone(region), true)); }
  get areaAvailable(): boolean {
    return this.config.flightsEnabled && !!this.provider?.area &&
      ['FlightAreaQuery', 'FlightAreaResponse', 'AircraftState', 'FlightRegion'].every(name => this.contracts.has(name));
  }

  async get(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('FlightsQuery', raw);
    this.checkEnabled(signal);
    const id = string(query.region_id), region = this.regions.find(r => r.id === id);
    if (!region) throw new AppError('INVALID_REGION', 'Choose a configured bounded region');
    const entry = await this.sample(`region:${id}`, region, 'region', signal);
    if (entry.fetched === undefined) throw this.retryError('FLIGHTS_UNAVAILABLE', 'No flight sample is available; retry after provider backoff', 503, this.retryAt(entry));
    const { items, stale } = this.positions(entry);
    return this.contracts.parse('FlightsResponse', {
      items, region_id: id, fetched_at: new Date(entry.fetched).toISOString(), stale,
      mode: 'live', replay: false, attribution,
      retry_at: new Date(this.retryAt(entry)).toISOString(), error: entry.error ?? null
    }, true);
  }

  async area(raw: unknown, signal?: AbortSignal): Promise<Data> {
    // Missing shared exports fail before cache mutation or provider access. Never
    // install a private fallback schema to activate this optional capability.
    const query = this.contracts.parse('FlightAreaQuery', raw);
    if (!this.contracts.has('FlightAreaResponse')) throw unavailable('CONTRACTS_UNAVAILABLE', 'Shared schema FlightAreaResponse has not been supplied');
    this.checkEnabled(signal);
    if (!this.provider?.area) throw unavailable('FLIGHT_AREA_UNAVAILABLE', 'Flight area adapter is unavailable');
    const latitude = query.latitude, longitude = query.longitude, radius = query.radius_nm;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        typeof radius !== 'number' || !Number.isInteger(radius) || radius < 1 || radius > 100)
      throw new AppError('INVALID_REGION', 'Flight areas require valid coordinates and a radius of 1–100 nautical miles');
    // Nearby viewers share exactly this reported circle. Quantization may move
    // the center; consumers must draw the returned circle, not their input.
    const lat = Number(latitude.toFixed(1)), roundedLon = Number(longitude.toFixed(1));
    const lon = roundedLon === 180 ? -180 : roundedLon;
    const radiusNm = Math.ceil(radius / 5) * 5;
    const id = `area-${lat}-${lon}-${radiusNm}`;
    const region = this.contracts.parse('FlightRegion', { id, latitude: lat, longitude: lon, radius_nm: radiusNm });
    const entry = await this.sample(`area:${id}`, region, 'area', signal);
    const { items, stale } = this.positions(entry);
    return this.contracts.parse('FlightAreaResponse', {
      area: region, items, fetched_at: entry.fetched === undefined ? null : new Date(entry.fetched).toISOString(),
      status: entry.fetched === undefined ? entry.error ? 'unavailable' : 'waiting' : 'ready',
      stale, truncated: entry.truncated, mode: 'live', replay: false, attribution,
      retry_at: new Date(this.retryAt(entry)).toISOString(), error: entry.error ?? null
    }, true);
  }

  private checkEnabled(signal?: AbortSignal): void {
    if (this.shutdown.signal.aborted) throw unavailable('SERVICE_CLOSING', 'Flight service is closing');
    checkAbort(signal);
    if (!this.config.flightsEnabled || !this.provider) throw unavailable('FLIGHTS_DISABLED', 'Flight provider access is disabled pending setup and usage review');
  }

  private async sample(key: string, region: Data, kind: Entry['kind'], signal?: AbortSignal): Promise<Entry> {
    const now = this.clock();
    for (const [id, entry] of this.cache) {
      if (!entry.pending && now - entry.used > this.config.flightsExpireMs) this.cache.delete(id);
      else if (now - entry.used >= this.config.flightsActiveMs) entry.wanted = undefined;
    }
    let entry = this.cache.get(key);
    if (!entry) {
      if (this.cache.size >= this.config.flightsMaxRegions) {
        const idle = [...this.cache].filter(([, e]) => !e.pending && now - e.used >= this.config.flightsActiveMs)
          .sort((a, b) => a[1].used - b[1].used)[0];
        if (idle) this.cache.delete(idle[0]);
        else {
          const retry = Math.min(...[...this.cache.values()].map(e => e.used + this.config.flightsActiveMs));
          throw this.retryError('FLIGHT_REGION_CAPACITY', 'Active flight region limit reached; retry after an area becomes idle', 429, retry);
        }
      }
      entry = { region, kind, items: [], used: now, next: 0, failures: 0, truncated: false };
      this.cache.set(key, entry);
    }
    entry.used = now;
    if (!entry.pending && now >= entry.next) entry.wanted ??= now;
    if (now >= this.globalNext && ![...this.cache.values()].some(e => e.pending)) {
      // Only requested, due areas join this queue. A busy first area cannot keep
      // taking the next global slot ahead of another area's older request.
      const due = [...this.cache.values()].filter(e => e.wanted !== undefined && now >= e.next && now - e.used < this.config.flightsActiveMs)
        .sort((a, b) => a.wanted! - b.wanted!)[0];
      if (due) this.refresh(due);
    }
    if (entry.pending) {
      // Cancelling a viewer never cancels the coalesced provider operation.
      if (signal) await bounded(entry.pending, signal); else await entry.pending;
    }
    checkAbort(signal);
    return entry;
  }

  private refresh(entry: Entry): void {
    this.globalNext = this.clock() + this.config.flightsGlobalRefreshMs;
    entry.wanted = undefined;
    entry.pending = (async () => {
      try {
        const deadline = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.config.providerTimeoutMs)]);
        const sample = await bounded(Promise.resolve().then(async () => {
          checkAbort(deadline);
          return entry.kind === 'area' ? this.provider!.area!(entry.region, deadline) :
            { items: await this.provider!.region(entry.region, deadline), truncated: false };
        }), deadline);
        checkAbort(deadline);
        if (!Array.isArray(sample.items) || sample.items.length > 500 || typeof sample.truncated !== 'boolean')
          throw new AppError('INVALID_FLIGHT_DATA', 'Invalid bounded aircraft sample', 502);
        // Validate the full batch before replacing a previously good sample.
        const items = sample.items.map(a => this.contracts.parse('AircraftState', a, true));
        entry.items = items; entry.truncated = sample.truncated;
        entry.fetched = this.clock(); entry.failures = 0; entry.error = undefined;
        entry.next = this.clock() + this.config.flightsRefreshMs;
      } catch (error) {
        entry.failures = Math.min(entry.failures + 1, 20);
        entry.error = 'Flight provider unavailable; cached data may be stale';
        const retry = error && typeof error === 'object' ? (error as { retryAfter?: string }).retryAfter : undefined;
        const wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.clock()) : 0;
        entry.next = this.clock() + Math.max(Math.min(Number.isFinite(wait) ? wait : 0, 3600000),
          Math.min(this.config.flightsRefreshMs * 2 ** entry.failures, 900000));
        // A provider throttle applies to every area and both endpoint versions.
        this.globalNext = Math.max(this.globalNext, entry.next);
      } finally { entry.pending = undefined; }
    })();
  }

  private positions(entry: Entry): { items: Data[]; stale: boolean } {
    const now = this.clock();
    const age = entry.fetched === undefined ? Infinity : now - entry.fetched;
    const items = age > this.config.flightsExpireMs ? [] : entry.items.filter(a => now - Date.parse(string(a.observed_at)) <= this.config.flightsExpireMs);
    return { items, stale: age > this.config.flightsStaleMs || !!entry.error ||
      entry.items.some(a => now - Date.parse(string(a.observed_at)) > this.config.flightsStaleMs) };
  }

  private retryAt(entry: Entry): number { return Math.max(this.clock() + 1000, entry.next, this.globalNext); }
  private retryError(code: string, message: string, status: number, at: number): AppError {
    return Object.assign(new AppError(code, message, status, true), { retryAfter: String(Math.max(1, Math.ceil((at - this.clock()) / 1000))) });
  }

  async find(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('FindAircraftArgs', raw);
    const identifier = string(query.identifier).trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,16}$/.test(identifier)) throw new AppError('INVALID_AIRCRAFT', 'Provide an aircraft ID or callsign');
    const result = await this.get({ region_id: query.region_id }, signal);
    return { ...result, items: records(result.items).filter(a => [string(a.id).toUpperCase(), string(a.callsign).toUpperCase()].includes(identifier)) };
  }

  // No background timer: without requests there are no provider polls.
  clear() { this.cache.clear(); }
  async close() {
    this.shutdown.abort();
    await this.globalService?.close();
    await Promise.allSettled([...this.cache.values()].flatMap(entry => entry.pending ? [entry.pending] : []));
    this.clear();
  }
}
