import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { loadHandoffs } from '../src/runtime/handoffs.js';
import { Retrieval } from '../src/services/retrieval.js';
import { Flights } from '../src/services/flights.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import type { Model } from '../src/services/gemini/client.js';
import { records, type Data } from '../src/services/validation.js';
import { deferred, TestRepository } from './support.js';

const config = readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js', AI_MAX_ROUNDS: '6' });
const { contracts } = await loadHandoffs(config);
const core = JSON.parse(await readFile(new URL('../../contracts/examples/helene-core.json', import.meta.url), 'utf8'));
const research = JSON.parse(await readFile(new URL('../../contracts/examples/helene-research.json', import.meta.url), 'utf8'));
const input = { protocol_version: 2, interaction_mode: 'intent', request_id: 'stream-http', message: 'Explain the stored source', timezone: 'UTC', filters: {} };
const intent = { actions: [], filter_keys: [], clear_filters: [], clarification_reason: null, date_expression: null, date_target: null, use_current_area: false };
const draft = { kind: 'answer', answer: 'Synthetic streamed answer [1].', citations: [{ source_id: core.articles[0].source_id, record_id: core.articles[0].id }], result_ids: [core.articles[0].id], actions: [], clarification_reason: null };
async function server(model: Model, requestTimeoutMs = 2000) {
  const settings = { ...config, requestTimeoutMs };
  const repository = new TestRepository({ news: core.articles, sources: core.sources, locations: core.locations, workspace: [research.workspace] });
  const retrieval = new Retrieval(contracts, repository), flights = new Flights(contracts, settings, []);
  const app = await buildApp(settings, { contracts, repository, retrieval, flights, assistant: new Assistant(settings, contracts, retrieval, flights, model) });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, url };
}
const post = (url: string, signal?: AbortSignal) => fetch(url + '/api/assistant', {
  method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...(signal ? { signal } : {}),
});

test('real HTTP delivers progressive text before final citation validation and a single complete v2 response', { timeout: 5000 }, async () => {
  const finish = deferred<void>(); let calls = 0;
  const { app, url } = await server({ generate: async (_contents, _tools, _signal, options) => {
    if (++calls === 1) return { content: { parts: [] }, text: '', calls: [{ name: 'interpret_request', args: intent }] };
    if (calls === 2) return { content: { parts: [] }, text: '', calls: [{ name: 'search_news', args: {} }] };
    await options!.onAnswerDelta!('Synthetic streamed '); await finish.promise;
    await options!.onAnswerDelta!('answer [1].');
    return { content: { parts: [] }, text: JSON.stringify(draft), calls: [] };
  } });
  try {
    const response = await post(url); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body!.getReader(); let body = '';
    while (!body.includes('answer_delta')) { const part = await reader.read(); assert.equal(part.done, false, body); body += new TextDecoder().decode(part.value); }
    assert.ok(!body.includes('"type":"complete"'));
    finish.resolve();
    while (true) { const part = await reader.read(); if (part.done) break; body += new TextDecoder().decode(part.value); }
    const events = body.trim().split('\n\n').map(frame => contracts.parse('AssistantStreamEvent', JSON.parse(frame.slice(6)), true));
    const complete = events.filter(event => event.type === 'complete'); assert.equal(complete.length, 1);
    const result = complete[0]!.response as Data;
    assert.equal(result.answer, draft.answer); assert.equal(records(result.citations).length, 1); assert.deepEqual(result.actions, []);
    assert.equal(calls, 3);
  } finally { finish.resolve(); await app.close(); }
});

test('citation formatting does not interrupt or replace a streamed answer', { timeout: 5000 }, async () => {
  let calls = 0;
  const { app, url } = await server({ generate: async (_contents, _tools, _signal, options) => {
    if (++calls === 1) return { content: { parts: [] }, text: '', calls: [{ name: 'interpret_request', args: intent }] };
    if (calls === 2) return { content: { parts: [] }, text: '', calls: [{ name: 'search_news', args: {} }] };
    await options!.onAnswerDelta!('Unsupported [9].');
    return { content: { parts: [] }, text: JSON.stringify({ ...draft, answer: 'Unsupported [9].' }), calls: [] };
  } });
  try {
    const body = await (await post(url)).text();
    const events = body.trim().split('\n\n').map(frame => JSON.parse(frame.slice(6)));
    const result = events.find(event => event.type === 'complete').response;
    contracts.parse('AssistantResponseV2', result, true);
    assert.equal(result.mode, 'fixture'); assert.deepEqual(result.actions, []); assert.deepEqual(result.errors, []);
    assert.equal(result.answer, 'Unsupported [9].'); assert.equal(result.citations.length, 1);
  } finally { await app.close(); }
});

test('disconnecting during streaming cancels the assistant and prevents a late final response', { timeout: 5000 }, async () => {
  const entered = deferred<void>(), aborted = deferred<void>(), finish = deferred<void>(); let calls = 0;
  const { app, url } = await server({ generate: async (_contents, _tools, signal, options) => {
    if (++calls === 1) return { content: { parts: [] }, text: '', calls: [{ name: 'interpret_request', args: intent }] };
    if (calls === 2) return { content: { parts: [] }, text: '', calls: [{ name: 'search_news', args: {} }] };
    signal.addEventListener('abort', () => aborted.resolve(), { once: true });
    await options!.onAnswerDelta!('Provisional '); entered.resolve(); await finish.promise;
    return { content: { parts: [] }, text: JSON.stringify(draft), calls: [] };
  } });
  const controller = new AbortController();
  try {
    const response = await post(url, controller.signal); await entered.promise;
    controller.abort(); await aborted.promise; finish.resolve();
    await assert.rejects(response.text()); assert.equal(calls, 3);
  } finally { finish.resolve(); await app.close(); }
});

test('HTTP deadline after stream headers cancels outstanding generation and terminates the response', { timeout: 5000 }, async () => {
  let signal: AbortSignal | undefined;
  const { app, url } = await server({ generate: async (_contents, _tools, current) => { signal = current; return new Promise(() => {}); } }, 100);
  try {
    const response = await post(url);
    await assert.rejects(response.text()); assert.equal(signal?.aborted, true);
  } finally { await app.close(); }
});
