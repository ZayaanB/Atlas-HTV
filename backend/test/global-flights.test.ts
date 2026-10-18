import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AirLabs } from '../src/data/providers/airlabs.js';
import { FileFlightBudget } from '../src/services/flight-budget.js';
import { GlobalFlights } from '../src/services/global-flights.js';
import { Contracts, object, type Data } from '../src/services/validation.js';
import { readConfig } from '../src/config.js';
import { deferred, testContracts, TestRepository } from './support.js';
import { Flights } from '../src/services/flights.js';
import { Retrieval } from '../src/services/retrieval.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import { buildApp } from '../src/app.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import type { FlightSample } from '../src/services/flights.js';

// Behavioral port only: shared schema integration belongs to Person 1.
class GlobalPort extends Contracts {
  constructor() { super(testContracts().schemas); }
  override has(name: string) { return ['AircraftState', 'FlightGlobalResponse'].includes(name) || super.has(name); }
  override parse(name: string, raw: unknown, output = false) { return ['AircraftState', 'FlightGlobalResponse'].includes(name) ? object(raw) : super.parse(name, raw, output); }
}
const epoch = Date.parse('2026-10-18T04:00:00Z');
const row = (extra: Data = {}) => ({ hex: 'abc123', lat: 43, lng: -79, updated: epoch / 1000, status: 'en-route', ...extra });
const item = (time: number, id = 'abc123'): Data => ({ id, coordinates: [-79,43], observed_at: new Date(time).toISOString(), callsign: 'ABC1', flight_iata: null });

test('AirLabs selects fresh en-route aircraft, deduplicates newest observation and never returns account metadata', async () => {
  let request = '';
  const adapter = new AirLabs(new GlobalPort(), 'synthetic-secret', 1000, async url => {
    request = String(url);
    return new Response(JSON.stringify({ request: { key: 'synthetic-secret' }, response: [
      row({ updated: epoch / 1000 - 10 }), row({ alt: 1000, dir: 0, flight_iata: 'AB1', dep_iata: 'YYZ', arr_iata: 'YVR' }),
      row({ hex: 'abc124', status: 'landed' }), row({ hex: 'abc125', status: 'scheduled' }),
      row({ hex: 'abc126', updated: epoch / 1000 - 301 }), row({ hex: 'abc127', lat: 91 }),
      row({ hex: 'abc128', updated: epoch / 1000 + 31 }), row({ hex: 'bad' }), row({ hex: 'abc129', updated: null })
    ] }));
  }, () => epoch);
  const sample = await adapter.snapshot(new AbortController().signal);
  assert.equal(new URL(request).searchParams.get('api_key'), 'synthetic-secret');
  assert.equal(new URL(request).searchParams.has('bbox'), false); assert.equal(new URL(request).searchParams.has('zoom'), false);
  assert.equal(sample.items.length, 1);
  const a = sample.items[0]!;
  assert.equal(a.altitude, 1000); assert.equal(a.altitude_unit, 'm'); assert.equal(a.altitude_reference, 'unknown');
  assert.equal(a.speed, null); assert.equal(a.heading, 0); assert.equal(a.direction_kind, 'direction');
  assert.equal(a.departure_iata, 'YYZ'); assert.equal(a.arrival_iata, 'YVR');
  assert.equal(a.observed_at, new Date(epoch).toISOString());
  assert.ok(!JSON.stringify(sample).includes('synthetic-secret'));
});

test('AirLabs handles HTTP/envelope errors safely and bounds response size', async () => {
  for (const [response, code] of [
    [new Response('secret key in body', { status: 403 }), 'PROVIDER_UNAVAILABLE'],
    [new Response(JSON.stringify({ error: { code: 'usage_limit', message: 'private' } })), 'AIRLABS_QUOTA'],
    [new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'private' } })), 'AIRLABS_AUTH'],
    [new Response(JSON.stringify({ response: null })), 'INVALID_FLIGHT_DATA'],
    [new Response('', { headers: { 'content-length': '16000001' } }), 'PROVIDER_TOO_LARGE']
  ] as const) {
    const adapter = new AirLabs(new GlobalPort(), 'secret', 1000, async () => response, () => epoch);
    await assert.rejects(adapter.snapshot(new AbortController().signal), e => {
      assert.equal((e as { code: string }).code, code); assert.ok(!String(e).includes('private')); assert.ok(!String(e).includes('secret')); return true;
    });
  }
});

