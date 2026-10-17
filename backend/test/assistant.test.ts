import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { Retrieval } from '../src/services/retrieval.js';
import { EvidenceLedger } from '../src/services/gemini/citations.js';
import { Tools } from '../src/services/gemini/tools.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import type { Model, ModelTurn } from '../src/services/gemini/client.js';
import { deferred, protocolArticle, testContracts, TestRepository } from './support.js';
const input = {request_id:'test-request',message:'Describe the test record',timezone:'America/Toronto',filters:{}};
const draft = {answer:'Synthetic protocol answer',citations:[{source_id:'source-test-record',record_id:'test-record'}],result_ids:['test-record'],actions:[]};
function setup(model?: Model, config = readConfig({NODE_ENV:'test'})) {
  const contracts = testContracts(), repo = new TestRepository({news:[protocolArticle()],sources:[{id:'source-test-record',url:'https://example.invalid/test-record',title:'Synthetic source'}],locations:[{id:'test-place',name:'Synthetic place'}]});
  const retrieval = new Retrieval(contracts,repo);
  return {contracts,repo,retrieval,assistant:new Assistant(config,contracts,retrieval,undefined,model)};
}
const final = (value: unknown): ModelTurn => ({content:{role:'model',parts:[{text:JSON.stringify(value)}]},text:JSON.stringify(value),calls:[]});
test('ledger rejects invented citations, mismatched URLs and unrelated source/record pairs',() => {
  const contracts = testContracts(), ledger = new EvidenceLedger();
  ledger.collect([protocolArticle('test-a'),protocolArticle('test-b')]);
  ledger.attach([{id:'source-test-a',url:'https://example.invalid/a',title:'Synthetic A'},{id:'source-test-b',url:'https://example.invalid/b',title:'Synthetic B'}]);
  assert.throws(() => ledger.resolve([{source_id:'invented',record_id:'test-a'}],contracts),/not retrieved/);
  assert.throws(() => ledger.resolve([{source_id:'source-test-a',record_id:'test-a',url:'https://evil.invalid/'}],contracts),/does not match/);
  assert.throws(() => ledger.resolve([{source_id:'source-test-b',record_id:'test-a'}],contracts),/does not support/);
  assert.equal(ledger.resolve([{source_id:'source-test-a',record_id:'test-a'}],contracts)[0]!.url,'https://example.invalid/a');
});
test('actions accept only known locations and shared validated filter shapes',async () => {
  const {contracts,retrieval} = setup(), tools = new Tools(contracts,retrieval);
  await assert.rejects(tools.action({type:'focus_location',location_id:'invented'}),/not found/);
  await assert.rejects(tools.action({type:'execute_sql',sql:'select 1'}),/Invalid UIAction/);
  await assert.rejects(tools.action({type:'set_filters',filters:{location_ids:['invented']}}),/not found/);
  assert.deepEqual(await tools.action({type:'focus_location',location_id:'test-place'}),{type:'focus_location',location_id:'test-place'});
});
test('valid synthesis resolves original URLs and explicitly labels synthetic data',async () => {
  const {assistant} = setup({generate:async () => final(draft)});
  const result = await assistant.answer(input);
  assert.equal(result.mode,'fixture');
  assert.equal((result.citations as {url:string}[])[0]!.url,'https://example.invalid/test-record');
  assert.deepEqual(result.actions,[]);
});
test('invalid citation/action/output and provider failures yield fallback with no pending actions',async () => {
  for (const value of [{...draft,citations:[{source_id:'invented',record_id:'test-record'}]},
    {...draft,actions:[{type:'focus_location',location_id:'invented'}]}, {...draft,result_ids:['invented']}]) {
    const {assistant} = setup({generate:async () => final(value)});
    const response = await assistant.answer(input);
    assert.equal(response.mode,'fallback'); assert.deepEqual(response.actions,[]);
  }
  const {assistant} = setup({generate:async () => { throw new Error('secret-provider-error'); }});
  const result = await assistant.answer(input);
  assert.equal(result.mode,'fallback'); assert.ok(!JSON.stringify(result).includes('secret-provider-error'));
});
test('tool loop uses canonical retrieval and preserves model content for function responses',async () => {
  let turns = 0;
  const {assistant,repo} = setup({generate:async contents => {
    turns++;
    if (turns === 1) return {content:{role:'model',parts:[{functionCall:{name:'search_news',args:{keyword:'synthetic'}}}]},calls:[{name:'search_news',args:{keyword:'synthetic'}}],text:''};
    assert.equal(contents.at(-1)!.role,'user');
    return final(draft);
  }});
  assert.equal((await assistant.answer(input)).mode,'fixture');
  assert.ok(repo.calls.some(call => call.name === 'news' && call.input.keyword === 'synthetic'));
});
test('timeouts/cancellation never emit stale UI actions and iteration limits cannot run forever',async () => {
  const {assistant} = setup({generate:async () => new Promise(() => {})},readConfig({NODE_ENV:'test',AI_REQUEST_TIMEOUT_MS:'100'}));
  await assert.rejects(assistant.answer(input),/cancelled or timed out/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(assistant.answer(input,controller.signal));
  const looping = setup({generate:async () => ({content:{role:'model',parts:[]},calls:[{name:'search_news',args:{}}],text:''})});
  assert.equal((await looping.assistant.answer(input)).mode,'fallback');
});
test('read-only assistant requests cannot apply workspace changes',async () => {
  const {assistant} = setup({generate:async () => final({...draft,actions:[{type:'focus_location',location_id:'test-place'}]})});
  const result = await assistant.answer(input); assert.equal(result.mode,'fallback'); assert.deepEqual(result.actions,[]);
  const enabled = await assistant.answer({...input,allow_ui_actions:true});
  assert.equal(enabled.mode,'fixture'); assert.deepEqual(enabled.actions,[{type:'focus_location',location_id:'test-place'}]);
});
test('search tools inherit active filters and cannot silently replace geography',async () => {
  const {contracts,retrieval} = setup(), tools = new Tools(contracts,retrieval,undefined,{location_ids:['test-place']});
  const result = await tools.dispatch('search_news',{keyword:'synthetic'});
  assert.equal((result.items as unknown[]).length,1);
  await assert.rejects(tools.dispatch('search_news',{location_ids:['another-place']}),/set_filters/);
});
test('a model response arriving after cancellation cannot dispatch proposed tools',async () => {
  const modelTurn = deferred<ModelTurn>(), entered = deferred<void>();
  const {assistant,repo} = setup({generate:async () => {entered.resolve(); return modelTurn.promise;}});
  const controller = new AbortController();
  const pending = assistant.answer({...input,allow_ui_actions:true},controller.signal);
  await entered.promise;
  const readsBeforeCancellation = repo.calls.length;
  controller.abort(); await assert.rejects(pending,/cancelled/);
  modelTurn.resolve({content:{role:'model',parts:[]},text:'',calls:[{name:'focus_location',args:{location_id:'test-place'}}]});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(repo.calls.length,readsBeforeCancellation);
});
test('already-cancelled assistant input starts no retrieval or model work',async () => {
  let called = false;
  const {assistant,repo} = setup({generate:async () => {called = true; return final(draft);}});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(assistant.answer(input,controller.signal),/cancelled/);
  assert.equal(repo.calls.length,0); assert.equal(called,false);
});
