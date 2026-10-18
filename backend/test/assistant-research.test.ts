import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Content } from '@google/genai';
import { readConfig } from '../src/config.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import { Retrieval, matchesNews } from '../src/services/retrieval.js';
import { object, records, strings, type Data } from '../src/services/validation.js';
import type { Model, ModelTurn } from '../src/services/gemini/client.js';
import { modelRequestBytes } from '../src/services/gemini/request.js';
import { byteLength, historyPairs, initialHistory, PromptBudget, type ResearchBlock } from '../src/services/gemini/budget.js';
import { projectRecord, ResearchTools } from '../src/services/gemini/research.js';
import { deferred, TestRepository } from './support.js';
import type { Read } from '../src/data/queries.js';

const core = JSON.parse(await readFile(new URL('../../contracts/examples/helene-core.json', import.meta.url), 'utf8'));
const research = JSON.parse(await readFile(new URL('../../contracts/examples/helene-research.json', import.meta.url), 'utf8'));
const config = readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js', AI_MAX_CONTEXT_BYTES: '128000', AI_MAX_ROUNDS: '6', AI_REQUEST_TIMEOUT_MS: '50000' });
const { contracts } = await loadHandoffs(config);
const article = core.articles[0], inv = research.investigations[0];
const input = { protocol_version: 2, interaction_mode: 'intent', request_id: 'research-test', message: 'Explain the available evidence', timezone: 'UTC', filters: {} };
const intent = { actions: [], filter_keys: [], clear_filters: [], clarification_reason: null, date_expression: null, date_target: null, use_current_area: false };
const call = (name: string, args: Data = {}, signature = ''): ModelTurn => ({ content: { role: 'model', parts: [{ functionCall: { name, args }, ...(signature ? { thoughtSignature: signature } : {}) }] }, text: '', calls: [{ name, args }] });
const answer = (record = article): ModelTurn => call('respond', { kind: 'answer', answer: 'Supported stored evidence [1].', citations: [{ record_id: record.id, source_id: record.source_id ?? record.source_ids[0] }], result_ids: [record.id], actions: [], clarification_reason: null });
class Repository extends TestRepository {
  constructor() { super({ news: core.articles, article: core.articles, investigation: research.investigations, workspace: [research.workspace], locations: core.locations, observations: research.observations, sources: core.sources }); }
  override async read(name: Read, args: Data) {
    let rows = await super.read(name, args);
    if (name === 'article') return rows.filter(row => row.id === args.id);
    if (name === 'investigation') return rows.filter(row => object(row.investigation).id === args.id);
    if (name === 'sources') return rows.filter(row => strings(args.ids).includes(String(row.id)));
    if (name === 'news') rows = rows.filter(row => matchesNews(row, args));
    if (name === 'news') rows = rows.slice(Number(args.offset ?? 0), Number(args.offset ?? 0) + Number(args.limit ?? 50));
    return rows;
  }
}
function setup(turns: ModelTurn[], settings = config, clock = Date.now, repository = new Repository()) {
  const captured: { contents: Content[]; names: string[]; bytes: number }[] = [], diagnostics: Data[] = [];
  const model: Model = { generate: async (contents, declarations, _signal, options) => {
    captured.push({ contents: structuredClone(contents), names: declarations.map(row => row.name!), bytes: modelRequestBytes(settings, contents, declarations, options) });
    const next = turns.shift(); assert.ok(next, 'Unexpected generation round'); return next;
  } };
  return { captured, diagnostics, repository, assistant: new Assistant(settings, contracts, new Retrieval(contracts, repository), undefined, model, clock, event => diagnostics.push(event)) };
}
const replies = (contents: Content[]) => contents.flatMap(content => content.parts?.flatMap(part => part.functionResponse ? [object(part.functionResponse.response)] : []) ?? []);

