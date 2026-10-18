import type { WindQuery, WindResponse } from '../../../contracts/dist/index.js';
import type { WindPoint, WindProvider } from '../data/providers/open-meteo.js';
import { AppError, bounded, checkAbort, unavailable } from '../runtime/errors.js';
import { Contracts } from './validation.js';

const REFRESH = 15 * 60000, EXPIRE = 60 * 60000;
interface Entry { used: number; next: number; failures: number; data?: WindResponse; pending?: Promise<void> }
const wrap = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
export function windPoints(bounds: WindQuery['bounds']): WindPoint[] {
  const [west, south, east, north] = bounds;
  const width = east > west ? east - west : east + 360 - west;
  if (west === east || width <= 0 || width > 360 || south >= north) throw new AppError('INVALID_BOUNDS', 'Wind bounds must cover a nonempty geographic area');
  return [0.2, 0.5, 0.8].flatMap(y => [0.2, 0.5, 0.8].map(x =>
    [wrap(west + x * width), south + y * (north - south)] as WindPoint));
}

/** Process-shared, demand-only model cache. No startup request or background polling. */
export class Wind {
  private cache = new Map<string, Entry>();
  private nextRequest = 0;
  private usage: { at: number; cost: number }[] = [];
  private shutdown = new AbortController();
  constructor(private contracts: Contracts, private timeoutMs: number, private provider?: WindProvider, private clock = Date.now) {}
  async get(raw: unknown, signal?: AbortSignal): Promise<WindResponse> {
    checkAbort(signal);
    const query = this.contracts.parse('WindQuery', raw) as unknown as WindQuery;
    const points = windPoints(query.bounds);
    if (this.shutdown.signal.aborted) throw unavailable('SERVICE_CLOSING', 'Wind service is closing');
    if (!this.provider) throw unavailable('WIND_DISABLED', 'Wind data is disabled in server configuration');
    const now = this.clock(), key = JSON.stringify(query.bounds);
    for (const [id, entry] of this.cache) if (!entry.pending && now - entry.used > EXPIRE) this.cache.delete(id);
    let entry = this.cache.get(key);
    if (!entry) {
      if (this.cache.size >= 64) {
        const oldest = [...this.cache.entries()].filter(([, item]) => !item.pending).sort((a, b) => a[1].used - b[1].used)[0];
        if (oldest) this.cache.delete(oldest[0]);
        else throw new AppError('WIND_CAPACITY', 'Wind requests are busy; try again shortly', 429, true);
      }
      entry = { used: now, next: 0, failures: 0 };
      this.cache.set(key, entry);
    }
    entry.used = now;
    if (!entry.pending && now >= entry.next) {
      this.usage = this.usage.filter(item => now - item.at < 86400000);
      const daily = this.usage.reduce((sum, item) => sum + item.cost, 0);
      const hourly = this.usage.filter(item => now - item.at < 3600000).reduce((sum, item) => sum + item.cost, 0);
      // A batched multi-location call counts each of its nine locations toward the free quota.
      const limited = now < this.nextRequest || daily + points.length > 9000 || hourly + points.length > 4500;
      if (limited && !entry.data) throw new AppError('WIND_RATE_LIMIT', 'Wind request budget is busy; try again in a minute', 429, true);
      if (!limited) {
        const target = entry;
        this.nextRequest = now + 10000;
        this.usage.push({ at: now, cost: points.length });
        target.pending = (async () => {
          try {
            const deadline = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.timeoutMs)]);
            const items = await bounded(this.provider!.samples(points, deadline), deadline);
            checkAbort(deadline);
            target.failures = 0;
            target.next = this.clock() + REFRESH;
            target.data = this.contracts.parse('WindResponse', {
              items, bounds: query.bounds, requested_points: 9, height_m: 10, kind: 'model_estimate', provider: 'open-meteo',
              fetched_at: new Date(this.clock()).toISOString(), next_refresh_at: new Date(target.next).toISOString(),
              stale: false, warning: null, attribution: 'Open-Meteo and its national weather-service data providers',
              source_url: 'https://open-meteo.com/en/docs', license: 'CC-BY-4.0',
            }, true) as unknown as WindResponse;
          } catch (error) {
            target.failures++;
            const retryAfter = (error as { retryAfter?: string }).retryAfter;
            const providerWait = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - this.clock()) : 0;
            const wait = Math.max(Number.isFinite(providerWait) ? Math.min(providerWait, EXPIRE) : 0, Math.min(60000 * 2 ** Math.min(target.failures, 6), REFRESH));
            target.next = this.clock() + wait;
            this.nextRequest = Math.max(this.nextRequest, target.next);
          } finally { target.pending = undefined; }
        })();
      }
    }
    if (entry.pending) await (signal ? bounded(entry.pending, signal) : entry.pending);
    checkAbort(signal);
    if (!entry.data || this.clock() - Date.parse(entry.data.fetched_at) > EXPIRE)
      throw unavailable('WIND_UNAVAILABLE', 'No recent wind model data is available; retry in a few minutes');
    const oldModel = entry.data.items.some(item => this.clock() - Date.parse(item.valid_at) > 30 * 60000 || Date.parse(item.valid_at) > this.clock() + 15 * 60000);
    const stale = oldModel || entry.failures > 0 || this.clock() - Date.parse(entry.data.fetched_at) >= REFRESH;
    return { ...entry.data, stale,
      next_refresh_at: new Date(Math.max(entry.next, this.nextRequest)).toISOString(),
      warning: stale ? 'Cached wind model estimates may be out of date.' : null };
  }
  async close() {
    this.shutdown.abort();
    await Promise.allSettled([...this.cache.values()].flatMap(entry => entry.pending ? [entry.pending] : []));
    this.cache.clear();
  }
}
