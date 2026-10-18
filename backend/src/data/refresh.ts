import { AppError } from '../runtime/errors.js';
import { ingestionFailure } from '../runtime/ingestion-errors.js';
import type { Data } from '../services/validation.js';
export interface RefreshTarget { id: string; provider: string; refresh(signal: AbortSignal): Promise<Data> }
export interface RefreshOptions {
  // GDELT answered 429 "limit requests to one every 5 seconds" on 2026-10-17; 6 s keeps a margin.
  gdeltSpacingMs?: number;
  perSourceTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}
// One sequential pass over every reviewed source: no concurrency, GDELT requests spaced apart, one bounded deadline
// per source, and a failure or backoff in one source never stops the others. Stored records are never removed.
export async function refreshAll(targets: RefreshTarget[], options: RefreshOptions = {}): Promise<Data[]> {
  const spacing = options.gdeltSpacingMs ?? 6000, timeout = options.perSourceTimeoutMs ?? 60000;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve,ms))), clock = options.clock ?? Date.now;
  const results: Data[] = [];
  let lastGdelt: number | undefined;
  for (const target of targets) {
    if (target.provider === 'gdelt' && lastGdelt !== undefined) {
      const wait = lastGdelt + spacing - clock();
      if (wait > 0) await sleep(wait);
    }
    try {
      results.push({status:'success',...await target.refresh(AbortSignal.timeout(timeout))});
      if (target.provider === 'gdelt') lastGdelt = clock();
    } catch (error) {
      const backoff = error instanceof AppError && error.code === 'INGESTION_BACKOFF';
      // A source skipped for backoff made no provider request, so it does not delay the next GDELT source.
      if (target.provider === 'gdelt' && !backoff) lastGdelt = clock();
      results.push({source_id:target.id,status:backoff ? 'backoff' : 'failed',error:ingestionFailure(error)});
    }
  }
  return results;
}
