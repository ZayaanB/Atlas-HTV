import { createHash } from 'node:crypto';
import { AppError, checkAbort, unavailable } from '../runtime/errors.js';
import { Contracts, type Data, publicUrl, string } from '../services/validation.js';
import type { Repository } from './queries.js';
import { Gdelt } from './providers/gdelt.js';
import { Rss } from './providers/rss.js';
export function canonicalUrl(raw: unknown): string {
  const url = new URL(publicUrl(raw));
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid','gclid'].includes(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
export function normalizeArticle(raw: Data, definition: Data, now: number, contracts: Contracts): Data {
  const url = canonicalUrl(raw.url), hash = createHash('sha256').update(url).digest('hex');
  const title = string(raw.title).trim();
  if (!title || title.length > 1000) throw new AppError('INVALID_PROVIDER_DATA','Article title is missing or too long',502);
  return contracts.parse('Article', {
    id:`article-${hash}`,source_id:`source-${hash}`,url,title,publisher:string(raw.publisher) || new URL(url).hostname,
    excerpt:definition.excerpts_permitted === true ? raw.excerpt ?? null : null,
    published_at:raw.published_at ?? null,discovered_at:raw.discovered_at ?? null,event_at:null,
    fetched_at:new Date(now).toISOString(),provider:raw.provider,provider_source_id:definition.id,
    publication_time_basis:raw.publication_time_basis,location_ids:[],entity_ids:[],themes:[],
    verification_status:'unreviewed',geographic_precision:null,
    content_hash:createHash('sha256').update(JSON.stringify([title,raw.excerpt ?? null])).digest('hex')
  },true);
}
export class Ingestion {
  private pending = new Map<string,Promise<Data>>();
  constructor(private contracts: Contracts, private repository: Repository, private definitions: Data[], private gdelt: Gdelt, private rss: Rss, private clock = Date.now) {}
  refresh(id: string, signal?: AbortSignal): Promise<Data> {
    const existing = this.pending.get(id); if (existing) return existing;
    const promise = this.run(id,signal).finally(() => this.pending.delete(id));
    this.pending.set(id,promise); return promise;
  }
  private async run(id: string, signal?: AbortSignal): Promise<Data> {
    const definition = this.definitions.find(d => d.id === id);
    if (!definition || definition.permitted !== true || !string(definition.license_url)) throw new AppError('SOURCE_NOT_PERMITTED','Use a reviewed permitted source definition');
    if (!this.repository.writeBatch) throw unavailable('INGESTION_UNAVAILABLE','Database import handoff is missing');
    const [freshness] = await this.repository.read('freshness',{source_id:id},signal);
    if (freshness?.next_retry_at && Date.parse(string(freshness.next_retry_at)) > this.clock()) throw new AppError('INGESTION_BACKOFF','Source refresh is in backoff',429,true);
    const fetchedAt = new Date(this.clock()).toISOString();
    let imported = 0, skipped = 0;
    try {
      checkAbort(signal);
      const input = definition.provider === 'gdelt' ? await this.gdelt.fetch(definition,signal) : definition.provider === 'rss' ? await this.rss.fetch(definition,signal) : undefined;
      if (!input) throw new AppError('SOURCE_DEFINITION_INVALID','Unsupported news provider');
      const unique = new Map<string,Data>();
      for (const row of input) {
        try { const article = normalizeArticle(row,definition,this.clock(),this.contracts); unique.set(string(article.id),article); }
        catch (error) { if (error instanceof AppError && error.code === 'CONTRACTS_UNAVAILABLE') throw error; skipped++; }
      }
      if (input.length && unique.size === 0) throw new AppError('INVALID_PROVIDER_DATA','No provider records passed normalization',502);
      await this.repository.writeBatch('upsert_articles',[...unique.values()],signal);
      imported = unique.size;
    } catch (error) {
      const retryHeader = (error as {retryAfter?:string}).retryAfter;
      const retryMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader)*1000 : Date.parse(retryHeader)-this.clock()) : 0;
      // Failure metadata must not erase the stored last_successful_at or previous articles.
      await this.repository.writeBatch('mark_refresh',[{source_id:id,attempted_at:fetchedAt,status:'failed',last_successful_at:null,
        next_retry_at:new Date(this.clock()+Math.max(900000,Math.min(Number.isFinite(retryMs) ? retryMs : 0,86400000))).toISOString()}]);
      throw error;
    }
    await this.repository.writeBatch('mark_refresh',[{source_id:id,attempted_at:fetchedAt,status:'success',last_successful_at:new Date(this.clock()).toISOString(),next_retry_at:null}],signal);
    return {source_id:id,imported,skipped,last_successful_at:new Date(this.clock()).toISOString(),verification_status:'unreviewed'};
  }
}
