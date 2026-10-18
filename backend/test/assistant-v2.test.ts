import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { readConfig } from '../src/config.js';
import { Contracts, type Data, object, records, strings } from '../src/services/validation.js';
import { Retrieval, matchesNews } from '../src/services/retrieval.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import { requiredV2Schemas } from '../src/services/gemini/v2.js';
import { assistantContext, timelineTarget } from '../src/services/gemini/context.js';
import { PgRepository, type Read } from '../src/data/queries.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import { Gemini, type Model, type ModelTurn } from '../src/services/gemini/client.js';
import { deferred, TestRepository } from './support.js';

const core = JSON.parse(await readFile(new URL('../../contracts/examples/helene-core.json', import.meta.url), 'utf8'));
const research = JSON.parse(await readFile(new URL('../../contracts/examples/helene-research.json', import.meta.url), 'utf8'));
const config = readConfig({ NODE_ENV: 'test', AI_MAX_CONTEXT_BYTES: '128000', AI_MAX_ROUNDS: '6', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' });
const { contracts: shared } = await loadHandoffs(config);
const article: Data = core.articles[0], investigation: Data = research.investigations[0];
const request = { protocol_version: 2, request_id: 'core-test', message: 'Explain the available sources', timezone: 'America/Toronto', filters: {} };
const intent = { actions: [], filter_keys: [], clear_filters: [], clarification_reason: null, date_expression: null, date_target: null, use_current_area: false };
function call(name: string, args: Data): ModelTurn {
  return { content: { role: 'model', parts: [{ functionCall: { name, args } }] }, calls: [{ name, args }], text: '' };
}
function draft(changes: Data = {}) {
  return { kind: 'answer', answer: 'Synthetic behavioral-test explanation [1].',
    citations: changes.kind && changes.kind !== 'answer' ? [] : [{ source_id: article.source_id, record_id: article.id }],
    result_ids: changes.kind && changes.kind !== 'answer' ? [] : [article.id], actions: [], clarification_reason: null, ...changes };
}
class FixtureRepository extends TestRepository {
  constructor() { super({ news: core.articles, article: core.articles, sources: core.sources, locations: core.locations,
    workspace: [research.workspace], investigation: research.investigations, observations: research.observations }); }
  override async read(name: Read, args: Data) {
    let rows = await super.read(name, args);
    if (name === 'article') return rows.filter(row => row.id === args.id);
    if (name === 'investigation') return rows.filter(row => object(row.investigation).id === args.id);
    if (name === 'sources') return rows.filter(row => strings(args.ids).includes(String(row.id)));
    if (name === 'news') rows = rows.filter(row => matchesNews(row, args));
    if (name === 'observations') rows = rows.filter(row => row.location_id === args.location_id && row.metric === args.metric &&
      (!args.observed_from || Date.parse(String(row.observed_at)) >= Date.parse(String(args.observed_from))) &&
      (!args.observed_to || Date.parse(String(row.observed_at)) <= Date.parse(String(args.observed_to))))
      .sort((a, b) => Date.parse(String(a.observed_at)) - Date.parse(String(b.observed_at)));
    if (name === 'news' || name === 'observations') rows = rows.slice(Number(args.offset ?? 0), Number(args.offset ?? 0) + Number(args.limit ?? 50));
    return rows;
  }
}
// Exercise production contracts with an injected model/repository; no private v2 schemas.
function behavioralPorts() { return new Contracts(shared.schemas); }
function setup(turns: ModelTurn[], contracts = behavioralPorts()) {
  const repository = new FixtureRepository(), retrieval = new Retrieval(contracts, repository);
  const seen: { contents: unknown; tools: string[] }[] = [];
  const model: Model = { async generate(contents, declarations) {
    seen.push({ contents: structuredClone(contents), tools: declarations.map(d => d.name!) });
    const turn = turns.shift(); assert.ok(turn, 'Unexpected model turn'); return turn;
  } };
  return { repository, retrieval, seen, assistant: new Assistant(config, contracts, retrieval, undefined, model) };
}

test('v2 preserves sanitized provider/network failures as retryable validated fallbacks without replaying requests or actions', async () => {
  for (const [failure, code, detail] of [
    [Object.assign(new Error('synthetic-private-provider-body'), { status: 503 }), 'GEMINI_UNAVAILABLE', 'provider HTTP 503'],
    [new TypeError('synthetic-private-provider-body', { cause: { code: 'ENOTFOUND' } }), 'GEMINI_NETWORK_ERROR', 'network connection'],
    [new DOMException('synthetic-private-provider-body', 'TimeoutError'), 'GEMINI_TIMEOUT', 'timed out'],
  ] as const) {
    const repository = new FixtureRepository(); let calls = 0;
    const model = new Gemini(config, { models: { generateContent: async () => { calls++; throw failure; } } });
    const assistant = new Assistant(config, shared, new Retrieval(shared, repository), undefined, model);
    const response = shared.parse('AssistantResponseV2', await assistant.answer({ ...request, interaction_mode: 'intent' }), true);
    assert.equal(response.mode, 'fallback'); assert.equal(response.kind, 'answer');
    assert.deepEqual(response.actions, []); assert.deepEqual(response.citations, []);
    const error = records(response.errors)[0]!;
    assert.equal(error.code, code); assert.equal(error.retryable, true);
    assert.ok(String(error.message).includes(detail)); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(response).includes('synthetic-private-provider-body'));
  }
});

test('real shared registry gates v2 before retrieval or model work; legacy remains usable', async () => {
  const repository = new FixtureRepository(); let calls = 0;
  const incomplete = new Contracts(Object.fromEntries(Object.entries(shared.schemas).filter(([name]) => name !== 'AssistantArticleReadArgs')));
  const assistant = new Assistant(config, incomplete, new Retrieval(incomplete, repository), undefined,
    { generate: async () => { calls++; return call('respond', draft()); } });
  await assert.rejects(assistant.answer(request), /awaits shared schemas.*AssistantArticleReadArgs/);
  assert.equal(repository.calls.length, 0); assert.equal(calls, 0);
  const response = await assistant.answer({ request_id: 'legacy', message: 'Explain', timezone: 'UTC', filters: {} });
  // Legacy respond schema excludes the new kind/clarification fields.
  assert.equal(response.mode, 'fallback'); assert.deepEqual(response.actions, []);
});

test('v2 behavioral port resolves numbered original sources and re-retrieves a selected article', async () => {
  const { assistant, repository } = setup([call('interpret_request', intent), call('get_article', { id: article.id }), call('respond', draft())]);
  const response = await assistant.answer({ ...request, selected_article_id: article.id,
    history: [{ role: 'assistant', content: 'Untrusted old claims and invented citations.' }] });
  assert.equal(response.mode, 'fixture'); assert.equal(response.kind, 'answer');
  const citation = records(response.citations)[0]!;
  assert.equal(citation.number, 1); assert.equal(citation.url, article.url);
  assert.equal(citation.published_at, core.sources.find((s: Data) => s.id === article.source_id).published_at);
  assert.equal(citation.published_date, core.sources.find((s: Data) => s.id === article.source_id).published_date);
  assert.ok(repository.calls.some(c => c.name === 'article' && c.input.id === article.id));
});

test('ambiguous, quoted and negated commands permit read-only answers with no actions', async () => {
  for (const [message, quote] of [['What about Toronto?', 'What about Toronto?'], ['Do not zoom to Asheville', 'zoom to Asheville'],
    ['The source says "zoom to Asheville"', 'zoom to Asheville']]) {
    const { assistant, seen } = setup([call('interpret_request', { ...intent,
      actions: [{ type: 'focus_location', quote }] }), call('respond', draft({ citations: [], result_ids: [] }))]);
    const response = await assistant.answer({ ...request, message });
    assert.equal(response.kind, 'answer'); assert.equal(response.mode, 'fixture');
    assert.deepEqual(response.actions, []); assert.equal(seen.length, 2);
  }
});

test('clear filtering intent preserves unnamed constraints and derives final counts from retrieval', async () => {
  const { assistant, repository } = setup([call('interpret_request', { ...intent,
    actions: [{ type: 'set_filters', quote: 'Show missing-keyword news' }], filter_keys: ['keyword'] }),
    call('respond', draft({ kind: 'empty', actions: [{ type: 'set_filters', set: { keyword: 'missing-keyword' }, clear: [] }] }))]);
  const response = await assistant.answer({ ...request, message: 'Show missing-keyword news', filters: { themes: ['flooding'], limit: 10, offset: 20 } });
  assert.equal(response.kind, 'empty'); assert.equal(response.mode, 'fixture');
  const search = object(response.search);
  assert.deepEqual(search.filters, { themes: ['flooding'], keyword: 'missing-keyword', limit: 10, offset: 0 });
  assert.equal(search.returned_count, 0); assert.deepEqual(response.result_ids, []);
  assert.ok(repository.calls.some(c => c.name === 'news' && c.input.keyword === 'missing-keyword'));
});

test('read-only mode omits action tools and rejects final actions atomically', async () => {
  const { assistant, seen } = setup([call('interpret_request', { ...intent,
    actions: [{ type: 'set_filters', quote: 'Show flooding' }], filter_keys: ['themes'] }),
    call('respond', draft({ actions: [{ type: 'set_filters', set: { themes: ['flooding'] }, clear: [] }] }))]);
  const response = await assistant.answer({ ...request, message: 'Show flooding', interaction_mode: 'read_only' });
  assert.equal(response.mode, 'fallback'); assert.deepEqual(response.actions, []);
  assert.equal(seen[1]!.tools.includes('set_filters'), false);
});

test('explicit focus and timeline commands return verified targets without changing news filters', async () => {
  const place = core.locations[0], series = records(investigation.observation_series)[0]!;
  for (const [message, type, args] of [
    ['Zoom to this place', 'focus_location', { location_id: place.id }],
    ['Open the timeline', 'open_timeline', { investigation_id: object(investigation.investigation).id, series_id: series.id }]
  ] as const) {
    const { assistant } = setup([call('interpret_request', { ...intent, actions: [{ type, quote: message }] }),
      call(type, args), call('respond', draft({ kind: 'action_summary' }))]);
    const response = await assistant.answer({ ...request, message, filters: { themes: ['flooding'] } });
    assert.equal(response.mode, 'fixture', JSON.stringify(response.errors));
    assert.equal(records(response.actions)[0]!.type, type);
    assert.equal(response.search, null);
  }
});

test('location lookup stops for unsupported coverage and ambiguous candidates', async () => {
  for (const [query, expected] of [['never-a-known-location', /coverage/], ['USGS', /Which of the available locations/]]) {
    const { assistant, seen } = setup([call('interpret_request', intent), call('search_locations', { query })]);
    const response = await assistant.answer(request);
    assert.equal(response.kind, 'clarification'); assert.match(String(response.answer), expected as RegExp);
    assert.equal(seen.length, 2); assert.deepEqual(response.actions, []);
  }
});

test('unavailable citations do not discard a completed answer or valid filter action', async () => {
  const planned = { ...intent, actions: [{ type: 'set_filters', quote: 'Show flooding' }], filter_keys: ['themes'] };
  const { assistant } = setup([call('interpret_request', planned), call('set_filters', { set: { themes: ['flooding'] }, clear: [] }),
    call('respond', draft({ citations: [{ source_id: 'invented', record_id: article.id }] }))]);
  const response = await assistant.answer({ ...request, message: 'Show flooding' });
  assert.equal(response.mode, 'fixture'); assert.deepEqual(response.citations, []); assert.deepEqual(response.errors, []);
  assert.equal(records(response.actions)[0]!.type, 'set_filters'); assert.notEqual(response.search, null);
});

test('answers retain their exact text and numbering, with optional source links', async () => {
  const other = core.articles.find((row: Data) => row.id !== article.id)!;
  const reference = { source_id: article.source_id, record_id: article.id };
  const extra = { source_id: other.source_id, record_id: other.id };
  const { assistant } = setup([call('interpret_request', intent), call('search_news', { limit: 5 }), call('respond', draft({
    answer: '## Historical overview\n\nSupported statement [2]. Repeated [3].', citations: [extra, reference, reference],
  }))], shared);
  const response = await assistant.answer({ ...request, interaction_mode: 'intent' });
  assert.equal(response.mode, 'fixture', JSON.stringify(response.errors));
  assert.equal(response.answer, '## Historical overview\n\nSupported statement [2]. Repeated [3].');
  assert.equal(records(response.citations).length, 3);
  assert.equal(records(response.citations)[1]!.record_id, article.id);
  for (const changes of [
    { answer: 'Unsupported number [4].', citations: [reference] },
    { answer: 'Supported [1].', citations: [reference, { source_id: 'invented', record_id: article.id }] },
    { answer: 'Supported [1].\n\nUncited factual paragraph.', citations: [reference] },
    { answer: 'Answer with no inline citation requirement.', citations: [] },
    { answer: 'Optional sources [2].', citations: [{ source_id: 'invented', record_id: article.id }, reference] },
  ]) {
    const testbed = setup([call('interpret_request', intent), call('search_news', {}), call('respond', draft(changes))], shared);
    const result = await testbed.assistant.answer({ ...request, interaction_mode: 'intent' });
    assert.equal(result.mode, 'fixture'); assert.deepEqual(result.actions, []); assert.deepEqual(result.errors, []);
    assert.equal(result.answer, changes.answer);
    assert.ok(records(result.citations).every(c => c.source_id === reference.source_id));
    if (changes.answer === 'Optional sources [2].') assert.deepEqual(records(result.citations).map(c => c.number), [2]);
  }
});

test('missing optional source metadata does not reject an answer, and uncited answers need no source read', async () => {
  class UnavailableSources extends FixtureRepository {
    override async read(name: Read, args: Data) {
      if (name === 'sources') throw new Error('Source metadata temporarily unavailable');
      return super.read(name, args);
    }
  }
  const turns = [call('interpret_request', intent), call('search_news', {}), call('respond', draft())];
  const repository = new UnavailableSources();
  const assistant = new Assistant(config, shared, new Retrieval(shared, repository), undefined, { generate: async () => turns.shift()! });
  const result = await assistant.answer(request);
  assert.equal(result.mode, 'fixture'); assert.equal(result.answer, draft().answer); assert.deepEqual(result.citations, []);
  const uncited = setup([call('interpret_request', intent), call('search_news', {}), call('respond', draft({ citations: [], result_ids: ['unknown-record'] }))]);
  const answer = await uncited.assistant.answer(request);
  assert.equal(answer.mode, 'fixture'); assert.deepEqual(answer.result_ids, []);
  assert.ok(!uncited.repository.calls.some(row => row.name === 'sources'));
});

test('streaming final JSON goes through the real v2 citation/action finalizer before completion', async () => {
  const repository = new FixtureRepository(), events: Data[] = []; let calls = 0;
  const model: Model = { generate: async (_contents, _declarations, _signal, options) => {
    if (++calls === 1) return call('interpret_request', intent);
    if (calls === 2) return call('search_news', {});
    await options!.onAnswerDelta!('Synthetic behavioral-test explanation [1].');
    return { content: { role: 'model', parts: [] }, calls: [], text: JSON.stringify(draft()) };
  } };
  const assistant = new Assistant(config, shared, new Retrieval(shared, repository), undefined, model);
  const result = await assistant.answer({ ...request, interaction_mode: 'intent' }, undefined, async event => { events.push(event); });
  shared.parse('AssistantResponseV2', result, true);
  assert.equal(result.mode, 'fixture'); assert.equal(records(result.citations).length, 1);
  assert.ok(events.some(event => event.type === 'answer_delta'));
  assert.equal(events.at(-1)!.phase, 'validating'); assert.equal(calls, 3);
});

test('v2 quota backoff is shared with the parent assistant and output errors remain sanitized', async () => {
  const ports = behavioralPorts(), repository = new FixtureRepository(); let calls = 0, now = Date.parse('2026-10-17T12:00:00Z');
  const model: Model = { generate: async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('synthetic-secret-must-not-leak'), { status: 429 });
    return calls === 2 ? call('interpret_request', intent) : calls === 3 ? call('search_news', {}) : call('respond', draft());
  } };
  const assistant = new Assistant(config, ports, new Retrieval(ports, repository), undefined, model, () => now);
  const first = await assistant.answer(request), second = await assistant.answer(request);
  assert.equal(first.mode, 'fallback'); assert.equal(second.mode, 'fallback'); assert.equal(calls, 1);
  assert.equal(records(second.errors)[0]!.code, 'GEMINI_RATE_LIMITED');
  assert.ok(!JSON.stringify(first).includes('synthetic-secret'));
  now += 60001; assert.equal((await assistant.answer(request)).mode, 'fixture'); assert.equal(calls, 4);
});

