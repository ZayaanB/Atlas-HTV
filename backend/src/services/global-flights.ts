import { AppError, bounded, checkAbort, unavailable } from '../runtime/errors.js';
import { Contracts, type Data, string } from './validation.js';
import type { FlightSample } from './flights.js';
import type { FlightBudget } from './flight-budget.js';

export interface GlobalFlightProvider { snapshot(signal: AbortSignal): Promise<FlightSample> }
export class GlobalFlights {
  private sample?: FlightSample;
  private fetched?: number;
  private next = 0;
  private failures = 0;
  private error: string | null = null;
  private paused: 'quota' | 'authentication' | 'configuration' | null = null;
  private pending?: Promise<void>;
  private shutdown = new AbortController();
  private history = new Map<string, Data[]>();
  constructor(private contracts: Contracts, private provider: GlobalFlightProvider, private budget: FlightBudget, private clock = Date.now) {}
  get available() { return ['FlightGlobalResponse', 'AircraftState'].every(name => this.contracts.has(name)); }
  async get(signal?: AbortSignal): Promise<Data> {
    checkAbort(signal);
    if (this.shutdown.signal.aborted) throw unavailable('SERVER_CLOSING', 'Server is closing');
    if (!this.available) throw unavailable('CONTRACTS_UNAVAILABLE', 'Global flight contracts are not integrated');
    if (!this.paused && this.clock() >= this.next && !this.pending) {
      this.pending = this.refresh().finally(() => { this.pending = undefined; });
    }
    if (this.pending) {
      if (signal) await bounded(this.pending, signal); else await this.pending;
    }
    checkAbort(signal);
    const now = this.clock();
    this.prune(now);
    const items = (this.sample?.items ?? []).filter(a => now - Date.parse(string(a.observed_at)) <= 600000);
    const ids = new Set(items.map(a => string(a.id)));
    return this.contracts.parse('FlightGlobalResponse', {
      snapshot_id: this.fetched === undefined ? null : `airlabs-${this.fetched}`,
      items,
      trails: [...this.history].filter(([id]) => ids.has(id)).map(([aircraft_id, points]) => ({ aircraft_id, points })),
      fetched_at: this.fetched === undefined ? null : new Date(this.fetched).toISOString(),
      status: this.fetched === undefined ? 'unavailable' : 'ready',
      stale: this.fetched === undefined || now - this.fetched > 360000 || !!this.error,
      truncated: this.sample?.truncated ?? false, mode: 'live', replay: false,
      attribution: 'AirLabs — global airline traffic; provider coverage is incomplete',
      retry_at: this.paused ? null : new Date(Math.max(now + 1000, this.next)).toISOString(),
      pause_reason: this.paused, error: this.error
    }, true);
  }
  private async refresh() {
    try {
      await this.budget.reserve();
      checkAbort(this.shutdown.signal);
      const sample = await bounded(this.provider.snapshot(this.shutdown.signal), this.shutdown.signal);
      if (sample.items.length > 25000) throw new AppError('INVALID_FLIGHT_DATA', 'Flight sample exceeded safety bound', 502);
      this.sample = sample; this.fetched = this.clock(); this.next = this.fetched + 300000;
      this.error = null; this.failures = 0;
      this.prune(this.fetched);
      for (const item of sample.items) {
        const id = string(item.id), points = this.history.get(id) ?? [];
        const last = points.at(-1), observed_at = string(item.observed_at);
        if (!last || observed_at > string(last.observed_at)) points.push({
          coordinates: item.coordinates, observed_at, callsign: item.callsign ?? null, flight_iata: item.flight_iata ?? null
        });
        this.history.set(id, points.slice(-8));
      }
      if (this.history.size > 25000) {
        const sorted = [...this.history].sort((a,b) => string(a[1].at(-1)?.observed_at).localeCompare(string(b[1].at(-1)?.observed_at)));
        for (const [id] of sorted.slice(0, this.history.size - 25000)) this.history.delete(id);
        this.sample.truncated = true;
      }
    } catch (error) {
      const e = error as {code?: string; upstreamStatus?: number; retryAfter?: string};
      this.paused = ['FLIGHT_QUOTA', 'AIRLABS_QUOTA'].includes(e?.code ?? '') ? 'quota' :
        e?.code === 'AIRLABS_AUTH' || [401,403].includes(e?.upstreamStatus ?? 0) ? 'authentication' :
        ['FLIGHT_LEDGER', 'AIRLABS_RESPONSE'].includes(e?.code ?? '') ? 'configuration' : null;
      this.error = this.paused ? `Flight updates paused: ${this.paused}` : 'Flight provider unavailable; cached observations may be stale';
      const retry = e?.retryAfter;
      const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.clock()) : 0;
      this.next = this.clock() + Math.max(300000, Math.min(3600000, 300000 * 2 ** Math.min(this.failures++, 4)), Number.isFinite(retryMs) ? Math.max(0, retryMs) : 0);
    }
  }
  private prune(now: number) {
    for (const [id, points] of this.history) {
      const retained = points.filter(p => now - Date.parse(string(p.observed_at)) <= 1800000);
      if (retained.length) this.history.set(id, retained); else this.history.delete(id);
    }
  }
  async close() { this.shutdown.abort(); await this.pending; this.history.clear(); this.sample = undefined; }
}
