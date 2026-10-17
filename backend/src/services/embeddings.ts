import { GoogleGenAI, type EmbedContentParameters, type EmbedContentResponse } from '@google/genai';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError, bounded, unavailable } from '../runtime/errors.js';
import type { Data } from './validation.js';
import type { Repository } from '../data/queries.js';
export class Embeddings {
  private client?: {models:{embedContent(params: EmbedContentParameters): Promise<EmbedContentResponse>}};
  readonly available: boolean;
  constructor(private config: Config, client?: {models:{embedContent(params: EmbedContentParameters): Promise<EmbedContentResponse>}}) {
    this.available = !!(config.geminiKey && config.embeddingModel && config.embeddingVersion);
    if (this.available) this.client = client ?? new GoogleGenAI({ apiKey: config.geminiKey! });
  }
  async embed(text: string, task: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT', signal?: AbortSignal): Promise<Data> {
    if (!this.client) throw unavailable('EMBEDDINGS_UNAVAILABLE', 'Semantic retrieval is disabled');
    if (!text.trim() || Buffer.byteLength(text) > 16000) throw new AppError('INVALID_EMBEDDING_TEXT', 'Embedding text must be 1–16000 bytes');
    const deadline = AbortSignal.any([AbortSignal.timeout(this.config.providerTimeoutMs), ...(signal ? [signal] : [])]);
    const result = await bounded(this.client.models.embedContent({ model: this.config.embeddingModel!, contents: text,
      config: { outputDimensionality: this.config.embeddingDimensions, taskType: task, abortSignal: deadline } }), deadline);
    const vector = result.embeddings?.[0]?.values;
    if (!vector || vector.length !== this.config.embeddingDimensions || vector.some(v => !Number.isFinite(v))) throw new AppError('INVALID_EMBEDDING', 'Provider returned an invalid embedding', 502);
    return { vector: `[${vector.join(',')}]`, model: this.config.embeddingModel, model_version: this.config.embeddingVersion,
      dimensions: this.config.embeddingDimensions, content_hash: createHash('sha256').update(text).digest('hex') };
  }
  async index(repository: Repository, sourceId: string, chunkId: string, permittedText: string, signal?: AbortSignal) {
    if (!repository.writeBatch) throw unavailable('INGESTION_UNAVAILABLE', 'Embedding writer is unavailable');
    const contentHash = createHash('sha256').update(permittedText).digest('hex');
    const existing = await repository.read('embedding_chunks',{source_id:sourceId,chunk_id:chunkId,model:this.config.embeddingModel,model_version:this.config.embeddingVersion,dimensions:this.config.embeddingDimensions},signal);
    if (existing.some(row => row.content_hash === contentHash && row.model === this.config.embeddingModel && row.model_version === this.config.embeddingVersion && row.dimensions === this.config.embeddingDimensions)) return {skipped:true};
    const embedding = await this.embed(permittedText, 'RETRIEVAL_DOCUMENT', signal);
    await repository.writeBatch('upsert_embeddings', [{ source_id: sourceId, chunk_id: chunkId, ...embedding }], signal);
    return {skipped:false};
  }
}
