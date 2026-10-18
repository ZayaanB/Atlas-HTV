// Behavioral port tests, not replacements for Person 1's pending schemas.
// Actual shared compatibility is checked for legacy flights and the fail-closed
// area activation boundary; new wire payloads stay opaque in the port double.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import { Flights, type FlightProvider, type FlightSample } from '../src/services/flights.js';
import { Contracts, object, normalizeQuery, type Data } from '../src/services/validation.js';
import { AdsbLol } from '../src/data/providers/adsblol.js';
import { Retrieval } from '../src/services/retrieval.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import { deferred, testContracts, TestRepository } from './support.js';

class AreaContractPort extends Contracts {
  parsed: string[] = [];
  constructor() { super(testContracts().schemas); }
  override has(name: string) { return ['FlightAreaQuery', 'FlightAreaResponse'].includes(name) || super.has(name); }
  override parse(name: string, raw: unknown, output = false): Data {
    this.parsed.push(name);
    return ['FlightAreaQuery', 'FlightAreaResponse'].includes(name) ? object(raw) : super.parse(name, raw, output);
  }
}
const config = readConfig({ NODE_ENV: 'test', FLIGHTS_ENABLED: 'true', FLIGHTS_CONTACT: 'test@example.invalid' });
const initialTime = Date.parse('2026-01-01T00:00:00Z');
const area = { latitude: 43.71, longitude: -79.41, radius_nm: 97 };
const secondArea = { latitude: 40, longitude: -74, radius_nm: 100 };
const thirdArea = { latitude: 51.5, longitude: 0, radius_nm: 100 };
const aircraft = (now: number): Data => ({ id: 'abc123', observed_at: new Date(now).toISOString() });
function setup(adapter?: (region: Data, signal?: AbortSignal) => Promise<FlightSample>) {
  let now = initialTime;
  const calls: Data[] = [], contracts = new AreaContractPort();
  const provider: FlightProvider = {
    region: async region => { calls.push(region); return [aircraft(now)]; },
    area: async (region, signal) => { calls.push(region); return adapter ? adapter(region, signal) : { items: [aircraft(now)], truncated: false }; }
  };
  return { contracts, calls, flights: new Flights(contracts, config, [], provider, () => now), advance: (ms: number) => { now += ms; } };
}

test('nearby viewers coalesce into the reported canonical circle; no demand means no polling', async () => {
  const pending = deferred<FlightSample>(), entered = deferred<void>();
  const s = setup(async () => { entered.resolve(); return pending.promise; });
  try {
    const first = s.flights.area(area); await entered.promise;
    const second = s.flights.area({ latitude: 43.72, longitude: -79.42, radius_nm: 99 });
    assert.equal(s.calls.length, 1);
    pending.resolve({ items: [aircraft(initialTime)], truncated: true });
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.deepEqual(a.area, { id: 'area-43.7--79.4-100', latitude: 43.7, longitude: -79.4, radius_nm: 100 });
    assert.equal(a.status, 'ready'); assert.equal(a.truncated, true); assert.equal(a.stale, false);
    assert.ok(s.contracts.parsed.includes('FlightAreaQuery')); assert.ok(s.contracts.parsed.includes('FlightAreaResponse'));
    s.advance(600000); assert.equal(s.calls.length, 1);
  } finally { pending.resolve({ items: [], truncated: false }); await s.flights.close(); }
});

test('a queued area gets the next slot even when the busy viewer requests first', async () => {
  const s = setup();
  try {
    await s.flights.area(area);
    const waiting = await s.flights.area(secondArea);
    assert.equal(waiting.status, 'waiting'); assert.equal(waiting.fetched_at, null);
    assert.deepEqual(waiting.items, []); assert.equal(waiting.stale, true);
    assert.equal(Date.parse(String(waiting.retry_at)) - initialTime, 30000);
    s.advance(60000); await s.flights.area(area);
    assert.equal((await s.flights.area(secondArea)).status, 'ready');
    assert.equal(s.calls.length, 2); assert.equal(s.calls[1]!.latitude, secondArea.latitude);
    s.advance(30000); assert.equal((await s.flights.area(area)).stale, false); assert.equal(s.calls.length, 3);
  } finally { await s.flights.close(); }
});