test('selected investigations and six supplied exchanges do not become an upfront evidence dump', async () => {
  const history = Array.from({ length: 6 }, (_, i) => [{ role: 'user', content: `Question ${i} ` + 'q'.repeat(400) }, { role: 'assistant', content: `Answer ${i} ` + 'a'.repeat(400) }]).flat();
  const testbed = setup([call('interpret_request', intent), call('respond', { kind: 'clarification', answer: '', citations: [], result_ids: [], actions: [], clarification_reason: 'missing_metric' })]);
  const result = await testbed.assistant.answer({ ...input, selected_investigation_id: inv.investigation.id, history });
  assert.equal(result.kind, 'clarification');
  assert.ok(testbed.captured.every(round => round.bytes < 16000));
  const first = JSON.parse(testbed.captured[1]!.contents[0]!.parts![0]!.text!);
  assert.equal(first.request.history.length, 2); assert.equal(first.request.history_available, 6);
  assert.equal(first.request.selection.selected_investigation_id, inv.investigation.id);
  assert.equal(first.evidence, undefined); assert.equal(first.sources, undefined); assert.equal(first.context, undefined);
  assert.ok(!JSON.stringify(testbed.captured).includes('https://www.usgs.gov'));
  assert.deepEqual(testbed.repository.calls.map(row => row.name), ['freshness']);
});

test('large valid Unicode questions and filter ID sets fit without forwarding the full workspace query', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `id-${i}-` + 'x'.repeat(150));
  const question = '"🚀'.repeat(2000);
  const testbed = setup([call('interpret_request', { ...intent, clarification_reason: 'missing_metric' })]);
  const result = await testbed.assistant.answer({ ...input, message: question, filters: { location_ids: ids, themes: ids },
    selected_investigation_id: inv.investigation.id });
  assert.equal(result.kind, 'clarification'); assert.equal(testbed.captured.length, 1);
  assert.ok(testbed.captured[0]!.bytes < 32000);
  const request = object(JSON.parse(testbed.captured[0]!.contents[0]!.parts![0]!.text!).request);
  assert.equal(request.message, question); assert.equal(request.filters, undefined);
  assert.deepEqual(object(request.scope).active_filter_keys, ['location_ids', 'themes']);
});

test('news search then article detail produces original citations using a single cached news read', async () => {
  const testbed = setup([call('interpret_request', intent), call('search_news'), call('get_article', { id: article.id }), answer()]);
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors));
  assert.equal(records(result.citations)[0]!.url, article.url);
  assert.equal(testbed.repository.calls.filter(row => row.name === 'news').length, 1);
  assert.equal(testbed.repository.calls.filter(row => row.name === 'article').length, 0);
  assert.equal(testbed.repository.calls.find(row => row.name === 'news')!.input.limit, 3);
  for (const round of testbed.captured) {
    assert.ok(round.bytes <= 48000);
    for (const reply of replies(round.contents)) { contracts.parse('AssistantToolResult', reply, true); assert.ok(byteLength(reply) <= 8000); }
  }
  assert.ok(!JSON.stringify(testbed.captured).includes(article.url));
});

test('identical retained tool results become small receipts instead of duplicate evidence', async () => {
  const testbed = setup([call('interpret_request', intent), call('search_news'), call('search_news'), answer()]);
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fixture'); assert.equal(testbed.repository.calls.filter(row => row.name === 'news').length, 1);
  assert.ok(replies(testbed.captured.at(-1)!.contents).some(reply => reply.kind === 'receipt' && object(reply.receipt).already_in_context === true));
});

test('selected linked evidence bypasses feed filters without changing them, and sections stay paginated', async () => {
  const item = inv.investigation.items.find((row: Data) => strings(row.source_ids).length)!;
  const testbed = setup([call('interpret_request', intent), call('get_investigation', { id: inv.investigation.id }),
    call('get_investigation', { id: inv.investigation.id, section: 'items', limit: 5 }), answer(item)]);
  const result = await testbed.assistant.answer({ ...input, filters: { keyword: 'no-matches' }, selected_investigation_id: inv.investigation.id });
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.deepEqual(result.actions, []); assert.equal(result.search, null);
  assert.equal(testbed.repository.calls.filter(row => row.name === 'investigation').length, 1);
  assert.equal(testbed.repository.calls.filter(row => row.name === 'news').length, 0);
  const overview = replies(testbed.captured[2]!.contents)[0]!;
  assert.equal(records(overview.items).length, 1); assert.equal(records(overview.items)[0]!.summary, undefined);
});

