import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI, type Content } from '@google/genai';
import { readConfig } from '../src/config.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import { Conversations, actionQuote } from '../src/services/gemini/conversations.js';
import { Retrieval, matchesNews } from '../src/services/retrieval.js';
import { type Data, object, records, strings } from '../src/services/validation.js';
import { Gemini, type Model, type ModelTurn } from '../src/services/gemini/client.js';
import type { Read } from '../src/data/queries.js';
import { TestRepository, deferred } from './support.js';
import { buildApp } from '../src/app.js';
import { Flights } from '../src/services/flights.js';
import { Wind } from '../src/services/wind.js';
import { evaluateAssistantTraces } from '../src/evaluate-assistant.js';

const core = JSON.parse(await readFile(new URL('../../contracts/examples/helene-core.json', import.meta.url), 'utf8'));
const research = JSON.parse(await readFile(new URL('../../contracts/examples/helene-research.json', import.meta.url), 'utf8'));
const config = readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js', AI_MAX_ROUNDS: '6', AI_MAX_CONTEXT_BYTES: '128000' });
const { contracts } = await loadHandoffs(config);
const article = core.articles[0], second = core.articles[1], investigation = research.investigations[0];
const workspace: Data = {
  revision: 3, captured_at: '2026-10-18T12:00:00.000Z', viewport: { bounds: [-80, 43, -79, 44], center: [-79.5, 43.5], zoom: 9 },
  filters: { location_ids: article.location_ids, themes: ['flooding'], keyword: 'water' },
  selection: { article_id: article.id, investigation_id: null, location_id: article.location_ids[0], aircraft_id: null },
  origin: { view: 'news' }, visible_article_ids: [second.id, article.id], timeline: null,
  basemap: 'map', layers: { flights: false, wind: false }, capabilities: { flights: false, wind: false }, flight_context: null,
};
const input: Data = { protocol_version: 3, request_id: 'v3-test', turn_id: 'turn-1', message: 'What is happening here?', timezone: 'America/Toronto', interaction_mode: 'intent', workspace, history: [] };
const call = (name: string, args: Data = {}): ModelTurn => ({ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, calls: [{ name, args }], text: '' });
const answer = (changes: Data = {}): ModelTurn => call('respond', { kind: 'answer', answer: 'Stored evidence only.', citations: [], result_ids: [], actions: [], clarification_reason: null, references: [], ...changes });
class Repository extends TestRepository {
  constructor() { super({ news: core.articles, article: core.articles, investigation: research.investigations, workspace: [research.workspace], locations: core.locations, observations: research.observations, sources: core.sources }); }
  override async read(name: Read, args: Data) {
    let rows = await super.read(name, args);
    if (name === 'article') return rows.filter(row => row.id === args.id);
    if (name === 'investigation') return rows.filter(row => object(row.investigation).id === args.id);
    if (name === 'sources') return rows.filter(row => strings(args.ids).includes(String(row.id)));
    if (name === 'news') rows = rows.filter(row => matchesNews(row, args)).slice(Number(args.offset ?? 0), Number(args.offset ?? 0) + Number(args.limit ?? 50));
    return rows;
  }
}
function setup(turns: ModelTurn[], clock = Date.now) {
  const repository = new Repository(), captured: { contents: Content[]; tools: string[] }[] = [];
  const model: Model = { generate: async (contents, declarations) => {
    captured.push({ contents: structuredClone(contents), tools: declarations.map(tool => tool.name!) });
    const turn = turns.shift(); assert.ok(turn, 'Unexpected model round'); return turn;
  } };
  const retrieval = new Retrieval(contracts, repository);
  return { repository, captured, retrieval, assistant: new Assistant(config, contracts, retrieval, undefined, model, clock) };
}
const root = (value: { contents: Content[] }) => object(JSON.parse(value.contents[0]!.parts![0]!.text!));

