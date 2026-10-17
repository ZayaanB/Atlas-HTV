import type pg from 'pg';
import { AppError, checkAbort, unavailable } from '../runtime/errors.js';
import type { Data } from '../services/validation.js';
export const reads = ['news', 'locations', 'investigation', 'observations', 'sources', 'semantic_news', 'freshness', 'embedding_chunks'] as const;
export type Read = typeof reads[number];
export interface Repository {
  readonly mode: 'stored' | 'fixture' | 'unavailable';
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
export class PgRepository implements Repository {
  readonly mode = 'stored' as const;
  constructor(private pool: pg.Pool, private handoff: DatabaseHandoff) {
    if (handoff.version !== 'atlas-p3-v1') throw new AppError('SCHEMA_HANDOFF_INVALID', 'Unsupported database handoff', 500);
    for (const plan of Object.values(handoff.plans)) {
      if (!plan || !plan.text || !Array.isArray(plan.parameters) || plan.parameters.some(p => !/^[a-z_]+$/.test(p))) throw new AppError('SCHEMA_HANDOFF_INVALID', 'Invalid query plan', 500);
    }
  }
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
    if (rows.length > 1000) throw new AppError('BATCH_TOO_LARGE', 'Import batch exceeds 1000 records');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) { checkAbort(signal); await client.query(this.plan(name, row)); }
      checkAbort(signal); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
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