function setup(provider?: (signal: AbortSignal) => Promise<FlightSample>, budget?: {reserve(): Promise<void>}) {
  let now = epoch, calls = 0, attempts = 0;
  const service = new GlobalFlights(new GlobalPort(), { snapshot: async signal => {
    calls++; return provider ? provider(signal) : { items: [item(now)], truncated: false };
  } }, budget ?? { reserve: async () => { attempts++; } }, () => now);
  return { service, calls: () => calls, attempts: () => attempts, advance: (ms: number) => { now += ms; } };
}

test('global viewers coalesce; requests before five minutes and idle time spend no quota; trails are shared', async () => {
  const pending = deferred<FlightSample>();
  let first = true;
  const s = setup(async () => first ? (first = false, pending.promise) : ({ items: [item(epoch + 300000)], truncated: false }));
  try {
    const a = s.service.get(), b = s.service.get();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(s.calls(), 1); assert.equal(s.attempts(), 1);
    pending.resolve({ items: [item(epoch)], truncated: false });
    assert.deepEqual(await a, await b);
    s.advance(299999); await s.service.get(); assert.equal(s.calls(), 1);
    s.advance(1); const result = await s.service.get(); assert.equal(s.calls(), 2);
    assert.equal(((result.trails as Data[])[0]!.points as Data[]).length, 2);
    s.advance(1800000); assert.equal(s.calls(), 2);
  } finally { await s.service.close(); }
});

test('failure keeps last snapshot, expires markers by observation age, and honors provider retry', async () => {
  let count = 0;
  const s = setup(async () => {
    if (++count === 1) return { items: [item(epoch)], truncated: false };
    throw Object.assign(new Error('private provider text'), { retryAfter: '900' });
  });
  try {
    await s.service.get(); s.advance(300000);
    const failed = await s.service.get();
    assert.equal(failed.stale, true); assert.equal((failed.items as Data[]).length, 1);
    assert.equal(Date.parse(String(failed.retry_at)), epoch + 1200000);
    assert.ok(!String(failed.error).includes('private'));
    s.advance(300001); assert.equal(((await s.service.get()).items as Data[]).length, 0); assert.equal(s.calls(), 2);
  } finally { await s.service.close(); }
});

test('quota/auth/ledger errors pause permanently without exposing details or retrying', async () => {
  for (const [code, reason] of [['FLIGHT_QUOTA','quota'], ['AIRLABS_AUTH','authentication'], ['FLIGHT_LEDGER','configuration']]) {
    let attempts = 0;
    const s = setup(undefined, { reserve: async () => { attempts++; throw Object.assign(new Error('private'), { code }); } });
    try {
      const result = await s.service.get(); assert.equal(result.pause_reason, reason); assert.equal(result.retry_at, null);
      assert.equal(result.status, 'unavailable'); s.advance(86400000); await s.service.get(); assert.equal(attempts, 1); assert.equal(s.calls(), 0);
    } finally { await s.service.close(); }
  }
});

test('missing schemas fail before budget and cancelled viewer does not cancel shared provider', async () => {
  let attempts = 0;
  const absent = new GlobalFlights(new Contracts(), { snapshot: async () => ({ items: [], truncated: false }) }, { reserve: async () => { attempts++; } });
  await assert.rejects(absent.get(), /contracts/); assert.equal(attempts, 0); await absent.close();
  const pending = deferred<FlightSample>(), entered = deferred<void>();
  const s = setup(async () => { entered.resolve(); return pending.promise; });
  const controller = new AbortController();
  const first = s.service.get(controller.signal); await entered.promise;
  const second = s.service.get(); controller.abort(); await assert.rejects(first, /cancelled/);
  pending.resolve({ items: [item(epoch)], truncated: false });
  assert.equal((await second).status, 'ready'); assert.equal(s.calls(), 1); await s.service.close();
});

test('shutdown bounds an uncooperative provider', { timeout: 1000 }, async () => {
  const entered = deferred<void>(); let signal: AbortSignal | undefined;
  const s = setup(async providerSignal => { signal = providerSignal; entered.resolve(); return new Promise(() => {}); });
  const result = s.service.get(); await entered.promise; await s.service.close(); await result;
  assert.equal(signal?.aborted, true); await assert.rejects(s.service.get(), /closing/);
});

