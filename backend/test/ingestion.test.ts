import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ingestion, normalizeArticle, canonicalUrl } from '../src/data/ingestion.js';
import { Gdelt, gdeltDate } from '../src/data/providers/gdelt.js';
import { Rss } from '../src/data/providers/rss.js';
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
