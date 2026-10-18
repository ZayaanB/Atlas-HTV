import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenAI, GenerateContentResponse, FinishReason } from '@google/genai';
import { Gemini } from '../src/services/gemini/client.js';
import { partialStringProperty } from '../src/services/gemini/stream.js';
import { readConfig } from '../src/config.js';
import { deferred } from './support.js';

const config = readConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: 'synthetic-model' });
const declarations = [{ name: 'search_news', parametersJsonSchema: { type: 'object', properties: {} } },
  { name: 'respond', parametersJsonSchema: { type: 'object', properties: { kind: { type: 'string' }, answer: { type: 'string' } } } }];
const chunk = (text: string, finishReason?: FinishReason) => {
  const response = new GenerateContentResponse();
  response.candidates = [{ content: { role: 'model', parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }];
  return response;
};

test('partial JSON extraction handles every escape/Unicode boundary and ignores nested answer keys', () => {
  const json = '{"nested":{"answer":"never expose"},"kind":"answer","answer":"Line\\n\\\"quoted\\\" \\uD83D\\uDE80 \\\\ end"}';
  const expected = JSON.parse(json).answer as string;
  let previous = '';
  for (let end = 1; end <= json.length; end++) {
    const prefix = partialStringProperty(json.slice(0, end), 'answer') ?? '';
    assert.ok(expected.startsWith(prefix)); assert.ok(prefix.startsWith(previous));
    assert.ok(!/[\uD800-\uDBFF]$/.test(prefix)); previous = prefix;
  }
  assert.equal(previous, expected);
  assert.equal(partialStringProperty('{"nested":{"answer":"private"}', 'answer'), undefined);
});

test('Gemini streams actual JSON answer text before completion, keeps thought signatures, and does not dispatch partial tools', async () => {
  const started = deferred<void>(), finish = deferred<void>(), deltas: string[] = [];
  const sdk = { models: {
    generateContent: async () => { throw new Error('Unexpected non-streaming generation'); },
    generateContentStream: async (params: Parameters<GoogleGenAI['models']['generateContent']>[0]) => {
      assert.equal(params.config!.responseMimeType, 'application/json');
      assert.equal(params.config!.toolConfig!.functionCallingConfig!.mode, 'AUTO');
      assert.deepEqual(params.config!.tools, [{ functionDeclarations: [declarations[0]] }]);
      return (async function* () {
        const thought = new GenerateContentResponse();
        thought.candidates = [{ content: { parts: [{ text: 'private reasoning', thought: true, thoughtSignature: 'signature' }] } }];
        yield thought;
        yield chunk('{"kind":"answer","answer":"Documented ');
        await finish.promise;
        yield chunk('evidence [1]."}', FinishReason.STOP);
      })();
    },
  } };
  const result = new Gemini(config, sdk).generate([], declarations, new AbortController().signal, {
    onAnswerDelta: async text => { deltas.push(text); started.resolve(); },
  });
  await started.promise;
  assert.equal(deltas.join(''), 'Documented ');
  finish.resolve(); const turn = await result;
  assert.equal(deltas.join(''), 'Documented evidence [1].');
  assert.equal(JSON.parse(turn.text).answer, deltas.join('')); assert.deepEqual(turn.calls, []);
  assert.equal(turn.content.parts![0]!.thoughtSignature, 'signature');
  assert.ok(!deltas.join('').includes('private'));
});

test('cancelled SDK streams release promptly and ignore late chunks even when a transport ignores abort', async () => {
  const started = deferred<void>(), finish = deferred<void>(), controller = new AbortController(), deltas: string[] = [];
  const model = new Gemini(config, { models: { generateContent: async () => { throw new Error('Unexpected generation'); },
    generateContentStream: async () => (async function* () {
      yield chunk('{"kind":"answer","answer":"Provisional '); await finish.promise;
      yield chunk('late"}', FinishReason.STOP);
    })(),
  } });
  const work = model.generate([], declarations, controller.signal, { onAnswerDelta: async text => { deltas.push(text); started.resolve(); } });
  await started.promise; controller.abort();
  await assert.rejects(work, /cancelled/);
  finish.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(deltas.join(''), 'Provisional ');
});

test('truncated streamed text is never accepted as a complete model turn', async () => {
  const model = new Gemini(config, { models: { generateContent: async () => { throw new Error('Unexpected generation'); },
    generateContentStream: async () => (async function* () { yield chunk('{"kind":"answer","answer":"Incomplete', FinishReason.MAX_TOKENS); })(),
  } });
  await assert.rejects(model.generate([], declarations, new AbortController().signal, { onAnswerDelta: async () => {} }), /token limit/);
});

test('official SDK uses one streaming request with a JSON schema and no automatic tool execution', async () => {
  let requests = 0;
  const sdk = new GoogleGenAI({ apiKey: 'synthetic-no-network-key', httpOptions: { retryOptions: { attempts: 1 }, fetch: async (_url, init) => {
    requests++; const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.generationConfig.responseJsonSchema);
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"kind":"answer","answer":"Stream [1]."}' }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } } });
  const deltas: string[] = [];
  const result = await new Gemini(config, sdk).generate([{ role: 'user', parts: [{ text: 'Synthetic SDK stream test' }] }], declarations, new AbortController().signal, { onAnswerDelta: async text => { deltas.push(text); } });
  assert.equal(JSON.parse(result.text).answer, 'Stream [1].'); assert.deepEqual(deltas, ['Stream [1].']); assert.equal(requests, 1);
});
