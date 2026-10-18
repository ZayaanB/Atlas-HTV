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
    published_at:raw.published_at ?? null,discovered_at:raw.discovered_at ?? null,event_at:raw.event_at ?? null,
    fetched_at:new Date(now).toISOString(),provider:raw.provider,provider_source_id:definition.id,
    publication_time_basis:raw.publication_time_basis,location_ids:[],entity_ids:[],themes:[],
    verification_status:'unreviewed',geographic_precision:null,
    content_hash:createHash('sha256').update(JSON.stringify([title,raw.excerpt ?? null])).digest('hex')
  },true);
}
// Shared by news and observation imports: a failed refresh waits at least 15 minutes (longer Retry-After respected,
// capped at 24 hours). Failure metadata must not erase the stored last_successful_at or previously stored records.
export async function markFailure(repository: Repository, id: string, attemptedAt: string, error: unknown, clock: () => number): Promise<void> {
  const retryHeader = (error as {retryAfter?:string}).retryAfter;
  const retryMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader)*1000 : Date.parse(retryHeader)-clock()) : 0;
  await repository.writeBatch!('mark_refresh',[{source_id:id,attempted_at:attemptedAt,status:'failed',last_successful_at:null,
    next_retry_at:new Date(clock()+Math.max(900000,Math.min(Number.isFinite(retryMs) ? retryMs : 0,86400000))).toISOString()}]);
}
export async function assertNotInBackoff(repository: Repository, id: string, clock: () => number, signal?: AbortSignal): Promise<void> {
  const [freshness] = await repository.read('freshness',{source_id:id},signal);
  if (freshness?.next_retry_at && Date.parse(string(freshness.next_retry_at)) > clock()) throw new AppError('INGESTION_BACKOFF','Source refresh is in backoff',429,true);
}
// Original-source metadata from the reviewed definition, stored on atlas.sources beside each imported URL.
const SOURCE_TYPES = ['news_article','government_report','web_page'];
export function sourceMetadata(definition: Data): Data {
  const optional = (key: string, max: number) => {
    const value = definition[key];
    if (value === undefined) return null;
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError('SOURCE_DEFINITION_INVALID',`Invalid ${key}`);
    return value;
  };
  const sourceType = optional('source_type',32);
  if (sourceType && !SOURCE_TYPES.includes(sourceType)) throw new AppError('SOURCE_DEFINITION_INVALID','Invalid source_type');
  return {source_type:sourceType,license:optional('license',300),license_url:publicUrl(definition.license_url),attribution:optional('attribution',1000)};
}
// A provider-published event location (see providers/gdacs.ts), validated as a shared unreviewed Location record.
export function eventLocation(raw: Data, article: Data, contracts: Contracts): Data | null {
  if (!raw.location || typeof raw.location !== 'object' || Array.isArray(raw.location)) return null;
  const p = raw.location as Data;
  const location = contracts.parse('Location',{
    id:p.id,name:p.name,precision:p.precision,coordinates:[p.longitude,p.latitude],
    bounds:[p.bounds_west,p.bounds_south,p.bounds_east,p.bounds_north],coordinates_basis:p.coordinates_basis,
    bounds_basis:p.bounds_basis,source_id:article.source_id,verification_status:'unreviewed'
  },true);
  return {article_url:article.url,id:location.id,name:location.name,precision:location.precision,
    longitude:p.longitude,latitude:p.latitude,coordinates_basis:location.coordinates_basis,
    bounds_west:p.bounds_west,bounds_south:p.bounds_south,bounds_east:p.bounds_east,bounds_north:p.bounds_north,
    bounds_basis:location.bounds_basis};
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
    await assertNotInBackoff(this.repository,id,this.clock,signal);
    const fetchedAt = new Date(this.clock()).toISOString(), metadata = sourceMetadata(definition);
    let imported = 0, skipped = 0, located = 0;
    try {
      checkAbort(signal);
      const input = definition.provider === 'gdelt' ? await this.gdelt.fetch(definition,signal) : definition.provider === 'rss' ? await this.rss.fetch(definition,signal) : undefined;
      if (!input) throw new AppError('SOURCE_DEFINITION_INVALID','Unsupported news provider');
      const unique = new Map<string,Data>(), places = new Map<string,Data>();
      for (const row of input) {
        try {
          const article = normalizeArticle(row,definition,this.clock(),this.contracts);
          unique.set(string(article.id),article);
          // An invalid provider location leaves the article unlocated; it never blocks the article itself.
          try { const place = eventLocation(row,article,this.contracts); if (place) places.set(string(article.id),place); }
          catch (error) { if (error instanceof AppError && error.code === 'CONTRACTS_UNAVAILABLE') throw error; }
        }
        catch (error) { if (error instanceof AppError && error.code === 'CONTRACTS_UNAVAILABLE') throw error; skipped++; }
      }
      if (input.length && unique.size === 0) throw new AppError('INVALID_PROVIDER_DATA','No provider records passed normalization',502);
      await this.repository.writeBatch('upsert_articles',[...unique.values()].map(article => ({...article,...metadata})),signal);
      if (places.size) await this.repository.writeBatch('upsert_event_locations',[...places.values()],signal);
      imported = unique.size; located = places.size;
    } catch (error) {
      await markFailure(this.repository,id,fetchedAt,error,this.clock);
      throw error;
    }
    await this.repository.writeBatch('mark_refresh',[{source_id:id,attempted_at:fetchedAt,status:'success',last_successful_at:new Date(this.clock()).toISOString(),next_retry_at:null}],signal);
    return {source_id:id,imported,skipped,located,last_successful_at:new Date(this.clock()).toISOString(),verification_status:'unreviewed'};
  }
}
