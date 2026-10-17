import type pg from 'pg';
import { AppError, checkAbort, unavailable } from '../runtime/errors.js';
import type { Data } from '../services/validation.js';
export const reads = ['news', 'locations', 'investigation', 'observations', 'sources', 'semantic_news', 'freshness', 'embedding_chunks'] as const;
export type Read = typeof reads[number];
export const corePlans: Read[] = ['news','locations','investigation','observations','sources','freshness'];
export interface Repository {
  readonly mode: 'stored' | 'fixture' | 'unavailable';
  readonly missingPlans?: readonly string[];
  read(name: Read, input: Data, signal?: AbortSignal): Promise<Data[]>;
  writeBatch?(name: 'upsert_articles' | 'upsert_embeddings' | 'mark_refresh', rows: Data[], signal?: AbortSignal): Promise<void>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}
// The SQL handoff is reviewed local code/config, never HTTP/model supplied SQL.
export interface QueryPlan { text: string; parameters: string[] }
export interface DatabaseHandoff {
  version: 'atlas-p3-v1';
  plans: Partial<Record<Read | 'upsert_articles' | 'upsert_embeddings' | 'mark_refresh', QueryPlan>>;
}
export function validateDatabaseHandoff(value: unknown): DatabaseHandoff {
  const invalid = () => new AppError('SCHEMA_HANDOFF_INVALID','Expected a versioned database handoff with reviewed query plans',500);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const handoff = value as DatabaseHandoff;
  if (handoff.version !== 'atlas-p3-v1' || !handoff.plans || typeof handoff.plans !== 'object' || Array.isArray(handoff.plans)) throw invalid();
  const names: string[] = [...reads,'upsert_articles','upsert_embeddings','mark_refresh'];
  for (const [name,plan] of Object.entries(handoff.plans)) {
    if (!names.includes(name) || !plan || typeof plan !== 'object' || typeof plan.text !== 'string' || !plan.text.trim() || plan.text.length > 64000 ||
      !Array.isArray(plan.parameters) || plan.parameters.length > 64 || plan.parameters.some(p => typeof p !== 'string' || !/^[a-z_]+$/.test(p))) throw invalid();
  }
  return handoff;
}
export class PgRepository implements Repository {
  readonly mode = 'stored' as const;
  constructor(private pool: pg.Pool, private handoff: DatabaseHandoff) {
    validateDatabaseHandoff(handoff);
  }
  get missingPlans() { return corePlans.filter(name => !Object.hasOwn(this.handoff.plans,name)); }
  private plan(name: keyof DatabaseHandoff['plans'], input: Data) {
    const plan = this.handoff.plans[name];
    if (!plan) throw unavailable('SCHEMA_HANDOFF_UNAVAILABLE', `Database query ${name} awaits the frozen schema handoff`);
    return { text: plan.text, values: plan.parameters.map(key => input[key] ?? null) };
  }
  async read(name: Read, input: Data, signal?: AbortSignal) {
    checkAbort(signal);
    const result = await this.pool.query(this.plan(name, input));
    checkAbort(signal);
    if (result.rows.length > 10000) throw new AppError('RESULT_TOO_LARGE', 'Database result exceeded its safety bound', 502);
    return result.rows as Data[];
  }
  async writeBatch(name: 'upsert_articles' | 'upsert_embeddings' | 'mark_refresh', rows: Data[], signal?: AbortSignal) {
    checkAbort(signal);
    if (rows.length > 1000) throw new AppError('BATCH_TOO_LARGE', 'Import batch exceeds 1000 records');
    const client = await this.pool.connect();
    let begun = false, discard = false;
    try {
      checkAbort(signal);
      await client.query('BEGIN');
      begun = true;
      for (const row of rows) { checkAbort(signal); await client.query(this.plan(name, row)); }
      checkAbort(signal); await client.query('COMMIT');
    } catch (error) {
      if (begun) {
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
      }
      throw error;
    } finally { client.release(discard); }
  }
  async health() { try { await this.pool.query('SELECT 1'); return true; } catch { return false; } }
  async close() { await this.pool.end(); }
}
export class UnavailableRepository implements Repository {
  readonly mode = 'unavailable' as const;
  async read(): Promise<Data[]> { throw unavailable('DATA_UNAVAILABLE', 'Database credentials and frozen query handoff are required'); }
  async health() { return false; }
  async close() {}
}
