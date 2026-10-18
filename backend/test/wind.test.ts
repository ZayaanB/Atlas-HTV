import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemas, type WindSample } from '../../contracts/dist/index.js';
import { Contracts } from '../src/services/validation.js';
import { Wind, windPoints } from '../src/services/wind.js';
import { OpenMeteo } from '../src/data/providers/open-meteo.js';
import { createServices } from '../src/runtime/services.js';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { deferred } from './support.js';

const query = { bounds: [-80, 43, -79, 44] as [number, number, number, number] };
const initial = Date.parse('2026-10-18T12:00:00Z');
const contracts = () => new Contracts(schemas);
const sample = (time = initial): WindSample => ({
  id: 'synthetic-wind', coordinates: [-79.5, 43.5], model_coordinates: [-79.49, 43.51],
  speed_kmh: 12, direction_from_degrees: 270, valid_at: new Date(time).toISOString(),
});

test('wind grid is bounded, covers the antimeridian, and rejects empty/malformed requests before access', async () => {
  const points = windPoints([170, -10, -170, 10]);
  assert.equal(points.length, 9);
  assert.deepEqual(points.map(point => point[0]).slice(0, 3), [174, -180, -174]);
  const wind = new Wind(contracts(), 100);
  for (const bounds of [[0, 0, 0, 1], [0, 1, 1, 0], [-181, 0, 10, 1], [0, 0, 1]])
    await assert.rejects(wind.get({ bounds }), error => ['INVALID_INPUT', 'INVALID_BOUNDS'].includes((error as { code: string }).code));
  await assert.rejects(wind.get(query), { code: 'WIND_DISABLED' });
  await wind.close();
});

test('Open-Meteo uses the fixed bounded endpoint, UTC/model times, explicit units and nulls', async () => {
  const points = windPoints(query.bounds);
  const rows = points.map(point => ({ latitude: point[1] + 0.01, longitude: point[0] + 0.01, utc_offset_seconds: 0,
    current_units: { time: 'unixtime', wind_speed_10m: 'km/h', wind_direction_10m: '°' },
    current: { time: initial / 1000, wind_speed_10m: 12, wind_direction_10m: 270 as number | null } }));
  rows[0]!.current.wind_direction_10m = null;
  const provider = new OpenMeteo(async input => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
    assert.equal(url.searchParams.get('latitude')!.split(',').length, 9);
    assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
    assert.equal(url.searchParams.get('timeformat'), 'unixtime');
    return new Response(JSON.stringify(rows));
  });
  const result = await provider.samples(points, new AbortController().signal);
  assert.equal(result[0]!.direction_from_degrees, null);
  assert.deepEqual(result[0]!.coordinates, points[0]);
  assert.notDeepEqual(result[0]!.model_coordinates, points[0]);
  assert.equal(result[0]!.valid_at, '2026-10-18T12:00:00.000Z');
  rows[0]!.current_units.wind_speed_10m = 'mph';
  await assert.rejects(provider.samples(points, new AbortController().signal), { code: 'INVALID_PROVIDER_DATA' });
  const oversized = new OpenMeteo(async () => new Response('x'.repeat(65537)));
  await assert.rejects(oversized.samples(points, new AbortController().signal), { code: 'PROVIDER_TOO_LARGE' });
});

test('cache coalesces viewers, preserves a shared request when one disconnects, and never polls itself', async () => {
  let now = initial, calls = 0;
  const pending = deferred<WindSample[]>();
  const wind = new Wind(contracts(), 1000, { samples: async () => { calls++; return pending.promise; } }, () => now);
  const cancelled = new AbortController();
  const first = wind.get(query, cancelled.signal), second = wind.get(query);
  cancelled.abort();
  await assert.rejects(first, { code: 'REQUEST_CANCELLED' });
  pending.resolve([sample()]);
  const data = await second;
  assert.equal(data.kind, 'model_estimate');
  assert.equal(data.stale, false);
  assert.equal(calls, 1);
  await wind.get(query);
  assert.equal(calls, 1);
  now += 1000;
  await assert.rejects(wind.get({ bounds: [-79, 43, -78, 44] }), { code: 'WIND_RATE_LIMIT' });
  now += 16 * 60000;
  assert.equal(calls, 1); // Advancing time alone causes no request.
  await wind.close();
});

test('failure/backoff retains clearly stale samples, and expiry removes unusable data', async () => {
  let now = initial, calls = 0;
  const wind = new Wind(contracts(), 1000, { samples: async () => {
    if (++calls > 1) throw Object.assign(new Error('provider failure'), { retryAfter: '300' });
    return [sample()];
  } }, () => now);
  await wind.get(query);
  now += 15 * 60000;
  const stale = await wind.get(query);
  assert.equal(stale.stale, true);
  assert.match(stale.warning!, /out of date/);
  assert.equal(stale.items.length, 1);
  now += 60000;
  await wind.get(query);
  assert.equal(calls, 2);
  now += 60 * 60000;
  await assert.rejects(wind.get(query), { code: 'WIND_UNAVAILABLE' });
  await wind.close();
});

test('rolling daily budget counts nine locations per batch', async () => {
  let now = initial, calls = 0;
  const wind = new Wind(contracts(), 1000, { samples: async () => { calls++; return []; } }, () => now);
  for (let i = 0; i < 1000; i++) {
    now += 10001;
    await wind.get({ bounds: [-80 + i / 10000, 43, -79 + i / 10000, 44] });
  }
  now += 10001;
  await assert.rejects(wind.get(query), { code: 'WIND_RATE_LIMIT' });
  assert.equal(calls, 1000);
  await wind.close();
});

test('HTTP endpoint validates query and response using the shared contracts', async () => {
  const config = readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' });
  const services = await createServices(config);
  await services.wind!.close();
  let calls = 0;
  services.wind = new Wind(services.contracts, 1000, { samples: async () => { calls++; return [sample(Date.now())]; } });
  const app = await buildApp(config, services);
  try {
    const invalid = await app.inject('/api/wind?bounds=bad');
    assert.equal(invalid.statusCode, 400);
    assert.equal((await app.inject('/api/wind?bounds=,43,-79,44')).statusCode, 400);
    assert.equal((await app.inject('/api/wind?bounds=0x10,43,-79,44')).statusCode, 400);
    assert.equal(calls, 0);
    const response = await app.inject('/api/wind?bounds=-80,43,-79,44');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items[0].speed_kmh, 12);
    assert.equal(response.json().provider, 'open-meteo');
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