test('two active areas enforce capacity with retry timing and idle areas can be replaced', async () => {
  const s = setup();
  try {
    await s.flights.area(area); await s.flights.area(secondArea);
    await assert.rejects(s.flights.area(thirdArea), error => {
      const e = error as { code: string; retryAfter: string; status: number };
      return e.code === 'FLIGHT_REGION_CAPACITY' && e.status === 429 && e.retryAfter === '120';
    });
    assert.equal(s.calls.length, 1); s.advance(120000);
    assert.equal((await s.flights.area(thirdArea)).status, 'ready');
    assert.equal(s.calls.length, 2); assert.equal(s.calls[1]!.latitude, thirdArea.latitude);
  } finally { await s.flights.close(); }
});

test('invalid coordinates and radii consume no provider capacity; poles and the date line are canonicalized', async () => {
  const s = setup();
  try {
    for (const raw of [
      { ...area, latitude: 91 }, { ...area, longitude: -181 }, { ...area, latitude: NaN },
      { ...area, radius_nm: 0 }, { ...area, radius_nm: 101 }, { ...area, radius_nm: 1.5 },
      { ...area, latitude: '43; DROP TABLE' }, { ...area, radius_nm: '1e2' }
    ]) await assert.rejects(s.flights.area(raw), /valid coordinates/);
    assert.equal(s.calls.length, 0);
    assert.deepEqual((await s.flights.area({ latitude: 90, longitude: 180, radius_nm: 1 })).area,
      { id: 'area-90--180-5', latitude: 90, longitude: -180, radius_nm: 5 });
  } finally { await s.flights.close(); }
});

test('provider throttling retains good samples, marks stale and backs off every area', async () => {
  let calls = 0;
  const s = setup(async () => {
    if (++calls === 1) return { items: [aircraft(initialTime)], truncated: false };
    throw Object.assign(new Error('private upstream detail'), { retryAfter: '600' });
  });
  try {
    await s.flights.area(area); s.advance(60000);
    const failed = await s.flights.area(area);
    assert.equal(failed.stale, true); assert.equal((failed.items as Data[]).length, 1);
    assert.ok(!String(failed.error).includes('private'));
    const waiting = await s.flights.area(secondArea);
    assert.equal(waiting.status, 'waiting'); assert.equal(s.calls.length, 2);
    assert.equal(Date.parse(String(waiting.retry_at)) - initialTime, 660000);
    s.advance(300001);
    const expired = await s.flights.area(area);
    assert.deepEqual(expired.items, []); assert.equal(expired.stale, true); assert.equal(s.calls.length, 2);
  } finally { await s.flights.close(); }
});

test('an initial failure has unavailable status and no invented observation time', async () => {
  for (const error of [new Error('offline'), null]) {
    const s = setup(async () => { throw error; });
    try {
      const result = await s.flights.area(area);
      assert.equal(result.status, 'unavailable'); assert.equal(result.fetched_at, null);
      assert.deepEqual(result.items, []); assert.equal(result.stale, true);
    } finally { await s.flights.close(); }
  }
});

test('observation age remains stale even when every point expires in a freshly fetched sample', async () => {
  const s = setup(async () => ({ items: [aircraft(initialTime - 300001)], truncated: false }));
  try {
    const result = await s.flights.area(area);
    assert.equal(result.status, 'ready'); assert.deepEqual(result.items, []);
    assert.equal(result.stale, true); assert.equal(result.fetched_at, new Date(initialTime).toISOString());
  } finally { await s.flights.close(); }
});

test('an oversized adapter batch cannot replace the previous good sample', async () => {
  let calls = 0;
  const s = setup(async () => ({ items: ++calls === 1 ? [aircraft(initialTime)] : Array.from({ length: 501 }, () => aircraft(initialTime)), truncated: false }));
  try {
    await s.flights.area(area); s.advance(60000);
    const result = await s.flights.area(area);
    assert.equal(result.fetched_at, new Date(initialTime).toISOString());
    assert.equal((result.items as Data[]).length, 1); assert.equal(result.stale, true);
  } finally { await s.flights.close(); }
});