test('v2 interpretation and final proposed actions both count against the tool bound', async () => {
  const ports = behavioralPorts(), repository = new FixtureRepository();
  const turns = [call('interpret_request', { ...intent, actions: [{ type: 'focus_location', quote: 'Zoom to this place' }] }),
    call('respond', draft({ kind: 'action_summary', actions: [{ type: 'focus_location', location_id: core.locations[0].id }] }))];
  const assistant = new Assistant({ ...config, aiMaxTools: 2 }, ports, new Retrieval(ports, repository), undefined,
    { generate: async () => turns.shift()! });
  const response = await assistant.answer({ ...request, message: 'Zoom to this place' });
  assert.equal(response.mode, 'fallback'); assert.equal(records(response.errors)[0]!.code, 'RESEARCH_LIMIT_REACHED');
  assert.deepEqual(response.actions, []);
});

test('current-area questions without a selection or explicit bounds request clarification', async () => {
  const { assistant } = setup([call('interpret_request', { ...intent, use_current_area: true })]);
  const response = await assistant.answer({ ...request, message: 'What is happening in this area?' });
  assert.equal(response.kind, 'clarification'); assert.match(String(response.answer), /Which place/);
});

test('date expressions are server-resolved and mismatched generated ranges cannot be applied', async () => {
  const { assistant } = setup([call('interpret_request', { ...intent, actions: [{ type: 'set_filters', quote: 'Show news today' }],
    filter_keys: ['published_from', 'published_to'], date_expression: 'today', date_target: 'publication' }),
    call('respond', draft({ kind: 'action_summary', actions: [{ type: 'set_filters', set: { published_from: '1900-01-01T00:00:00Z' }, clear: [] }] }))]);
  const response = await assistant.answer({ ...request, message: 'Show news today' });
  assert.equal(response.mode, 'fallback'); assert.deepEqual(response.actions, []);
});

