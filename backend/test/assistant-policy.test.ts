import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDateRange } from '../src/services/gemini/dates.js';
import { explicitCommand, mergeFilterPatch, permissions, clarification } from '../src/services/gemini/policy.js';

test('calendar periods use the user zone, Monday weeks, leap dates and month/year boundaries', () => {
  const now = Date.parse('2026-01-01T02:00:00Z'); // Still December in Toronto.
  assert.deepEqual(resolveDateRange('today', 'America/Toronto', now), {
    from: '2025-12-31T05:00:00.000Z', to: '2026-01-01T04:59:59.999Z',
    timezone: 'America/Toronto', label: '2025-12-31 through 2025-12-31 (America/Toronto)'
  });
  assert.equal(resolveDateRange('this month', 'America/Toronto', now).from, '2025-12-01T05:00:00.000Z');
  assert.equal(resolveDateRange('last month', 'UTC', now).from, '2025-12-01T00:00:00.000Z');
  assert.equal(resolveDateRange('this week', 'UTC', now).from, '2025-12-29T00:00:00.000Z');
  assert.equal(resolveDateRange('last week', 'UTC', now).to, '2025-12-28T23:59:59.999Z');
  assert.equal(resolveDateRange('past 2 days', 'UTC', now).from, '2025-12-31T00:00:00.000Z');
  assert.equal(resolveDateRange('2024-02-29', 'Asia/Kolkata', now).from, '2024-02-28T18:30:00.000Z');
});
test('DST calendar days have 23/25 hours and midnight transitions retain real local dates', () => {
  for (const [expression, hours] of [['2026-03-08', 23], ['2026-11-01', 25]] as const) {
    const result = resolveDateRange(expression, 'America/Toronto');
    assert.equal(Date.parse(result.to) - Date.parse(result.from) + 1, hours * 3600000);
  }
  assert.equal(resolveDateRange('2018-11-04', 'America/Sao_Paulo').from, '2018-11-04T03:00:00.000Z');
  assert.throws(() => resolveDateRange('2011-12-30', 'Pacific/Apia'), /does not exist/);
});
test('unsupported, invalid, reversed and overlong periods fail rather than inventing a range', () => {
  for (const expression of ['recently', '2026-02-30', '2026-04-02 to 2026-04-01', 'past 0 days', 'past 367 days', '2020-01-01 through 2026-01-01'])
    assert.throws(() => resolveDateRange(expression, 'UTC'));
  assert.throws(() => resolveDateRange('today', 'not-a-zone'), /IANA/);
});
test('only explicit current unquoted commands authorize their own action kinds', () => {
  for (const [message, action] of [['Show flooding news', 'set_filters'], ['Could you zoom to Asheville?', 'focus_location'], ['Open the timeline', 'open_timeline']])
    assert.equal(explicitCommand(message!, message!, action!), true);
  for (const [message, quote] of [
    ['Do not zoom to Asheville', 'zoom to Asheville'],
    ['Explain how to zoom to Asheville', 'zoom to Asheville'],
    ['What if I said show flooding news?', 'show flooding news'],
    ['The article says "Show flooding news"', 'Show flooding news'],
    ['`Show flooding news`', 'Show flooding news'],
    ['What about Asheville?', 'What about Asheville?'],
    ['Tell me about Asheville', 'Show flooding news']
  ]) assert.equal(explicitCommand(message!, quote!, quote!.startsWith('zoom') ? 'focus_location' : 'set_filters'), false);
  assert.equal(permissions({ message: 'Show flooding news', interaction_mode: 'read_only' },
    { actions: [{ type: 'set_filters', quote: 'Show flooding news' }] }).allowed.size, 0);
  assert.equal(permissions({ message: 'What about Toronto?' },
    { actions: [{ type: 'set_filters', quote: 'What about Toronto?' }] }).ambiguous, true);
});
test('filter patches preserve unnamed constraints, replace geography and reset pagination', () => {
  const current = { bounds: [-90, 30, -70, 50], themes: ['flooding'], keyword: 'water', limit: 20, offset: 40 };
  assert.deepEqual(mergeFilterPatch(current, { set: { location_ids: ['toronto'] }, clear: [] }, new Set(['location_ids']), new Set()),
    { location_ids: ['toronto'], themes: ['flooding'], keyword: 'water', limit: 20, offset: 0 });
  assert.deepEqual(mergeFilterPatch(current, { set: {}, clear: ['keyword'] }, new Set(['keyword']), new Set(['keyword'])),
    { bounds: [-90, 30, -70, 50], themes: ['flooding'], limit: 20, offset: 0 });
  assert.throws(() => mergeFilterPatch(current, { set: { themes: [] }, clear: [] }, new Set(['themes']), new Set()), /explicit clear/);
  assert.throws(() => mergeFilterPatch(current, { set: {}, clear: ['keyword'] }, new Set(['keyword']), new Set()), /explicit instruction/);
  assert.throws(() => mergeFilterPatch(current, { set: { entity_ids: ['new'] }, clear: [] }, new Set(['keyword']), new Set()), /authorize/);
  assert.throws(() => clarification('invented reason'), /Unsupported/);
});