test('demo research continues beyond the former round, call and 60-second cutoffs until the model finishes',async()=>{
  const settings=readConfig({NODE_ENV:'test',AI_DEMO_MODE:'true',ATLAS_CONTRACTS_MODULE:'contracts/dist/index.js'});
  let generations=0,now=Date.parse('2026-10-18T12:00:00Z'),toolCalls=0;
  const model:Model={generate:async(_contents,declarations,signal)=>{
    assert.equal(signal.aborted,false); now+=3000;
    if(generations++===25) return answer();
    assert.ok(declarations.some(tool=>tool.name==='get_workspace_context'),'Research tools must still be available');
    const calls=Array.from({length:5},(_,index)=>({name:'get_workspace_context',args:{},id:`demo-${generations}-${index}`}));
    toolCalls+=calls.length;
    return {content:{role:'model',parts:calls.map(functionCall=>({functionCall}))},calls,text:''};
  }};
  const response=await new Assistant(settings,contracts,new Retrieval(contracts,new Repository()),undefined,model,()=>now).answer(input);
  assert.equal(response.mode,'fixture',JSON.stringify(response.errors)); assert.equal(response.answer,'Stored evidence only.');
  assert.equal(generations,26); assert.equal(toolCalls,125); assert.deepEqual(response.errors,[]);
});
test('Stop still cancels uncapped demo research and discards staged actions',async()=>{
  const settings=readConfig({NODE_ENV:'test',AI_DEMO_MODE:'true'}),entered=deferred<void>(),late=deferred<ModelTurn>();
  const controller=new AbortController(); let calls=0;
  const model:Model={generate:async()=>{
    if(calls++===0) return call('update_workspace',{request_quote:'Switch to satellite',actions:[{type:'set_basemap',basemap:'satellite'}]});
    entered.resolve(); return late.promise;
  }};
  const request=new Assistant(settings,contracts,new Retrieval(contracts,new Repository()),undefined,model).answer({...input,message:'Switch to satellite'},controller.signal);
  await entered.promise; controller.abort(); await assert.rejects(request,/cancelled/i);
  late.resolve(answer());
});