test('publication date commands apply timezone-resolved ranges and preserve unrelated filters', async () => {
  const message = 'Show news from 2024-09-27';
  const { assistant } = setup([call('interpret_request', { ...intent, actions: [{ type: 'set_filters', quote: message }],
    filter_keys: ['published_from', 'published_to'], date_expression: '2024-09-27', date_target: 'publication' }),
    call('respond', draft({ kind: 'action_summary', actions: [{ type: 'set_filters', set: {}, clear: [] }] }))]);
  const response = await assistant.answer({ ...request, message, filters: { themes: ['flooding'] } });
  assert.equal(response.mode, 'fixture', JSON.stringify(response.errors));
  const filters = object(object(response.search).filters);
  assert.equal(filters.published_from, '2024-09-27T04:00:00.000Z');
  assert.equal(filters.published_to, '2024-09-28T03:59:59.999Z');
  assert.deepEqual(filters.themes, ['flooding']);
});

test('read-only refined searches report their own returned page without applying filters', async () => {
  const { assistant } = setup([call('interpret_request', intent), call('search_news', { keyword: 'no-matches-for-this-test' }),
    call('respond', draft({ kind: 'empty' }))]);
  const response = await assistant.answer(request);
  assert.equal(response.mode, 'fixture'); assert.equal(response.kind, 'empty'); assert.deepEqual(response.actions, []);
  assert.equal(object(object(response.search).filters).keyword, 'no-matches-for-this-test');
  assert.equal(object(response.search).returned_count, 0);
});

