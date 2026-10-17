import { AppError } from '../../runtime/errors.js';
import { type Data, object, records, string } from '../../services/validation.js';
import { readResponse, type Fetch } from './http.js';
export class Gdelt {
  constructor(private timeoutMs: number, private fetcher: Fetch = fetch) {}
  async fetch(definition: Data, signal?: AbortSignal): Promise<Data[]> {
    const query = string(definition.query);
    if (!query.trim() || query.length > 512) throw new AppError('SOURCE_DEFINITION_INVALID','GDELT requires a reviewed bounded query');
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    for (const [key,value] of Object.entries({query,mode:'artlist',format:'json',maxrecords:'100',timespan:'1d',sort:'datedesc'})) url.searchParams.set(key,value);
    const response = await this.fetcher(url,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])]),headers:{accept:'application/json'}});
    const result = object(JSON.parse(await readResponse(response)));
    if (!Array.isArray(result.articles)) throw new AppError('INVALID_PROVIDER_DATA','GDELT returned an invalid article list',502);
    return records(result.articles).slice(0,100).map(row => ({
      url:row.url,title:row.title,publisher:row.domain,excerpt:null,published_at:null,
      discovered_at:gdeltDate(row.seendate),publication_time_basis:'unavailable',provider:'gdelt'
    }));
  }
}
export function gdeltDate(value: unknown): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(string(value));
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  return Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString() === iso ? iso : null;
}