test('persistent budget counts attempts across instances and rejects corruption/locks without calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-budget-'));
  try {
    await new FileFlightBudget(directory, 2).reserve(); await new FileFlightBudget(directory, 2).reserve();
    await assert.rejects(new FileFlightBudget(directory, 2).reserve(), /exhausted/);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'usage.json'), 'utf8')), { attempts: 2 });
    await writeFile(join(directory, 'usage.json'), 'broken');
    await assert.rejects(new FileFlightBudget(directory).reserve(), /unavailable/);
    await writeFile(join(directory, 'lock'), '');
    await assert.rejects(new FileFlightBudget(directory).reserve(), /unavailable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('AirLabs configuration does not require ADSB contact and never guesses provider selection', () => {
  assert.throws(() => readConfig({ FLIGHTS_ENABLED: 'true', FLIGHTS_PROVIDER: 'airlabs' }), /AIRLABS_API_KEY/);
  const config = readConfig({ FLIGHTS_ENABLED: 'true', FLIGHTS_PROVIDER: 'airlabs', AIRLABS_API_KEY: 'synthetic' });
  assert.equal(config.flightsContact, undefined); assert.equal(config.flightsProvider, 'airlabs');
  assert.equal(readConfig({ AIRLABS_API_KEY: 'synthetic' }).flightsProvider, 'adsb.lol');
  assert.throws(() => readConfig({ FLIGHTS_PROVIDER: 'unknown' }), /FLIGHTS_PROVIDER/);
});

test('normalization preserves global batches at 7,500 and 25,000, and reports safety truncation', async () => {
  for (const size of [7500,25000,25001]) {
    const adapter = new AirLabs(new GlobalPort(), 'synthetic', 1000, async () => new Response(JSON.stringify({
      response: Array.from({ length: size }, (_, i) => row({ hex: i.toString(16).padStart(6, '0') }))
    })), () => epoch);
    const result = await adapter.snapshot(new AbortController().signal);
    assert.equal(result.items.length, Math.min(25000, size)); assert.equal(result.truncated, size > 25000);
  }
});

test('history deduplicates observation times and retains only the last thirty minutes', async () => {
  let observed = epoch;
  const s = setup(async () => ({ items: [item(observed)], truncated: false }));
  try {
    await s.service.get(); s.advance(300000);
    let result = await s.service.get();
    assert.equal(((result.trails as Data[])[0]!.points as Data[]).length, 1);
    for (let i = 2; i <= 8; i++) {
      observed = epoch + i * 300000; s.advance(300000); result = await s.service.get();
    }
    const points = (result.trails as Data[])[0]!.points as Data[];
    assert.equal(points.length, 7); assert.equal(points[0]!.observed_at, new Date(epoch + 600000).toISOString());
  } finally { await s.service.close(); }
});


test('global HTTP endpoint rejects viewport parameters and sets no-store; old contract registry spends nothing', async () => {
  const config = readConfig({ NODE_ENV: 'test', FLIGHTS_ENABLED: 'true', FLIGHTS_PROVIDER: 'airlabs', AIRLABS_API_KEY: 'synthetic' });
  const contracts = new GlobalPort(), repository = new TestRepository(), retrieval = new Retrieval(contracts, repository);
  let attempts = 0;
  const global = new GlobalFlights(contracts, { snapshot: async () => ({ items: [item(epoch)], truncated: false }) }, { reserve: async () => { attempts++; } }, () => epoch);
  const flights = new Flights(contracts, config, [], undefined, () => epoch, global);
  const app = await buildApp(config, { contracts, repository, retrieval, flights, assistant: new Assistant(config, contracts, retrieval, flights) });
  try {
    const invalid = await app.inject({ url: '/api/flights/global?latitude=43' });
    assert.equal(invalid.statusCode, 400); assert.equal(attempts, 0);
    const response = await app.inject({ url: '/api/flights/global' });
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().items.length, 1); assert.equal(attempts, 1);
    assert.equal(flights.areaAvailable, false); assert.equal(flights.globalAvailable, true);
  } finally { await app.close(); }
  const actual = await loadHandoffs(readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' }));
  const missing = new GlobalFlights(actual.contracts, { snapshot: async () => { throw new Error('must not call'); } }, { reserve: async () => { attempts++; } });
  try {
    if (!actual.contracts.has('FlightGlobalResponse')) {
      assert.equal(missing.available, false);
      await assert.rejects(missing.get(), e => (e as {code: string}).code === 'CONTRACTS_UNAVAILABLE');
      assert.equal(attempts, 1);
    }
  } finally { await missing.close(); }
});
