import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isIP } from 'node:net';
import { AppError } from '../../runtime/errors.js';
import { type Data, object, records, string, publicUrl } from '../../services/validation.js';
import { fetchText, type Fetch } from './http.js';
export function feedUrl(value: unknown): string {
  const url = new URL(publicUrl(value));
  if (isIP(url.hostname.replace(/^\[|\]$/g,'')) || !url.hostname.includes('.') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || (url.port && url.port !== '443'))
    throw new AppError('SOURCE_DEFINITION_INVALID','Feed must use a reviewed public HTTPS hostname');
  return url.href;
}
function plain(value: unknown, max: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) value = object(value)['#text'];
  return string(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export class Rss {
  constructor(private timeoutMs: number, private fetcher: Fetch = fetch) {}
  async fetch(definition: Data, signal?: AbortSignal): Promise<Data[]> {
    if (definition.permitted !== true || !string(definition.license_url)) throw new AppError('SOURCE_NOT_PERMITTED','RSS feed requires recorded permission and license/terms reference');
    if (definition.excerpts_permitted === true && (!Number.isInteger(definition.max_excerpt_chars) || Number(definition.max_excerpt_chars) < 1 || Number(definition.max_excerpt_chars) > 500))
      throw new AppError('SOURCE_DEFINITION_INVALID','Permitted RSS excerpts require a character bound of 1–500');
    const xml = await fetchText(this.fetcher,feedUrl(definition.url), {redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])])},1000000);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new AppError('INVALID_XML','XML entities and document types are rejected',502);
    if (XMLValidator.validate(xml) !== true) throw new AppError('INVALID_XML','Provider returned malformed XML',502);
    const document = object(new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false,removeNSPrefix:true}).parse(xml));
    let items: Data[];
    try {
      let rawItems: unknown;
      if (document.rss !== undefined) {
        const channel = object(document.rss).channel;
        rawItems = object(channel === '' ? {} : channel).item;
      } else if (document.feed !== undefined) rawItems = object(document.feed === '' ? {} : document.feed).entry;
      else throw new Error('Unsupported feed');
      items = rawItems === undefined ? [] : Array.isArray(rawItems) ? records(rawItems) : [object(rawItems)];
    } catch { throw new AppError('INVALID_PROVIDER_DATA','Provider returned an invalid RSS/Atom feed',502); }
    return items.slice(0,100).map(item => {
      let link = item.link;
      if (Array.isArray(link)) link = link.find(v => v && typeof v === 'object' && (!object(v)['@_rel'] || object(v)['@_rel'] === 'alternate'));
      if (link && typeof link === 'object') link = object(link)['@_href'];
      const date = string(item.pubDate ?? item.published); // Atom updated is not publication.
      const milliseconds = date && /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)\s*$/i.test(date) ? Date.parse(date) : NaN;
      return {url:link,title:plain(item.title,1000),publisher:definition.publisher,
        excerpt:definition.excerpts_permitted === true ? plain(item.description ?? item.summary,Number(definition.max_excerpt_chars)) || null : null,
        published_at:Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null,
        discovered_at:null,publication_time_basis:Number.isFinite(milliseconds) ? 'feed_asserted' : 'unavailable',provider:'rss'};
    });
  }
}
