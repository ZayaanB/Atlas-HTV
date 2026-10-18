import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isIP } from 'node:net';
import { AppError } from '../../runtime/errors.js';
import { type Data, object, records, string, publicUrl } from '../../services/validation.js';
import { fetchText, type Fetch } from './http.js';
import { gdacsEvent, gdacsSelected, rssTime, validMinimumAlerts } from './gdacs.js';
export function feedUrl(value: unknown): string {
  const url = new URL(publicUrl(value));
  if (isIP(url.hostname.replace(/^\[|\]$/g,'')) || !url.hostname.includes('.') || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || (url.port && url.port !== '443'))
    throw new AppError('SOURCE_DEFINITION_INVALID','Feed must use a reviewed public HTTPS hostname');
  return url.href;
}
// The parser does not process entities (DTDs are rejected outright). Decode only XML's five predefined escapes and
// numeric character references afterwards, so "&amp;" in a link or "&gt;" in a title read as published.
export function xmlText(value: string): string {
  return value.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(lt|gt|quot|apos|amp));/gi,(match,decimal?: string,hex?: string,name?: string) => {
    if (name) return ({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'} as Record<string,string>)[name.toLowerCase()] ?? match;
    const code = decimal ? Number(decimal) : parseInt(hex ?? '',16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
}
function plain(value: unknown, max: number): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) value = object(value)['#text'];
  // Strip markup before and after decoding, so escaped tags in a description never survive as markup.
  return xmlText(string(value).replace(/<[^>]*>/g,' ')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
// Reviewed feed profiles that publish structured extensions beside standard RSS items.
const profiles = ['gdacs'] as const;
export function repairNasaNamespaceSpacing(xml: string, url: URL): {xml: string;repaired: boolean} {
  // Observed 2026-10-17 on the reviewed NASA feed. Correct only this missing
  // delimiter in the root header; never repair article text or tolerate other bad XML.
  if (url.hostname!=='science.nasa.gov' || url.pathname!=='/feed/') return {xml,repaired:false};
  const start=xml.indexOf('<rss '),end=start<0?-1:xml.indexOf('>',start);
  if (start<0 || start>512 || end<0 || end>4096) return {xml,repaired:false};
  const header=xml.slice(start,end);
  const malformed='xmlns:apod="https://science.nasa.gov/apod/"xmlns:media="http://search.yahoo.com/mrss/"';
  if (!header.includes(malformed)) return {xml,repaired:false};
  const repaired=header.replace(malformed,malformed.replace('"xmlns:media','" xmlns:media'));
  return {xml:xml.slice(0,start)+repaired+xml.slice(end),repaired:true};
}
export class Rss {
  constructor(private timeoutMs: number, private fetcher: Fetch = fetch) {}
  async fetch(definition: Data, signal?: AbortSignal): Promise<Data[]> {
    if (definition.permitted !== true || !string(definition.license_url)) throw new AppError('SOURCE_NOT_PERMITTED','RSS feed requires recorded permission and license/terms reference');
    if (definition.excerpts_permitted === true && (!Number.isInteger(definition.max_excerpt_chars) || Number(definition.max_excerpt_chars) < 1 || Number(definition.max_excerpt_chars) > 500))
      throw new AppError('SOURCE_DEFINITION_INVALID','Permitted RSS excerpts require a character bound of 1–500');
    const profile = definition.profile;
    if (profile !== undefined && !profiles.includes(profile as typeof profiles[number])) throw new AppError('SOURCE_DEFINITION_INVALID','Unsupported RSS profile');
    if (!validMinimumAlerts(definition.min_alert_level) || (definition.min_alert_level !== undefined && profile !== 'gdacs'))
      throw new AppError('SOURCE_DEFINITION_INVALID','min_alert_level maps GDACS event types to Green, Orange or Red');
    const url=feedUrl(definition.url);
    // GDACS lists ~200 current events with full extensions (~650 KB observed); other feeds keep the 1 MB bound.
    const received = (await fetchText(this.fetcher,url, {redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])])},profile === 'gdacs' ? 3000000 : 1000000))
      .replace(/^﻿/,'');
    if (/<!DOCTYPE|<!ENTITY/i.test(received)) throw new AppError('INVALID_XML','XML entities and document types are rejected',502);
    const {xml}=repairNasaNamespaceSpacing(received,new URL(url));
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
    // GDACS lists events by type, not time: keep the 100 most recently published items the definition selects.
    if (profile === 'gdacs') items = items.filter(item => gdacsSelected(item,definition.min_alert_level as Data ?? {}))
      .map(item => ({item,time:Date.parse(rssTime(item.pubDate) ?? '') || 0}))
      .sort((a,b) => b.time-a.time).map(({item}) => item);
    return items.slice(0,100).map(item => {
      let link = item.link;
      if (Array.isArray(link)) link = link.find(v => v && typeof v === 'object' && (!object(v)['@_rel'] || object(v)['@_rel'] === 'alternate'));
      if (link && typeof link === 'object') link = object(link)['@_href'];
      if (typeof link === 'string') link = xmlText(link.trim());
      const published_at = rssTime(item.pubDate ?? item.published); // Atom updated is not publication.
      return {url:link,title:plain(item.title,1000),publisher:definition.publisher,
        excerpt:definition.excerpts_permitted === true ? plain(item.description ?? item.summary,Number(definition.max_excerpt_chars)) || null : null,
        published_at,discovered_at:null,publication_time_basis:published_at ? 'feed_asserted' : 'unavailable',provider:'rss',
        ...(profile === 'gdacs' ? gdacsEvent(item) : {})};
    });
  }
}
