import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ingestion } from '../src/data/ingestion.js';
import { ObservationIngestion } from '../src/data/observation-ingestion.js';
import { refreshAll } from '../src/data/refresh.js';
import { Gdelt } from '../src/data/providers/gdelt.js';
import { Rss, xmlText } from '../src/data/providers/rss.js';
import { UsgsWaterData } from '../src/data/providers/usgs-waterdata.js';
import { AppError } from '../src/runtime/errors.js';
import { TestRepository, testContracts } from './support.js';
// Synthetic GDACS-shaped items. Element names follow the observed feed; values are invented test data.
const item = (type: string, id: string, alert: string, extra = '') => `<item>
  <title>${alert} ${type} alert in Testland &gt; region</title>
  <description>Synthetic alert &amp; description.</description>
  <link>https://www.gdacs.org/report.aspx?eventtype=${type}&amp;eventid=${id}</link>
  <pubDate>Sat, 17 Oct 2026 0${id.length % 9}:00:00 GMT</pubDate>
  <gdacs:fromdate>Sat, 17 Oct 2026 05:06:57 GMT</gdacs:fromdate>
  <gdacs:eventtype>${type}</gdacs:eventtype><gdacs:eventid>${id}</gdacs:eventid><gdacs:alertlevel>${alert}</gdacs:alertlevel>
  <gdacs:country>Testland</gdacs:country>${extra}
</item>`;
const point = '<geo:Point><geo:lat>28.5</geo:lat><geo:long>66.25</geo:long></geo:Point><gdacs:bbox>62.25 70.25 24.5 32.5</gdacs:bbox>';
const feedXml = (items: string) => `﻿<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:gdacs="http://www.gdacs.org"><channel>${items}</channel></rss>`;
const gdacs = {id:'rss-gdacs-test',provider:'rss',profile:'gdacs',permitted:true,url:'https://www.gdacs.org/xml/rss.xml',publisher:'GDACS',
  source_type:'government_report',license:'CC BY 4.0',license_url:'https://creativecommons.org/licenses/by/4.0/',attribution:'Source: GDACS',
  excerpts_permitted:true,max_excerpt_chars:300,min_alert_level:{WF:'Orange'}};

test('XML text decodes only predefined escapes and character references',() => {
  assert.equal(xmlText('a &amp; b &lt;c&gt; &#39;d&#x27; &quot;'),`a & b <c> 'd' "`);
  assert.equal(xmlText('&nbsp; &custom; &#0; &#xD800;'),'&nbsp; &custom; &#0; &#xD800;');
});
test('GDACS items keep provider points and boxes, earthquake origin times only, and the reviewed alert threshold',async () => {
  const body = feedXml([
    item('EQ','1001','Green',point), item('FL','1002','Green',point), item('WF','1003','Green',point), item('WF','1004','Orange',point),
    // Box crossing the antimeridian and a point outside its own box: no location is stored for either.
    item('TC','1005','Red','<geo:Point><geo:lat>-12</geo:lat><geo:long>179.5</geo:long></geo:Point><gdacs:bbox>175.5 -176.5 -16 -8</gdacs:bbox>'),
    item('EQ','1006','Green','<geo:Point><geo:lat>10</geo:lat><geo:long>10</geo:long></geo:Point><gdacs:bbox>62 70 24 32</gdacs:bbox>')
  ].join(''));
  const rows = await new Rss(1000,async () => new Response(body)).fetch(gdacs);
  const byId = new Map(rows.map(row => [new URL(String(row.url)).searchParams.get('eventid'),row]));
  assert.deepEqual([...byId.keys()].sort(),['1001','1002','1004','1005','1006'],'Green wildfire filtered by definition');
  const quake = byId.get('1001')!;
  assert.equal(quake.url,'https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1001');
  assert.equal(quake.title,'Green EQ alert in Testland > region'); assert.equal(quake.excerpt,'Synthetic alert & description.');
  assert.equal(quake.event_at,'2026-10-17T05:06:57.000Z');
  assert.deepEqual(quake.location,{id:'loc-gdacs-eq-1001',name:'Testland · GDACS earthquake 1001',precision:'region',longitude:66.25,latitude:28.5,
    coordinates_basis:'GDACS event point for EQ 1001 as published in its RSS item (provider-asserted, not reviewed by Atlas)',
    bounds_west:62.25,bounds_south:24.5,bounds_east:70.25,bounds_north:32.5,
    bounds_basis:'GDACS alert bounding box from its RSS item: a display extent around the event point, not an affected-area footprint'});
  assert.equal(byId.get('1002')!.event_at,null,'day-level flood dates are not turned into instants');
  assert.equal(byId.get('1005')!.location,null); assert.equal(byId.get('1006')!.location,null);
  await assert.rejects(new Rss(1000,async () => new Response(body)).fetch({...gdacs,profile:'other'}),/Unsupported RSS profile/);
  await assert.rejects(new Rss(1000,async () => new Response(body)).fetch({...gdacs,min_alert_level:{WF:'Purple'}}),/min_alert_level/);
});
test('news ingestion writes source licensing and provider-asserted locations after the articles',async () => {
  const repository = new TestRepository();
  const rss = new Rss(1000,async () => new Response(feedXml(item('EQ','2001','Green',point)+item('FL','2002','Green',''))));
  const result = await new Ingestion(testContracts(),repository,[gdacs],new Gdelt(1000),rss,() => 1000).refresh('rss-gdacs-test');
  assert.equal(result.imported,2); assert.equal(result.located,1);
  assert.deepEqual(repository.writes.map(w => w.name),['upsert_articles','upsert_event_locations','mark_refresh']);
  const [articles,places] = repository.writes;
  assert.ok(articles!.rows.every(row => row.source_type === 'government_report' && row.license === 'CC BY 4.0' && row.attribution === 'Source: GDACS'));
  assert.ok(articles!.rows.every(row => row.verification_status === 'unreviewed' && Array.isArray(row.location_ids) && (row.location_ids as unknown[]).length === 0));
  assert.equal(places!.rows[0]!.article_url,'https://www.gdacs.org/report.aspx?eventid=2001&eventtype=EQ');
  assert.equal(places!.rows[0]!.id,'loc-gdacs-eq-2001');
  await assert.rejects(new Ingestion(testContracts(),new TestRepository(),[{...gdacs,source_type:'dataset'}],new Gdelt(1000),rss).refresh('rss-gdacs-test'),/source_type/);
});

