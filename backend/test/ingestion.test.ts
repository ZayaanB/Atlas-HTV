import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ingestion, normalizeArticle, canonicalUrl } from '../src/data/ingestion.js';
import { Gdelt, gdeltDate } from '../src/data/providers/gdelt.js';
import { Rss, repairNasaNamespaceSpacing } from '../src/data/providers/rss.js';
import { readResponse } from '../src/data/providers/http.js';
import { TestRepository, testContracts } from './support.js';
const definition = {id:'test-provider',provider:'gdelt',query:'test',permitted:true,license_url:'https://example.invalid/terms',excerpts_permitted:false};
test('normalization deduplicates tracking URLs without inventing publication times or geography',() => {
  assert.equal(canonicalUrl('https://example.invalid/story?utm_source=test&x=1#top'),'https://example.invalid/story?x=1');
  const result = normalizeArticle({url:'https://example.invalid/story',title:'Synthetic headline',published_at:null,discovered_at:'2026-01-01T00:00:00Z',provider:'gdelt',excerpt:'not permitted'},definition,0,testContracts());
  assert.equal(result.published_at,null); assert.equal(result.excerpt,null); assert.deepEqual(result.location_ids,[]);
  assert.equal(result.geographic_precision,null); assert.equal(result.verification_status,'unreviewed');
  assert.equal(gdeltDate('20260230T000000Z'),null); assert.equal(gdeltDate('20260101T120000Z'),'2026-01-01T12:00:00.000Z');
});
test('GDELT discovery time is not publication time and requests use fixed endpoint',async () => {
  const provider = new Gdelt(1000,async url => {
    assert.equal(new URL(String(url)).origin,'https://api.gdeltproject.org');
    return new Response(JSON.stringify({articles:[{url:'https://example.invalid/a',title:'Synthetic',seendate:'20260101T120000Z',domain:'example.invalid'}]}));
  });
  const [article] = await provider.fetch(definition);
  assert.equal(article!.published_at,null); assert.equal(article!.discovered_at,'2026-01-01T12:00:00.000Z');
});
test('RSS requires permission, rejects entities and preserves absent excerpts',async () => {
  const fetcher = async () => new Response('<rss><channel><item><title>Synthetic title</title><link>https://example.invalid/a</link><description>Withheld text</description><pubDate>Thu, 01 Jan 2026 12:00:00 GMT</pubDate></item></channel></rss>');
  const rss = new Rss(1000,fetcher), feed = {...definition,provider:'rss',url:'https://example.org/feed'};
  await assert.rejects(rss.fetch({...feed,permitted:false}),/permission/);
  await assert.rejects(rss.fetch({...feed,url:'https://127.0.0.1/'}),/public HTTPS/);
  const [article] = await rss.fetch(feed);
  assert.equal(article!.excerpt,null); assert.equal(article!.published_at,'2026-01-01T12:00:00.000Z');
  await assert.rejects(new Rss(1000,async () => new Response('<!DOCTYPE foo><rss/>')).fetch(feed),/entities/);
});
test('ingestion upserts unique URLs, records freshness, and retains data on provider failures',async () => {
  const repository = new TestRepository(), provider = new Gdelt(1000,async () => new Response(JSON.stringify({articles:[
    {url:'https://example.invalid/a?utm_source=x',title:'Synthetic A'}, {url:'https://example.invalid/a',title:'Synthetic A'}]})));
  const service = new Ingestion(testContracts(),repository,[definition],provider,new Rss(1000),() => 1000);
  const [a,b] = await Promise.all([service.refresh('test-provider'),service.refresh('test-provider')]);
  assert.equal(a.imported,1); assert.deepEqual(a,b); assert.equal(repository.writes.filter(w => w.name === 'upsert_articles').length,1);
  const failing = new Ingestion(testContracts(),repository,[definition],new Gdelt(1000,async () => new Response('',{status:429,headers:{'retry-after':'1200'}})),new Rss(1000),() => 1000);
  await assert.rejects(failing.refresh('test-provider'),/Provider request failed/);
  const metadata = repository.writes.at(-1)!.rows[0]!;
  assert.equal(metadata.status,'failed'); assert.equal(metadata.last_successful_at,null);
  assert.equal(metadata.next_retry_at,new Date(1201000).toISOString());
  assert.equal(repository.writes.filter(w => w.name === 'upsert_articles').length,1);
});
test('provider streaming response sizes are bounded',async () => {
  await assert.rejects(readResponse(new Response('123456'),3),/safety bound/);
});
test('HTML and malformed feed bodies never count as a successful empty RSS refresh',async () => {
  const feed = {...definition,provider:'rss',url:'https://example.org/feed'};
  for (const body of ['<html><body>Provider unavailable</body></html>','<rss><channel><item></channel></rss>']) {
    await assert.rejects(new Rss(1000,async () => new Response(body)).fetch(feed),/invalid RSS|malformed XML/);
  }
  assert.deepEqual(await new Rss(1000,async () => new Response('<rss><channel/></rss>')).fetch(feed),[]);
});
test('Atom title text, alternate links and publication time survive normalization',async () => {
  const feed = {...definition,provider:'rss',url:'https://example.org/feed'};
  const [article] = await new Rss(1000,async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="text">123</title><link rel="self" href="https://example.invalid/api"/><link rel="alternate" href="https://example.invalid/story"/><published>2026-01-01T12:00:00Z</published><updated>2026-01-02T12:00:00Z</updated></entry></feed>')).fetch(feed);
  assert.equal(article!.title,'123'); assert.equal(article!.url,'https://example.invalid/story'); assert.equal(article!.published_at,'2026-01-01T12:00:00.000Z');
});
test('malformed provider JSON is rejected with an upstream error',async () => {
  for (const body of ['not json','[]','{"articles":[null]}']) await assert.rejects(new Gdelt(1000,async () => new Response(body)).fetch(definition),error => {
    return error instanceof Error && 'status' in error && error.status === 502;
  });
});
test('provider body reading respects cancellation even when a stream ignores it', {timeout:2000},async () => {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({pull:() => new Promise(() => {})});
  const pending = assert.rejects(readResponse(new Response(stream),100,controller.signal),/cancelled/);
  controller.abort(); await pending;
});
test('body cleanup errors do not mask provider status or size failures',async () => {
  const stream = () => new ReadableStream<Uint8Array>({cancel:() => Promise.reject(new Error('cleanup failure'))});
  await assert.rejects(readResponse(new Response(stream(),{status:429})),/Provider request failed/);
  await assert.rejects(readResponse(new Response(stream(),{headers:{'content-length':'200'}}),100),/safety bound/);
});
test('a stalled provider cannot ignore the configured request deadline', {timeout:2000},async () => {
  await assert.rejects(new Gdelt(100,async () => new Promise(() => {})).fetch(definition),/cancelled/);
});
test('the observed NASA root namespace typo is repaired without changing article text, links or dates',async () => {
  const malformed='<rss version="2.0" xmlns:apod="https://science.nasa.gov/apod/"xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Synthetic NASA protocol headline</title><link>https://science.nasa.gov/synthetic</link><pubDate>Thu, 01 Jan 2026 12:00:00 GMT</pubDate><description>Synthetic permitted excerpt</description></item></channel></rss>';
  const nasa={...definition,provider:'rss',url:'https://science.nasa.gov/feed/?science_org=19791%2C22453',publisher:'NASA',excerpts_permitted:true,max_excerpt_chars:300};
  const repaired=repairNasaNamespaceSpacing(malformed,new URL(String(nasa.url)));
  assert.equal(repaired.repaired,true);
  assert.equal(repaired.xml,malformed.replace('"xmlns:media','" xmlns:media'));
  const [article]=await new Rss(1000,async () => new Response(malformed)).fetch(nasa);
  assert.equal(article!.title,'Synthetic NASA protocol headline');
  assert.equal(article!.url,'https://science.nasa.gov/synthetic');
  assert.equal(article!.published_at,'2026-01-01T12:00:00.000Z');
  assert.equal(article!.excerpt,'Synthetic permitted excerpt');
  assert.equal(repairNasaNamespaceSpacing(repaired.xml,new URL(String(nasa.url))).repaired,false);
  await assert.rejects(new Rss(1000,async () => new Response(malformed)).fetch({...nasa,url:'https://example.org/feed'}),/malformed XML/);
  await assert.rejects(new Rss(1000,async () => new Response(malformed.replace('</item>',''))).fetch(nasa),/malformed XML/);
});
test('NASA root repair leaves body text and other XML errors untouched and still rejects entities',async () => {
  const nasa={...definition,provider:'rss',url:'https://science.nasa.gov/feed/'};
  const body='<rss><channel><description><![CDATA[xmlns:apod="https://science.nasa.gov/apod/"xmlns:media="http://search.yahoo.com/mrss/"]]></description></channel></rss>';
  assert.deepEqual(repairNasaNamespaceSpacing(body,new URL(String(nasa.url))),{xml:body,repaired:false});
  await assert.rejects(new Rss(1000,async () => new Response('<!DOCTYPE rss [<!ENTITY e "unsafe">]>'+body)).fetch(nasa),/entities/);
  await assert.rejects(new Rss(1000,async () => new Response('<rss bad="attribute"joined="attribute"><channel/></rss>')).fetch(nasa),/malformed XML/);
});