test('viewer cancellation preserves the shared sample for another viewer', async () => {
  const pending = deferred<FlightSample>(), entered = deferred<void>();
  const s = setup(async () => { entered.resolve(); return pending.promise; });
  const controller = new AbortController();
  try {
    const first = s.flights.area(area, controller.signal); await entered.promise;
    const second = s.flights.area(area);
    controller.abort(); await assert.rejects(first, /cancelled/);
    pending.resolve({ items: [], truncated: false });
    assert.equal((await second).status, 'ready'); assert.equal(s.calls.length, 1);
  } finally { pending.resolve({ items: [], truncated: false }); await s.flights.close(); }
});

test('shutdown cancels an area adapter even if it ignores cancellation', { timeout: 2000 }, async () => {
  const entered = deferred<void>(); let signal: AbortSignal | undefined;
  const s = setup(async (_region, providerSignal) => { signal = providerSignal; entered.resolve(); return new Promise(() => {}); });
  const pending = s.flights.area(area); await entered.promise; await s.flights.close();
  assert.equal((await pending).status, 'unavailable'); assert.equal(signal?.aborted, true);
  await assert.rejects(s.flights.area(area), /closing/);
});

test('ADSB identity, zero values, ground/unknown state and newest duplicates normalize correctly', async () => {
  const rows = [
    { hex: 'ABC123', lat: 43.7, lon: -79.4, seen_pos: 10, flight: ' OLDER ', r: 'OLD', t: 'OLD', alt_baro: 100, gs: 10, track: 90 },
    { hex: 'ABC123', lat: 43.7, lon: -79.4, seen_pos: 0, flight: ' NEW ', r: ' C-TEST ', t: ' B738 ', alt_baro: 'ground', gs: 0, track: 0 },
    { hex: 'ABC124', lat: 43.7, lon: -79.4, seen_pos: 2, alt_baro: 0, gs: -10, track: 999 },
    { hex: 'ABC125', lat: 43.7, lon: -79.4, seen_pos: 2, r: '\nBAD', t: 'X'.repeat(17) },
    { hex: 'ABC126', lat: 0, lon: 0, seen_pos: 0 },
    { hex: 'ABC127', lat: 43.7, lon: -79.4, seen_pos: 301 },
    { hex: '~abc12', lat: 43.7, lon: -79.4, seen_pos: 0 }
  ];
  const provider = new AdsbLol(new AreaContractPort(), 1000, 'test@example.invalid', async () => new Response(JSON.stringify({ now: initialTime, ac: rows })), () => initialTime);
  const sample = await provider.area({ id: 'test', latitude: 43.7, longitude: -79.4, radius_nm: 100 });
  assert.equal(sample.items.length, 3); assert.equal(sample.truncated, false);
  const [ground, airborne, unknown] = sample.items;
  assert.equal(ground!.callsign, 'NEW'); assert.equal(ground!.registration, 'C-TEST'); assert.equal(ground!.aircraft_type, 'B738');
  assert.equal(ground!.operator, null); assert.equal(ground!.on_ground, true); assert.equal(ground!.altitude, null);
  assert.equal(ground!.speed, 0); assert.equal(ground!.heading, 0); assert.equal(ground!.observed_at, new Date(initialTime).toISOString());
  assert.equal(airborne!.on_ground, false); assert.equal(airborne!.altitude, 0); assert.equal(airborne!.speed, null); assert.equal(airborne!.heading, null);
  assert.equal(unknown!.on_ground, null); assert.equal(unknown!.registration, null); assert.equal(unknown!.aircraft_type, null);
});