const series = {id:'usgs-waterdata-test',provider:'usgs_waterdata',permitted:true,license:'U.S. Public Domain',
  license_url:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',attribution:'U.S. Geological Survey',
  monitoring_location_id:'USGS-03451500',parameter_code:'00060',statistic_id:'00011',expected_interval_seconds:900,backfill_days:7,
  series_id:'usgs-03451500-discharge-live',location_id:'loc-usgs-03451500',metric:'discharge',unit:'ft^3/s',
  title:'Test live series',description:'Test description.',missing_data_rule:'Gaps are not interpolated.',investigation_id:'inv-helene-asheville-2024'};
const feature = (time: string, value: string | null, extra: Record<string,unknown> = {}) => ({type:'Feature',properties:{
  time,value,unit_of_measure:'ft^3/s',approval_status:'Provisional',qualifier:null,monitoring_location_id:'USGS-03451500',parameter_code:'00060',statistic_id:'00011',...extra}});
const NOW = Date.parse('2026-10-18T01:00:00.000Z');

test('live series resume from stored coverage with a revision overlap and write one series batch',async () => {
  const repository = new TestRepository({freshness:[{datasets:[{series_id:'usgs-03451500-discharge-live',coverage_to:'2026-10-18T00:00:00.000Z'}]}]});
  let requested: URL | undefined;
  const provider = new UsgsWaterData(1000,async url => { requested = new URL(String(url)); return new Response(JSON.stringify({type:'FeatureCollection',features:[
    feature('2026-10-17T22:15:00+00:00','1150'),feature('2026-10-17T22:00:00+00:00',null),feature('2026-10-17T22:30:00+00:00','1140',{approval_status:'Approved',qualifier:'ICE'})]}));});
  const result = await new ObservationIngestion(repository,[series],provider,() => NOW).refresh('usgs-waterdata-test');
  assert.equal(requested!.origin+requested!.pathname,'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items');
  assert.equal(requested!.searchParams.get('time'),'2026-10-17T22:00:00.000Z/..','two-hour overlap before the newest stored reading');
  assert.equal(requested!.searchParams.get('monitoring_location_id'),'USGS-03451500');
  assert.equal(result.imported,3); assert.equal(result.newest,'2026-10-17T22:30:00.000Z');
  const write = repository.writes.find(w => w.name === 'upsert_observation_series')!.rows[0]!;
  assert.equal(write.id,'usgs-03451500-discharge-live'); assert.equal(write.source_id,'src-usgs-waterdata-03451500-00060-00011');
  assert.equal(write.provider_series_ref,'USGS:03451500:00060:00011'); assert.equal(write.investigation_id,'inv-helene-asheville-2024');
  assert.deepEqual(JSON.parse(String(write.readings)),[
    {observed_at:'2026-10-17T22:00:00.000Z',value:null,qualifiers:['P']},
    {observed_at:'2026-10-17T22:15:00.000Z',value:1150,qualifiers:['P']},
    {observed_at:'2026-10-17T22:30:00.000Z',value:1140,qualifiers:['A','ICE']}]);
  assert.equal(repository.writes.at(-1)!.rows[0]!.status,'success');
});
test('a new live series backfills a bounded window and an empty refresh writes no series row',async () => {
  const repository = new TestRepository({freshness:[{datasets:[]}]});
  let since = '';
  const provider = new UsgsWaterData(1000,async url => { since = new URL(String(url)).searchParams.get('time')!; return new Response(JSON.stringify({features:[]})); });
  const result = await new ObservationIngestion(repository,[series],provider,() => NOW).refresh('usgs-waterdata-test');
  assert.equal(since,'2026-10-11T01:00:00.000Z/..'); assert.equal(result.imported,0);
  assert.deepEqual(repository.writes.map(w => w.name),['mark_refresh']);
  await assert.rejects(new ObservationIngestion(repository,[{...series,backfill_days:90}],provider,() => NOW).refresh('usgs-waterdata-test'),/backfill_days/);
});
test('unit changes, foreign readings and provider failures never write readings and record backoff',async () => {
  for (const [body,pattern] of [
    [{features:[feature('2026-10-17T22:15:00+00:00','1150',{unit_of_measure:'m^3/s'})]},/unit differs/],
    [{features:[feature('2026-10-17T22:15:00+00:00','1150',{monitoring_location_id:'USGS-00000000'})]},/another series/],
    [{features:[feature('2026-10-17 22:15','1150')]},/reading time/],
    [{features:[feature('2026-10-17T22:15:00+00:00','high')]},/non-numeric/]
  ] as const) {
    const repository = new TestRepository({freshness:[{datasets:[]}]});
    await assert.rejects(new ObservationIngestion(repository,[series],new UsgsWaterData(1000,async () => new Response(JSON.stringify(body))),() => NOW).refresh('usgs-waterdata-test'),pattern);
    assert.deepEqual(repository.writes.map(w => w.name),['mark_refresh']);
    assert.equal(repository.writes[0]!.rows[0]!.status,'failed');
    assert.equal(repository.writes[0]!.rows[0]!.next_retry_at,new Date(NOW+900000).toISOString());
  }
  const backoff = new TestRepository({freshness:[{next_retry_at:'2026-10-18T02:00:00.000Z',datasets:[]}]});
  await assert.rejects(new ObservationIngestion(backoff,[series],new UsgsWaterData(1000,async () => { throw new Error('no request expected'); }),() => NOW).refresh('usgs-waterdata-test'),/backoff/);
  assert.equal(backoff.writes.length,0);
});
test('refresh-all runs sources in order, spaces GDELT requests, and keeps going after failures',async () => {
  let now = 0; const sleeps: number[] = [], order: string[] = [];
  const target = (id: string, provider: string, outcome: 'ok' | 'fail' | 'backoff') => ({id,provider,refresh:async () => {
    order.push(id); now += 1000;
    if (outcome === 'fail') throw new AppError('PROVIDER_RATE_LIMIT','Provider request failed',503,true);
    if (outcome === 'backoff') throw new AppError('INGESTION_BACKOFF','Source refresh is in backoff',429,true);
    return {source_id:id,imported:1};
  }});
  const results = await refreshAll([target('g1','gdelt','fail'),target('g2','gdelt','backoff'),target('g3','gdelt','ok'),target('r1','rss','ok'),target('u1','usgs_waterdata','ok')],
    {gdeltSpacingMs:6000,clock:() => now,sleep:async ms => { sleeps.push(ms); now += ms; }});
  assert.deepEqual(order,['g1','g2','g3','r1','u1']);
  assert.deepEqual(results.map(r => r.status),['failed','backoff','success','success','success']);
  // g1's request ended at t=1000 and g2 starts then, so g2 waits the full 6 s. g2 is skipped for backoff (no request),
  // and more than 6 s have passed since g1, so g3 starts without waiting. Non-GDELT sources never wait.
  assert.deepEqual(sleeps,[6000]);
  assert.equal((results[0]!.error as {code:string}).code,'PROVIDER_RATE_LIMIT');
});