test('unexposed investigation records do not become links or discard the answer', async () => {
  const testbed = setup([call('interpret_request', intent), call('get_investigation', { id: inv.investigation.id }),
    call('respond', { kind: 'answer', answer: 'Unseen claim [1].', citations: [{ record_id: article.id, source_id: article.source_id }], result_ids: [], actions: [], clarification_reason: null })]);
  const result = await testbed.assistant.answer({ ...input, selected_investigation_id: inv.investigation.id });
  assert.equal(result.mode, 'fixture'); assert.deepEqual(result.citations, []); assert.deepEqual(result.errors, []);
  assert.equal(result.answer, 'Unseen claim [1].'); assert.deepEqual(result.actions, []);
});

test('general research cannot overwrite filters or read arbitrary unseen articles', async () => {
  const testbed = setup([call('interpret_request', intent), call('search_news', { keyword: 'different' }), call('get_article', { id: article.id }),
    call('respond', { kind: 'clarification', answer: '', citations: [], result_ids: [], actions: [], clarification_reason: 'ambiguous_intent' })]);
  const result = await testbed.assistant.answer({ ...input, filters: { keyword: 'existing' } });
  assert.equal(result.kind, 'clarification'); assert.equal(testbed.repository.calls.filter(row => row.name === 'news' || row.name === 'article').length, 0);
  assert.equal(replies(testbed.captured.at(-1)!.contents).filter(reply => reply.kind === 'error').length, 2);
});

test('last research round becomes a supported partial answer with a visible limit notice', async () => {
  const testbed = setup([call('interpret_request', intent), call('search_news'), answer()], { ...config, aiMaxRounds: 3 });
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.equal(records(result.errors)[0]!.code, 'RESEARCH_LIMIT_REACHED');
  assert.deepEqual(testbed.captured.at(-1)!.names, ['respond']); assert.equal(testbed.captured.length, 3);
});

test('budget exhaustion without exposed evidence asks for a narrower question, with no generation replay', async () => {
  const testbed = setup([call('interpret_request', intent)], { ...config, aiMaxRounds: 2 });
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fallback'); assert.equal(records(result.errors)[0]!.code, 'RESEARCH_LIMIT_REACHED');
  assert.equal(testbed.captured.length, 1); assert.deepEqual(result.actions, []);
});

test('research timeout reserves finalization and ignores a late model turn even when the adapter ignores abort', async () => {
  let now = Date.now(), calls = 0;
  const late = deferred<ModelTurn>(), diagnostics: Data[] = [], events: Data[] = [];
  const repository = new Repository();
  const model: Model = { generate: async (_contents, declarations, _signal, options) => {
    calls++;
    if (calls === 1) return call('interpret_request', intent);
    if (calls === 2) { now += 34950; return call('search_news'); }
    if (calls === 3) { await options?.onAnswerDelta?.('Abandoned provisional text'); return late.promise; }
    assert.deepEqual(declarations.map(row => row.name), ['respond']);
    await options?.onAnswerDelta?.('Supported stored evidence [1].'); return answer();
  } };
  const assistant = new Assistant(config, contracts, new Retrieval(contracts, repository), undefined, model, () => now, event => diagnostics.push(event));
  // Keep the test alive while AbortSignal's unref'ed deadline is pending.
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    const result = await assistant.answer(input, undefined, async event => { events.push(event); });
    assert.equal(result.mode, 'fixture', JSON.stringify(result.errors));
    assert.equal(records(result.errors)[0]!.code, 'RESEARCH_LIMIT_REACHED');
    assert.equal(calls, 4); assert.deepEqual(result.actions, []);
    assert.ok(diagnostics.some(row => row.stop_reason === 'time_limit'));
    assert.deepEqual(events.filter(row => row.type === 'answer_delta').map(row => row.text), ['Abandoned provisional text', 'Supported stored evidence [1].']);
    late.resolve(call('focus_location', { location_id: core.locations[0].id }));
    await Promise.resolve(); assert.equal(repository.calls.filter(row => row.name === 'locations').length, 0);
  } finally { clearTimeout(keepAlive); }
});