test('official SDK sends compatible v3 schemas and completes a streamed workspace action with no network', async () => {
  const settings = { ...config, geminiKey: 'synthetic-no-network-key', geminiModel: 'gemini-3.1-pro-preview', geminiThinkingLevel: 'medium' as const };
  const staged = [{ type: 'set_basemap', basemap: 'satellite' }], message = 'Switch to satellite';
  const draft = { kind: 'answer', answer: 'The satellite view is ready.', citations: [], result_ids: [], actions: [], clarification_reason: null, references: [] };
  const requests: Data[] = [], progress: Data[] = [];
  const supported = new Set(['type', 'title', 'description', 'enum', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'propertyOrdering', 'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'anyOf']);
  function assertSchema(value: unknown) {
    if (typeof value === 'boolean') return;
    const schema = object(value);
    assert.ok(schema.type || Array.isArray(schema.anyOf), 'Every schema needs a type or supported union');
    for (const key of Object.keys(schema)) assert.ok(supported.has(key), `Unsupported Gemini keyword: ${key}`);
    for (const child of Object.values(object(schema.properties ?? {}))) assertSchema(child);
    for (const key of ['additionalProperties', 'items']) if (schema[key] !== undefined) assertSchema(schema[key]);
    for (const key of ['prefixItems', 'anyOf']) if (Array.isArray(schema[key])) schema[key].forEach(assertSchema);
  }
  const sdk = new GoogleGenAI({ apiKey: settings.geminiKey, httpOptions: { retryOptions: { attempts: 1 }, fetch: async (_url, init) => {
    const body = object(JSON.parse(String(init?.body))); requests.push(body);
    const tools = records(records(body.tools)[0]!.functionDeclarations);
    assert.equal(tools.find(tool => tool.name === 'get_workspace_context')!.parametersJsonSchema, undefined);
    assert.equal(tools.find(tool => tool.name === 'get_wind_in_view')!.parametersJsonSchema, undefined);
    for (const tool of tools) if (tool.parametersJsonSchema) assertSchema(tool.parametersJsonSchema);
    const generation = object(body.generationConfig), schema = object(generation.responseJsonSchema);
    assertSchema(schema);
    const finalActions = object(object(schema.properties).actions);
    assert.equal(finalActions.maxItems, 0); assert.deepEqual(finalActions.items, { type: 'null' });
    assert.equal(generation.responseMimeType, 'application/json');
    assert.equal(object(object(body.toolConfig).functionCallingConfig).mode, 'AUTO');
    assert.equal(JSON.stringify(body).includes(settings.geminiKey), false);
    const parts = requests.length === 1 ? [{ functionCall: { name: 'get_workspace_context', args: {}, id: 'context' }, thoughtSignature: 'synthetic-context-signature' }]
      : requests.length === 2 ? [{ functionCall: { name: 'update_workspace', args: { request_quote: message, actions: staged }, id: 'action' }, thoughtSignature: 'synthetic-action-signature' }]
      : [{ text: JSON.stringify(draft) }];
    assert.ok(requests.length <= 3, 'No automatic retry or unexpected generation');
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } } });
  const wind = new Wind(contracts, 1000, { samples: async () => { throw new Error('No wind provider call is expected'); } });
  try {
    const response = await new Assistant(settings, contracts, new Retrieval(contracts, new Repository()), undefined, new Gemini(settings, sdk), Date.now, undefined, wind)
      .answer({ ...input, message, workspace: { ...workspace, layers: { flights: false, wind: true } } }, undefined, async event => { progress.push(event); });
    assert.equal(response.mode, 'fixture', JSON.stringify(response.errors)); assert.equal(response.answer, draft.answer);
    assert.deepEqual(response.actions, staged); assert.equal(requests.length, 3);
    assert.equal(progress.filter(event => event.type === 'answer_delta').map(event => event.text).join(''), draft.answer);
    const replay = JSON.stringify(requests[2]!.contents);
    assert.ok(replay.includes('synthetic-context-signature')); assert.ok(replay.includes('synthetic-action-signature'));
    assert.ok(replay.includes('workspace_actions_staged'));
    assert.throws(() => contracts.parse('AssistantWorkspaceArgsV3', { unexpected: true }), /Invalid/);
    assert.throws(() => contracts.parse('AssistantDraftV3', { ...draft, actions: staged }), /Invalid/);
  } finally { await wind.close(); }
});

test('v3 sends actual viewport, filter values, originating panel and display order without an intent call', async () => {
  const bed = setup([answer()]); const result = await bed.assistant.answer(input);
  assert.equal(result.protocol_version, 3); assert.equal(result.mode, 'fixture', JSON.stringify(result.errors));
  const context = object(root(bed.captured[0]!).context);
  assert.deepEqual(object(context.workspace).filters, workspace.filters);
  assert.deepEqual(object(context.workspace).viewport, workspace.viewport);
  assert.deepEqual(object(context.workspace).visible_article_ids, [second.id, article.id]);
  assert.equal(records(context.selected)[0]!.label, article.title);
  assert.ok(!bed.captured[0]!.tools.includes('interpret_request'));
  assert.ok(bed.captured[0]!.tools.includes('get_workspace_context'));
  assert.ok(!bed.captured[0]!.tools.includes('get_aircraft_in_view'));
  assert.equal(JSON.stringify(bed.captured).includes(article.url), false);
});
test('new-topic research replaces unrelated restrictions without changing workspace filters', async () => {
  const bed = setup([call('set_research_scope', { filters: {} }), call('search_news'), call('get_article', { id: article.id }), answer({ result_ids: [article.id], citations: [{ source_id: article.source_id, record_id: article.id }], references: [{ record_type: 'article', id: article.id, label: 'Model label is replaced' }] })]);
  const result = await bed.assistant.answer({ ...input, message: 'What about another place?' });
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.deepEqual(result.actions, []);
  assert.deepEqual(result.research_scope, {}); assert.deepEqual(object(result.context).filters, workspace.filters);
  const query = bed.repository.calls.find(row => row.name === 'news')!.input;
  assert.equal(query.keyword, undefined); assert.equal(query.themes, undefined); assert.equal(query.location_ids, undefined);
  assert.equal(records(result.citations)[0]!.url, article.url);
  assert.equal(records(result.references)[0]!.label, article.title);
});
test('ordered recommendations survive as references and details are retrieved again in the next question', async () => {
  const turns = [call('set_research_scope', { filters: {} }), call('search_news'), answer({ result_ids: [second.id, article.id], references: [second, article].map(row => ({ record_type: 'article', id: row.id, label: row.title })) }),
    call('get_article', { id: article.id }), answer({ result_ids: [article.id] })];
  const bed = setup(turns); const first = await bed.assistant.answer(input);
  assert.equal(first.mode, 'fixture', JSON.stringify(first.errors));
  const next = await bed.assistant.answer({ ...input, request_id: 'followup', turn_id: 'turn-2', conversation_id: first.conversation_id, message: 'Tell me more about the second one' });
  assert.equal(next.mode, 'fixture', JSON.stringify(next.errors));
  const context = object(root(bed.captured[3]!).context);
  assert.deepEqual(records(records(context.turns)[0]!.references).map(row => row.id), [second.id, article.id]);
  assert.equal(bed.repository.calls.filter(row => row.name === 'article' && row.input.id === article.id).length, 2);
});
test('natural display wording stages a validated batch without a command-verb gate', async () => {
  const message = 'I want to explore this place';
  const actions = [{ type: 'focus_location', location_id: article.location_ids[0] }, { type: 'set_basemap', basemap: 'satellite' }];
  const bed = setup([call('update_workspace', { request_quote: message, actions }), answer({ answer: 'Your requested view is ready.' })]);
  const result = await bed.assistant.answer({ ...input, message });
  assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.deepEqual(result.actions, actions);
});
test('quoted, negated and read-only action requests never stage changes', async () => {
  for (const [message, quote, mode] of [['Do not zoom here', 'zoom here', 'intent'], ['The article says "zoom here"', 'zoom here', 'intent'], ['Zoom here', 'Zoom here', 'read_only']]) {
    const bed = setup([call('update_workspace', { request_quote: quote, actions: [{ type: 'navigate_map', command: 'zoom_in' }] }), answer()]);
    const result = await bed.assistant.answer({ ...input, message, interaction_mode: mode });
    assert.deepEqual(result.actions, []);
  }
  assert.equal(actionQuote('I want to explore Toronto', 'I want to explore Toronto'), true);
});
test('specific clarification retains its question and short replies resume only that pending task', async () => {
  const turns = [answer({ kind: 'clarification', answer: 'Which Toronto?', clarification_reason: 'ambiguous_location', clarification: { question: 'Toronto, Ontario or Toronto, Ohio?', choices: ['Ontario', 'Ohio'], proposed_actions: [] } })];
  const bed = setup(turns); const first = await bed.assistant.answer({ ...input, message: 'Show me Toronto' });
  assert.equal(first.answer, 'Toronto, Ontario or Toronto, Ohio?'); const pending = object(first.pending);
  turns.push(call('resolve_pending', { id: pending.id, choice: 'Ontario', decision: 'answer' }), answer());
  const next = await bed.assistant.answer({ ...input, request_id: 'reply', turn_id: 'turn-2', conversation_id: first.conversation_id, message: 'Ontario' });
  assert.equal(next.mode, 'fixture', JSON.stringify(next.errors)); assert.equal(next.pending, null);
  assert.equal(root(bed.captured[2]!).underlying_task, 'Show me Toronto');
});
test('proposal confirmation validates exact pending actions, while no and expiration cannot apply them', async () => {
  for (const variant of ['accept', 'negative', 'expired']) {
    let now = Date.parse('2026-10-18T00:00:00Z');
    const actions = [{ type: 'set_basemap', basemap: 'satellite' }];
    const turns = [answer({ kind: 'clarification', clarification_reason: 'ambiguous_intent', clarification: { question: 'Switch to satellite?', choices: [], proposed_actions: actions } })];
    const bed = setup(turns, () => now); const first = await bed.assistant.answer(input);
    const choice = variant === 'negative' ? 'No' : 'Yes';
    if (variant === 'expired') now += 11 * 60000;
    turns.push(call('resolve_pending', { id: object(first.pending).id, choice, decision: 'accept' }), answer());
    const next = await bed.assistant.answer({ ...input, request_id: `reply-${variant}`, turn_id: 'turn-2', conversation_id: first.conversation_id, message: choice });
    assert.deepEqual(next.actions, variant === 'accept' ? actions : []);
  }
});
test('failed synthesis discards staged actions and does not replace the previous pending task', async () => {
  const bed = setup([call('update_workspace', { request_quote: input.message, actions: [{ type: 'set_basemap', basemap: 'satellite' }] }), call('respond', { invalid: true })]);
  const result = await bed.assistant.answer(input);
  assert.equal(result.mode, 'fallback'); assert.deepEqual(result.actions, []);
});
test('conversation references expire and concurrent stale commits are rejected', () => {
  let now = 0; const sessions = new Conversations(() => now), session = sessions.open();
  sessions.commit(session, 0, 'turn-1', [], {}, null, 'task');
  assert.throws(() => sessions.commit(session, 0, 'turn-2', [], {}, null, 'task'), /newer question/);
  now += 31 * 60000; assert.notEqual(sessions.open(session.id).id, session.id);
});
test('v3 HTTP streaming and article opening use real shared schemas without provider/database access', async () => {
  const bed = setup([answer()]);
  const app = await buildApp(config, { contracts, repository: bed.repository, retrieval: bed.retrieval,
    flights: new Flights(contracts, config, []), assistant: bed.assistant });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/assistant', headers: { accept: 'text/event-stream' }, payload: input });
    assert.equal(response.statusCode, 200);
    const events = response.body.trim().split('\n\n').map(line => contracts.parse('AssistantStreamEventV3', JSON.parse(line.slice(6))));
    assert.equal(events.at(-1)!.type, 'complete'); assert.equal(object(events.at(-1)!.response).protocol_version, 3);
    const detail = await app.inject({ url: `/api/articles/${article.id}` });
    assert.equal(detail.statusCode, 200); assert.equal(detail.json().id, article.id);
    assert.equal((await app.inject({ url: '/api/articles/not-a-real-article' })).statusCode, 404);
  } finally { await app.close(); }
});
test('cancellation prevents a late model completion from retaining a pending proposal', async () => {
  const late = deferred<ModelTurn>(), controller = new AbortController(), repository = new Repository();
  const model: Model = { generate: () => late.promise };
  const assistant = new Assistant(config, contracts, new Retrieval(contracts, repository), undefined, model);
  const request = assistant.answer(input, controller.signal); controller.abort();
  await assert.rejects(request);
  late.resolve(answer({ kind: 'clarification', clarification_reason: 'missing_location', clarification: { question: 'Which place?', choices: [], proposed_actions: [] } }));
});
test('a standalone yes cannot authorize an invented action without a live pending proposal', async () => {
  const bed = setup([call('update_workspace', { request_quote: 'Yes', actions: [{ type: 'navigate_map', command: 'zoom_in' }] }), answer()]);
  const result = await bed.assistant.answer({ ...input, message: 'Yes' });
  assert.deepEqual(result.actions, []); assert.equal(result.mode, 'fixture');
});
test('offline trace evaluation scores exact action targets, reference order and independent scope', async () => {
  const bed = setup([answer()]); const result = await bed.assistant.answer(input);
  const expected = { clarification: false, reference_ids: [], research_scope: workspace.filters, actions: [] };
  const score = evaluateAssistantTraces(contracts, [{ request: input, response: result, expected }]);
  assert.equal(score.task_completion, 1); assert.equal(score.network_calls, 0);
  const wrong = evaluateAssistantTraces(contracts, [{ request: input, response: result, expected: { ...expected, actions: [{ type: 'focus_location', location_id: 'wrong-place' }] } }]);
  assert.equal(wrong.action_correctness, 0); assert.equal(wrong.task_completion, 0);
});
test('aircraft research uses the existing cache, caps its projection and preserves coverage/freshness', async () => {
  const now = Date.parse('2026-10-18T12:00:00.000Z'), region = { id: 'test-region', latitude: 43.5, longitude: -79.5, radius_nm: 10 };
  const settings = { ...config, flightsEnabled: true }; let providerCalls = 0;
  const flights = new Flights(contracts, settings, [region], { region: async () => {
    providerCalls++;
    return Array.from({ length: 6 }, (_, index) => contracts.parse('AircraftState', {
      id: `test-aircraft-${index}`, provider: 'adsb.lol', callsign: `TEST${index}`, coordinates: [-79.5, 43.5],
      altitude: null, altitude_unit: 'ft', altitude_reference: 'unknown', speed: null, speed_unit: 'kn', heading: null,
      observed_at: new Date(now).toISOString(), fetched_at: new Date(now).toISOString(), source_url: 'https://api.adsb.lol/', license: 'ODbL-1.0',
    }, true));
  } }, () => now);
  const repository = new Repository(), turns = [call('get_aircraft_in_view'), answer()]; let projected: Data | undefined;
  const model: Model = { generate: async contents => {
    for (const content of contents) for (const part of content.parts ?? []) if (part.functionResponse?.name === 'get_aircraft_in_view') projected = object(part.functionResponse.response);
    return turns.shift()!;
  } };
  try {
    const response = await new Assistant(settings, contracts, new Retrieval(contracts, repository), flights, model, () => now).answer({ ...input,
      workspace: { ...workspace, layers: { flights: true, wind: false }, flight_context: { mode: 'region', region_id: region.id, fetched_at: null, stale: true } } });
    assert.equal(response.mode, 'fixture', JSON.stringify(response.errors)); assert.equal(providerCalls, 1);
    assert.equal(records(projected!.items).length, 5); assert.equal(projected!.truncated, true); assert.equal(projected!.stale, false);
    assert.deepEqual(projected!.coverage, region); assert.match(stringValue(projected!.limitation), /not a total count/);
  } finally { await flights.close(); }
});
test('wind research retains its model estimate, units and source metadata through the shared service', async () => {
  const repository = new Repository(), turns = [call('get_wind_in_view'), answer()]; let projected: Data | undefined, calls = 0;
  const model: Model = { generate: async contents => {
    for (const content of contents) for (const part of content.parts ?? []) if (part.functionResponse?.name === 'get_wind_in_view') projected = object(part.functionResponse.response);
    return turns.shift()!;
  } };
  const wind = new Wind(contracts, 1000, { samples: async points => {
    calls++; return points.map((coordinates, index) => ({ id: `wind-test-${index}`, coordinates, model_coordinates: coordinates, speed_kmh: 10, direction_from_degrees: null, valid_at: new Date().toISOString() }));
  } });
  try {
    const result = await new Assistant(config, contracts, new Retrieval(contracts, repository), undefined, model, Date.now, undefined, wind).answer({ ...input, workspace: { ...workspace, layers: { flights: false, wind: true } } });
    assert.equal(result.mode, 'fixture', JSON.stringify(result.errors)); assert.equal(calls, 1);
    assert.equal(projected!.kind, 'model_estimate'); assert.equal(projected!.height_m, 10);
    assert.equal(projected!.source_url, 'https://open-meteo.com/en/docs'); assert.equal(records(projected!.items)[0]!.speed_kmh, 10);
  } finally { await wind.close(); }
});
function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
