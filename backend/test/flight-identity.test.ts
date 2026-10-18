import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { AdsbLol } from '../src/data/providers/adsblol.js';
import { flightUserAgent } from '../src/data/providers/flight-identity.js';
import { testContracts } from './support.js';

test('enabled flights require a contact; email and HTTPS contacts are accepted', () => {
  assert.equal(readConfig({ NODE_ENV: 'test' }).flightsContact, undefined);
  assert.throws(() => readConfig({ FLIGHTS_ENABLED: 'true' }), /FLIGHTS_CONTACT/);
  for (const contact of ['test@example.invalid', 'https://example.invalid/contact']) {
    const config = readConfig({ FLIGHTS_ENABLED: 'true', FLIGHTS_CONTACT: contact });
    assert.equal(config.flightsContact, contact);
    assert.equal(flightUserAgent(config.flightsContact), `Atlas/0.1 (contact: ${contact})`);
  }
});

test('bad contacts and header injection fail with safe configuration messages', () => {
  for (const contact of ['', 'node', 'user@', ' https://example.invalid', 'http://example.invalid',
    'https://user:password@example.invalid', 'test@example.invalid\r\nX-Test: injected',
    'test@example.invalid\t', 'test@example.invalid)', 'https://example.invalid/é', 'a'.repeat(513)]) {
    assert.throws(() => readConfig({ FLIGHTS_ENABLED: 'true', FLIGHTS_CONTACT: contact }), error => {
      const e = error as { code: string; message: string };
      return e.code === 'CONFIG_INVALID' && e.message.includes('FLIGHTS_CONTACT') && !e.message.includes('injected') && !e.message.includes('password');
    });
    assert.throws(() => flightUserAgent(contact), /FLIGHTS_CONTACT/);
  }
  assert.throws(() => new AdsbLol(testContracts(), 1000, ''), /FLIGHTS_CONTACT/);
});

test('both flight requests send the configured identity without returning contact in aircraft data', async () => {
  const now = Date.parse('2026-10-18T04:00:00Z'), observedHeaders: Headers[] = [];
  const config = readConfig({ FLIGHTS_ENABLED: 'true', FLIGHTS_CONTACT: 'test@example.invalid' });
  const adapter = new AdsbLol(testContracts(), 1000, config.flightsContact!, async (url, options) => {
    assert.equal(String(url), 'https://api.adsb.lol/v2/point/43.7/-79.4/100');
    observedHeaders.push(new Headers(options?.headers));
    return new Response(JSON.stringify({ now, ac: [{ hex: 'abc123', lat: 43.7, lon: -79.4, seen_pos: 0 }] }));
  }, () => now);
  const area = { id: 'test', latitude: 43.7, longitude: -79.4, radius_nm: 100 };
  const legacy = await adapter.region(area), sample = await adapter.area(area);
  assert.equal(legacy.length, 1); assert.equal(sample.items.length, 1);
  assert.equal(observedHeaders.length, 2);
  for (const headers of observedHeaders) {
    assert.equal(headers.get('user-agent'), 'Atlas/0.1 (contact: test@example.invalid)');
    assert.equal(headers.get('accept'), 'application/json');
  }
  assert.ok(!JSON.stringify([legacy, sample]).includes('test@example.invalid'));
});