test('completed filter commands retain empty-result semantics when final research time is exhausted', async () => {
  const command = { ...intent, actions: [{ type: 'set_filters', quote: 'Show no-matches news' }], filter_keys: ['keyword'] };
  const testbed = setup([call('interpret_request', command), call('set_filters', { set: { keyword: 'no-matches' }, clear: [] })], { ...config, aiMaxRounds: 3 });
  const result = await testbed.assistant.answer({ ...input, message: 'Show no-matches news' });
  assert.equal(result.kind, 'empty'); assert.equal(result.mode, 'fixture');
  assert.equal(object(result.search).returned_count, 0); assert.equal(records(result.actions).length, 1);
});

test('v2 category and provenance commands use canonical filters and preserve unnamed constraints', async () => {
  const message = 'Show reviewed flood and health reports with no mapped locations';
  const filters = { event_types: ['flood'], topics: ['health'], verification_status: 'reviewed', has_location: false };
  const command = { ...intent, actions: [{ type: 'set_filters', quote: message }], filter_keys: Object.keys(filters) };
  const testbed = setup([call('interpret_request', command), call('set_filters', { set: filters, clear: [] })], { ...config, aiMaxRounds: 3 });
  const result = await testbed.assistant.answer({ ...input, message, filters: { keyword: 'no-matches', limit: 20, offset: 40 } });
  assert.equal(result.kind, 'empty', JSON.stringify(result.errors));
  const applied = object(records(result.actions)[0]!.filters);
  assert.deepEqual(applied, { ...filters, keyword: 'no-matches', limit: 20, offset: 0 });
  assert.deepEqual(object(result.search).filters, applied);
  assert.deepEqual(testbed.repository.calls.find(row => row.name === 'news')!.input, applied);
});

test('oversized model tool blocks are not dispatched and finalization uses previously exposed evidence', async () => {
  const testbed = setup([call('interpret_request', intent), call('search_news'), call('get_article', { id: 'never-read' }, 's'.repeat(17000)), answer()]);
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.equal(records(result.errors)[0]!.code, 'RESEARCH_LIMIT_REACHED');
  assert.ok(!testbed.repository.calls.some(row => row.input.id === 'never-read'));
  assert.deepEqual(testbed.captured.at(-1)!.names, ['respond']);
});

test('repeated multi-round research compacts complete blocks and refetches evicted results from cache', async () => {
  const signature = 's'.repeat(12000);
  const testbed = setup([call('interpret_request', intent), call('search_news', { offset: 0 }, signature), call('search_news', { offset: 3 }, signature),
    call('search_news', { offset: 6 }, signature), call('search_news', { offset: 0 }, signature), answer()]);
  const result = await testbed.assistant.answer(input);
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors));
  assert.ok(testbed.captured.every(round => round.bytes <= 48000)); assert.ok(testbed.diagnostics.some(row => Number(row.compactions) > 0));
  assert.equal(testbed.repository.calls.filter(row => row.name === 'news').length, 3);
  assert.ok(replies(testbed.captured.at(-1)!.contents).some(reply => reply.kind === 'news'));
  for (const round of testbed.captured) for (const content of round.contents.filter(row => row.role === 'model')) assert.equal(content.parts![0]!.thoughtSignature, signature);
});

test('history budgets use complete pairs and never truncate Unicode text', () => {
  const history = [{ role: 'user', content: '🚀'.repeat(1000) }, { role: 'assistant', content: 'reply' }];
  assert.equal(initialHistory(history).length, 0); assert.equal(historyPairs(history)[0]!.user, history[0]!.content);
  assert.deepEqual(initialHistory([{ role: 'assistant', content: 'orphan' }]), []);
});