test('action statuses still require an action; ordinary answers do not require citations', async () => {
  const invalidStatus = setup([call('interpret_request', intent), call('respond', draft({ kind: 'action_summary', answer: 'An unsupported assertion.' }))]);
  const status = await invalidStatus.assistant.answer(request);
  assert.equal(status.mode, 'fallback'); assert.deepEqual(status.actions, []);
  const ordinary = setup([call('interpret_request', intent), call('respond', draft({ answer: 'A plain answer.', citations: [], result_ids: [] }))]);
  const answer = await ordinary.assistant.answer(request);
  assert.equal(answer.mode, 'fixture'); assert.equal(answer.answer, 'A plain answer.'); assert.deepEqual(answer.citations, []);
});

test('observation comparison offers a linked timeline without an automatic action', async () => {
  const series = records(investigation.observation_series)[0]!;
  const { assistant } = setup([call('interpret_request', intent),
    call('compare_observations', { location_id: series.location_id, metric: series.metric, limit: 2 }), call('get_article', { id: article.id }), call('respond', draft())]);
  const response = await assistant.answer({ ...request, selected_investigation_id: object(investigation.investigation).id });
  assert.equal(response.mode, 'fixture'); assert.deepEqual(response.actions, []);
  assert.equal(object(response.timeline).series_id, series.id);
});

