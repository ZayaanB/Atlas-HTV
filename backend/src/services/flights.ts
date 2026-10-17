import type { Config } from '../config.js';
import { AppError, bounded, checkAbort, unavailable } from '../runtime/errors.js';
import { Contracts, type Data, records, string } from './validation.js';
interface Entry { items: Data[]; fetched: number; used: number; next: number; failures: number; pending?: Promise<void>; error?: string }
export interface FlightProvider { region(region: Data, signal?: AbortSignal): Promise<Data[]> }
export class Flights {
  private cache = new Map<string, Entry>();
  private globalNext = 0;
  private shutdown = new AbortController();
  constructor(private contracts: Contracts, private config: Config, private regions: Data[], private provider?: FlightProvider, private clock = Date.now) {}
  async get(raw: unknown, signal?: AbortSignal): Promise<Data> {
    const query = this.contracts.parse('FlightsQuery', raw);
    if (this.shutdown.signal.aborted) throw unavailable('SERVICE_CLOSING','Flight service is closing');
    if (!this.config.flightsEnabled || !this.provider) throw unavailable('FLIGHTS_DISABLED', 'Flight provider access is disabled pending setup and usage review');
    const id = string(query.region_id), region = this.regions.find(r => r.id === id);
    if (!region) throw new AppError('INVALID_REGION', 'Choose a configured bounded region');
    checkAbort(signal);
    const now = this.clock();
    for (const [key, entry] of this.cache) if (!entry.pending && now-entry.used > this.config.flightsExpireMs) this.cache.delete(key);
    let entry = this.cache.get(id);
    if (!entry) {
      if (this.cache.size >= this.config.flightsMaxRegions) throw new AppError('FLIGHT_REGION_CAPACITY', 'Active flight region limit reached', 429, true);
      entry = { items: [], fetched: 0, used: now, next: 0, failures: 0 };
      this.cache.set(id, entry);
    }
    entry.used = now;
    if (!entry.pending && now >= Math.max(entry.next, this.globalNext)) {
      const target = entry;
      // One provider request across all regions per refresh interval, including failures.
      this.globalNext = now + this.config.flightsRefreshMs;
      target.next = this.globalNext;
      target.pending = (async () => {
        try {
          const deadline = AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(this.config.providerTimeoutMs)]);
          const items = await bounded(Promise.resolve().then(() => {
            checkAbort(deadline);
            return this.provider!.region(region,deadline);
          }),deadline);
          checkAbort(deadline);
          target.items = items.map(a => this.contracts.parse('AircraftState', a, true));
          target.fetched = this.clock(); target.failures = 0; target.error = undefined;
          target.next = this.clock()+this.config.flightsRefreshMs;
        } catch (error) {
          target.failures++; target.error = 'Flight provider unavailable; cached data may be stale';
          const retry = (error as { retryAfter?: string }).retryAfter;
          const wait = retry ? (/^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-this.clock()) : 0;
          target.next = this.clock() + Math.max(Math.min(Number.isFinite(wait) ? wait : 0, 3600000), Math.min(this.config.flightsRefreshMs*2**target.failures, 900000));
          this.globalNext = Math.max(this.globalNext, target.next);
        } finally { target.pending = undefined; }
      })();
    }
    if (entry.pending) {
      // Cancelling one viewer does not cancel the shared provider request for others.
      if (signal) await bounded(entry.pending,signal); else await entry.pending;
    }
    checkAbort(signal);
    if (!entry.fetched) throw unavailable('FLIGHTS_UNAVAILABLE', 'No flight sample is available; retry after provider backoff');
    const age = this.clock()-entry.fetched;
    const items = age > this.config.flightsExpireMs ? [] : entry.items.filter(a => this.clock()-Date.parse(string(a.observed_at)) <= this.config.flightsExpireMs);
    return this.contracts.parse('FlightsResponse', {
      items, region_id: id, fetched_at: new Date(entry.fetched).toISOString(),
      stale: age > this.config.flightsStaleMs || !!entry.error || items.some(a => this.clock()-Date.parse(string(a.observed_at)) > this.config.flightsStaleMs),
      mode: 'live', replay: false, attribution: 'ADSB.lol — ODbL 1.0; receiver coverage is incomplete',
      retry_at: new Date(Math.max(entry.next,this.globalNext)).toISOString(), error: entry.error ?? null
    }, true);
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
    await Promise.allSettled([...this.cache.values()].flatMap(entry => entry.pending ? [entry.pending] : []));
    this.clear();
  }
}