test('history tool pages whole exchanges and explicitly omits an individually oversized pair', async () => {
  const history = Array.from({ length: 3 }, (_, index) => [
    { role: 'user', content: `Question ${index} ` + 'q'.repeat(1900) },
    { role: 'assistant', content: `Answer ${index} ` + 'a'.repeat(1900) },
  ]).flat();
  const tools = new ResearchTools(contracts, {} as never, history), signal = new AbortController().signal;
  const first = (await tools.run('read_history', { limit: 2 }, signal)).result;
  assert.equal(records(first.exchanges).length, 1); assert.equal(first.next_offset, 1); assert.equal(first.truncated, true);
  assert.match(String(first.limitation), /next complete exchange/); assert.ok(byteLength(first) <= 8000);
  const second = (await tools.run('read_history', { offset: 1 }, signal)).result;
  assert.equal(records(second.exchanges)[0]!.user, history[2]!.content);
  const oversized = new ResearchTools(contracts, {} as never, [...history, { role: 'user', content: '🚀'.repeat(2000) }, { role: 'assistant', content: 'Complete reply' }]);
  const omitted = (await oversized.run('read_history', {}, signal)).result;
  assert.deepEqual(omitted.exchanges, []); assert.equal(omitted.next_offset, 1);
  assert.match(String(omitted.limitation), /omitted without truncation/);
});

test('article excerpt paging preserves exact Unicode slices and explicit original-date metadata', () => {
  const row = { ...article, excerpt: '🚀'.repeat(500), published_at: null, published_date: '2024-09-27', publication_time_basis: 'date_only' };
  const preview = projectRecord(row, 'article', true);
  assert.equal([...String(preview.excerpt)].length, 240); assert.equal(preview.next_excerpt_offset, 240);
  const detail = projectRecord(row, 'article', false, { excerpt_offset: 240, excerpt_limit: 100 });
  assert.equal(detail.excerpt, '🚀'.repeat(100)); assert.equal(detail.next_excerpt_offset, 340);
  assert.equal(detail.published_at, null); assert.equal(detail.published_date, '2024-09-27');
});

test('oversized mandatory qualifiers fail rather than being silently dropped from tool evidence', () => {
  const tools = new ResearchTools(contracts, {} as never, []);
  const observation = { ...inv.observations[0], qualifiers: Array.from({ length: 100 }, () => 'q'.repeat(1000)) };
  assert.throws(() => tools.page('observations', [observation], 'observation', { limit: 1 }), /qualifiers or limitations/);
});

test('prompt budget counts instructions, schemas and signatures, removing whole blocks without modifying parts', () => {
  const budget = new PromptBudget(config), signature = 's'.repeat(25000);
  const blocks: ResearchBlock[] = Array.from({ length: 3 }, () => ({ contents: [{ role: 'model', parts: [{ functionCall: { name: 'x', args: {} }, thoughtSignature: signature }] }, { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }], records: [], references: [] }));
  const result = budget.fit({ request: { message: 'Question', history: [] } }, blocks, [{ name: 'respond', parametersJsonSchema: { type: 'object' } }]);
  assert.ok(result.bytes <= 48000); assert.equal(blocks.length, 1); assert.equal(blocks[0]!.contents[0].parts![0]!.thoughtSignature, signature);
  assert.ok(modelRequestBytes(config, [], []) > byteLength({ contents: [], declarations: [] }));
});

test('compaction evicts receipts that depend on an evicted evidence payload', () => {
  const make = (references: string[], dependsOn: string[], size: number): ResearchBlock => ({
    contents: [{ role: 'model', parts: [{ functionCall: { name: 'x', args: {} }, thoughtSignature: 's'.repeat(size) }] },
      { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }], records: [], references, dependsOn,
  });
  const blocks = [make(['origin'], [], 25000), make([], ['origin'], 100), make(['new'], [], 25000)];
  new PromptBudget(config).fit({ request: { message: 'Question', history: [] } }, blocks, []);
  assert.equal(blocks.length, 1); assert.deepEqual(blocks[0]!.references, ['new']);
});