test('selection and stored associations take precedence over history and map bounds', async () => {
  const repository = new FixtureRepository(), retrieval = new Retrieval(shared, repository);
  const context = await assistantContext({ selected_article_id: article.id, selected_bounds: [-90, 30, -70, 50],
    history: [{ role: 'assistant', content: 'Use an invented selection' }] }, retrieval);
  assert.equal(object(context.article).id, article.id);
  assert.equal(object(object(context.investigation).investigation).id, object(investigation.investigation).id);
  assert.notEqual(context.location, null); assert.equal(context.bounds, null);
  await assert.rejects(timelineTarget({ investigation_id: object(investigation.investigation).id, series_id: 'not-linked' }, retrieval), /not linked/);
});

test('article query is fixed, parameterized and does not alter core readiness requirements', async () => {
  let submitted: { text: string; values: unknown[] } | undefined;
  const repo = new PgRepository({ query: async (plan: typeof submitted) => { submitted = plan; return { rows: [] }; } } as unknown as pg.Pool,
    { version: 'atlas-p3-v1', plans: {} });
  await repo.read('article', { id: "x'; DROP TABLE atlas.articles;--" });
  assert.deepEqual(submitted!.values, ["x'; DROP TABLE atlas.articles;--"]);
  assert.ok(!submitted!.text.includes('DROP')); assert.match(submitted!.text, /WHERE a.id = \$1::text LIMIT 1/);
  assert.equal(repo.missingPlans.includes('article'), false);
});

test('cancellation after interpretation cannot execute a late action', async () => {
  const ports = behavioralPorts(), repository = new FixtureRepository(), retrieval = new Retrieval(ports, repository);
  const entered = deferred<void>(), pending = deferred<ModelTurn>(), controller = new AbortController();
  const assistant = new Assistant(config, ports, retrieval, undefined, { generate: async () => { entered.resolve(); return pending.promise; } });
  const work = assistant.answer(request, controller.signal); await entered.promise;
  const count = repository.calls.length; controller.abort();
  pending.resolve(call('interpret_request', { ...intent, actions: [{ type: 'set_filters', quote: 'Show news' }] }));
  await assert.rejects(work, /cancelled/); assert.equal(repository.calls.length, count);
});

test('real shared v2 contracts accept the backend response', async () => {
    assert.ok(requiredV2Schemas.every(name => shared.has(name)));
    const { assistant } = setup([call('interpret_request', intent), call('search_news', {}), call('respond', draft())], shared);
    assert.equal((await assistant.answer(request)).mode, 'fixture');
  });
