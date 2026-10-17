import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { Flights } from '../src/services/flights.js';
import { AdsbLol } from '../src/data/providers/adsblol.js';
import { testContracts } from './support.js';
const region = {id:'test-region',latitude:0,longitude:0,radius_nm:10};
test('concurrent viewers coalesce, global polling is bounded and old samples are marked stale',async () => {
  let now = Date.parse('2026-01-01T00:00:00Z'), calls = 0;
  const flights = new Flights(testContracts(),readConfig({NODE_ENV:'test',FLIGHTS_ENABLED:'true',FLIGHTS_REFRESH_INTERVAL_MS:'30000',FLIGHTS_STALE_AFTER_MS:'40000'}),[region,{...region,id:'other-region'}],{region:async () => {
    calls++; return [{id:'test-aircraft',observed_at:new Date(now).toISOString()}];
  }},() => now);
  await Promise.all([flights.get({region_id:'test-region'}),flights.get({region_id:'test-region'})]);
  assert.equal(calls,1);
  await flights.get({region_id:'test-region'}); assert.equal(calls,1);
  await assert.rejects(flights.get({region_id:'other-region'}),/backoff/); assert.equal(calls,1);
  // No interval/automatic polling occurs when the clock advances.
  now += 45000; assert.equal(calls,1);
  const fresh = await flights.get({region_id:'test-region'}); assert.equal(fresh.stale,false); assert.equal(calls,2);
});
test('provider failure keeps cached positions, shares backoff and hides expired observations',async () => {
  let now = Date.parse('2026-01-01T00:00:00Z'), calls = 0;
  const flights = new Flights(testContracts(),readConfig({NODE_ENV:'test',FLIGHTS_ENABLED:'true',FLIGHTS_REFRESH_INTERVAL_MS:'30000',FLIGHTS_STALE_AFTER_MS:'30000',FLIGHTS_CACHE_TTL_MS:'100000'}),[region],{region:async () => {
    calls++; if (calls > 1) throw Object.assign(new Error('quota'),{retryAfter:'120'});
    return [{id:'test-aircraft',observed_at:new Date(now).toISOString()}];
  }},() => now);
  await flights.get({region_id:'test-region'});
  now += 31000;
  const stale = await flights.get({region_id:'test-region'});
  assert.equal(stale.stale,true); assert.equal((stale.items as unknown[]).length,1);
  now += 31000; await flights.get({region_id:'test-region'}); assert.equal(calls,2);
  now += 40000;
  assert.deepEqual((await flights.get({region_id:'test-region'})).items,[]); assert.equal(calls,2);
});
test('unknown regions, disabled access and region capacity are controlled errors',async () => {
  const disabled = new Flights(testContracts(),readConfig({NODE_ENV:'test'}),[region]);
  await assert.rejects(disabled.get({region_id:region.id}),/disabled/);
  const flights = new Flights(testContracts(),readConfig({NODE_ENV:'test',FLIGHTS_ENABLED:'true',FLIGHTS_MAX_ACTIVE_REGIONS:'1'}),[region,{...region,id:'other'}],{region:async () => []});
  await assert.rejects(flights.get({region_id:'unknown'}),/bounded region/);
  await flights.get({region_id:region.id});
  await assert.rejects(flights.get({region_id:'other'}),/limit reached/);
});
test('ADSB v2 milliseconds, seen_pos, units and geographic bounds are normalized',async () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const provider = new AdsbLol(testContracts(),1000,async (url) => {
    assert.equal(String(url),'https://api.adsb.lol/v2/point/0/0/10');
    return new Response(JSON.stringify({now,ac:[{hex:'ABC123',lat:0,lon:0,seen_pos:3,alt_baro:'ground',gs:0,flight:' TEST1 '},
      {hex:'ABC124',lat:50,lon:50,seen_pos:1},{hex:'ABC125',lat:0,lon:0,seen_pos:500}]}));
  },() => now);
  const items = await provider.region(region);
  assert.equal(items.length,1); assert.equal(items[0]!.observed_at,new Date(now-3000).toISOString());
  assert.deepEqual(items[0]!.coordinates,[0,0]); assert.equal(items[0]!.altitude,null); assert.equal(items[0]!.speed_unit,'kn');
  await assert.rejects(provider.region({...region,radius_nm:101}),/1–100/);
});