test('ADSB truncation is explicit; invalid clocks and oversized responses are rejected', async () => {
  const region = { id: 'test', latitude: 0, longitude: 0, radius_nm: 100 };
  const rows = Array.from({ length: 501 }, (_, i) => ({ hex: i.toString(16).padStart(6, '0'), lat: 0, lon: 0, seen_pos: 0 }));
  const provider = (payload: Data) => new AdsbLol(new AreaContractPort(), 1000, 'test@example.invalid', async () => new Response(JSON.stringify(payload)), () => initialTime);
  const result = await provider({ now: initialTime, ac: rows }).area(region);
  assert.equal(result.items.length, 500); assert.equal(result.truncated, true);
  assert.equal((await provider({ now: initialTime, ac: [], total: 1 }).area(region)).truncated, true);
  for (const now of [null, String(initialTime), initialTime / 1000, initialTime + 30001, initialTime - 3600001])
    await assert.rejects(provider({ now, ac: [] }).area(region), /epoch|clock/);
  const oversized = new AdsbLol(new AreaContractPort(), 1000, 'test@example.invalid', async () => new Response('x'.repeat(2000001)), () => initialTime);
  await assert.rejects(oversized.area(region), /safety bound/);
});

test('HTTP normalizes decimals, exposes capacity Retry-After and preserves error envelopes', async () => {
  const s = setup(), repository = new TestRepository(), retrieval = new Retrieval(s.contracts, repository);
  const app = await buildApp(config, { contracts: s.contracts, repository, retrieval, flights: s.flights, assistant: new Assistant(config, s.contracts, retrieval, s.flights) });
  try {
    const first = await app.inject({ url: '/api/flights/area?latitude=43.71&longitude=-79.41&radius_nm=97' });
    assert.equal(first.statusCode, 200); assert.equal(first.json().status, 'ready');
    await app.inject({ url: '/api/flights/area?latitude=40&longitude=-74&radius_nm=100' });
    const capacity = await app.inject({ url: '/api/flights/area?latitude=51.5&longitude=0&radius_nm=100' });
    assert.equal(capacity.statusCode, 429); assert.equal(capacity.headers['retry-after'], '120');
    assert.equal(capacity.json().error.code, 'FLIGHT_REGION_CAPACITY'); assert.equal(capacity.json().error.retryable, true);
    const invalid = await app.inject({ url: '/api/flights/area?latitude=4e1&longitude=-74&radius_nm=100' });
    assert.equal(invalid.statusCode, 400); assert.equal(s.calls.length, 1);
    assert.deepEqual(normalizeQuery({ latitude: '', longitude: ' ', radius_nm: '0x64' }), { latitude: '', longitude: ' ', radius_nm: '0x64' });
  } finally { await app.close(); }
});

test('actual shared contracts validate legacy and area samples; missing area schemas still fail closed', async () => {
  const { contracts } = await loadHandoffs(readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' }));
  let calls = 0;
  const provider = new AdsbLol(contracts, 1000, 'test@example.invalid', async () => {
    calls++; return new Response(JSON.stringify({ now: initialTime, ac: [{ hex: 'abc123', lat: 43.7, lon: -79.4, seen_pos: 0 }] }));
  }, () => initialTime);
  const region = { id: 'test', latitude: 43.7, longitude: -79.4, radius_nm: 10 };
  const flights = new Flights(contracts, config, [region], provider, () => initialTime);
  try {
    assert.equal((await flights.get({ region_id: 'test' })).stale, false); assert.equal(calls, 1);
    assert.equal(flights.areaAvailable, true);
    const sample = await provider.area({ ...region, radius_nm: 100 });
    const aircraft = sample.items[0]!;
    assert.equal(aircraft.registration, null); assert.equal(aircraft.operator, null); assert.equal(aircraft.on_ground, null);
    contracts.parse('FlightAreaResponse', {
      area: region, ...sample, fetched_at: new Date(initialTime).toISOString(), status: 'ready', stale: false,
      mode: 'live', replay: false, attribution: 'Synthetic contract integration sample',
      retry_at: new Date(initialTime + 60000).toISOString(), error: null
    }, true);
    const oldContracts = new Contracts(Object.fromEntries(Object.entries(contracts.schemas)
      .filter(([name]) => !['FlightAreaQuery', 'FlightAreaResponse'].includes(name))));
    const oldFlights = new Flights(oldContracts, config, [], provider, () => initialTime);
    try {
      assert.equal(oldFlights.areaAvailable, false);
      await assert.rejects(oldFlights.area(area), error => (error as { code: string }).code === 'CONTRACTS_UNAVAILABLE');
      assert.equal(calls, 2);
    } finally { await oldFlights.close(); }
  } finally { await flights.close(); }
});
