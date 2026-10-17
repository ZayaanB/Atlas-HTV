import { AppError } from '../../runtime/errors.js';
import { Contracts, type Data, object, publicUrl, records, string, strings } from '../validation.js';
export class EvidenceLedger {
  readonly sourceIds = new Set<string>();
  readonly resultIds = new Set<string>();
  private sourceMap = new Map<string,Data>();
  private recordSources = new Map<string,Set<string>>();
  collect(value: unknown, depth = 0): void {
    if (depth > 12 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(v => this.collect(v,depth+1)); return; }
    const record = object(value);
    if (typeof record.id === 'string') this.resultIds.add(record.id);
    if (typeof record.source_id === 'string') this.sourceIds.add(record.source_id);
    for (const id of strings(record.source_ids)) this.sourceIds.add(id);
    if (typeof record.id === 'string') {
      const ids = this.recordSources.get(record.id) ?? new Set<string>();
      if (typeof record.source_id === 'string') ids.add(record.source_id);
      strings(record.source_ids).forEach(id => ids.add(id));
      this.recordSources.set(record.id,ids);
    }
    for (const [key, v] of Object.entries(record)) {
      if (key === 'sources') for (const s of records(v)) { this.sourceIds.add(string(s.id)); this.sourceMap.set(string(s.id), s); }
      this.collect(v,depth+1);
    }
  }
  attach(sources: Data[]) { for (const source of sources) if (this.sourceIds.has(string(source.id))) this.sourceMap.set(string(source.id),source); }
  resolve(raw: unknown, contracts: Contracts): Data[] {
    if (!Array.isArray(raw) || raw.length > 30) throw new AppError('INVALID_MODEL_OUTPUT', 'Invalid citations', 502);
    return raw.map(value => {
      const citation = object(value), id = string(citation.source_id), source = this.sourceMap.get(id);
      if (!source || !this.sourceIds.has(id)) throw new AppError('INVALID_CITATION', 'Citation was not retrieved', 502);
      if (citation.url !== undefined && citation.url !== source.url) throw new AppError('INVALID_CITATION', 'Citation URL does not match retrieved source', 502);
      const recordId = string(citation.record_id);
      if (!this.resultIds.has(recordId)) throw new AppError('INVALID_CITATION', 'Citation record was not retrieved', 502);
      if (!this.recordSources.get(recordId)?.has(id)) throw new AppError('INVALID_CITATION', 'Citation source does not support that record', 502);
      return contracts.parse('Citation', { ...citation, url: publicUrl(source.url), title: source.title ?? source.name }, true);
    });
  }
}
