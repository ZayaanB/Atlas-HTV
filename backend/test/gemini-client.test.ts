import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GenerateContentResponse,FinishReason,FunctionCallingConfigMode} from '@google/genai';
import {Gemini} from '../src/services/gemini/client.js';
import {readConfig} from '../src/config.js';
import {modelFailure} from '../src/services/gemini/errors.js';

const config=readConfig({NODE_ENV:'test',GEMINI_API_KEY:'synthetic-secret-key',GEMINI_MODEL:'synthetic-model'});
const declaration={name:'search_news',parametersJsonSchema:{type:'object',properties:{}}};
test('SDK adapter preserves original model parts/signatures, suppresses thought text and manually controls tool calling',async () => {
  const response=new GenerateContentResponse();
  const content={role:'model',parts:[{text:'private synthetic reasoning',thought:true},{functionCall:{name:'search_news',args:{},id:'call-1'},thoughtSignature:'synthetic-signature'}]};
  response.candidates=[{finishReason:FinishReason.STOP,content}];
  const model=new Gemini(config,{models:{generateContent:async params=>{
    assert.equal(params.model,'synthetic-model');
    assert.equal(params.config!.automaticFunctionCalling!.disable,true);
    assert.equal(params.config!.toolConfig!.functionCallingConfig!.mode,FunctionCallingConfigMode.ANY);
    assert.deepEqual(params.config!.toolConfig!.functionCallingConfig!.allowedFunctionNames,['search_news']);
    assert.ok(!JSON.stringify(params).includes('synthetic-secret-key'));
    return response;
  }}});
  const turn=await model.generate([{role:'user',parts:[{text:'Synthetic request'}]}],[declaration],new AbortController().signal,{forceTool:'search_news'});
  assert.equal(turn.content,content); assert.equal(turn.text,'');
  assert.deepEqual(turn.calls,[{name:'search_news',args:{},id:'call-1'}]);
});
test('SDK adapter refuses incomplete/blocked output and redacts API failures',async () => {
  for (const [reason,expected] of [[FinishReason.MAX_TOKENS,'MODEL_TRUNCATED'],[FinishReason.SAFETY,'MODEL_OUTPUT_REJECTED'],[FinishReason.MALFORMED_FUNCTION_CALL,'MODEL_OUTPUT_REJECTED']] as const) {
    const response=new GenerateContentResponse(); response.candidates=[{finishReason:reason,content:{role:'model',parts:[{text:'Incomplete synthetic answer'}]}}];
    await assert.rejects(new Gemini(config,{models:{generateContent:async()=>response}}).generate([],[],new AbortController().signal),error=>error instanceof Error && 'code' in error && error.code===expected);
  }
  for (const [status,expected] of [[400,'GEMINI_REQUEST_REJECTED'],[403,'GEMINI_AUTH_FAILED'],[404,'GEMINI_MODEL_UNAVAILABLE'],[429,'GEMINI_RATE_LIMITED'],[500,'GEMINI_UNAVAILABLE']]) {
    const error=Object.assign(new Error('key=synthetic-secret-key'),{status});
    assert.equal(modelFailure(error).code,expected);
    await assert.rejects(new Gemini(config,{models:{generateContent:async()=>{throw error;}}}).generate([],[],new AbortController().signal),failure=>failure instanceof Error && !failure.message.includes('synthetic-secret-key'));
  }
});
test('cancelled calls and undeclared forced tools cannot start an SDK request',async () => {
  let requests=0;
  const model=new Gemini(config,{models:{generateContent:async()=>{requests++;return new GenerateContentResponse();}}});
  await assert.rejects(model.generate([],[declaration],AbortSignal.abort()),/cancelled/);
  await assert.rejects(model.generate([],[declaration],new AbortController().signal,{forceTool:'fetch_url'}),/must be declared/);
  await assert.rejects(model.generate([],[{...declaration,description:'x'.repeat(config.aiMaxContextBytes)}],new AbortController().signal),/context bound/);
  assert.equal(requests,0);
});
test('production finalization requires declared tools and uses bounded output/thinking configuration', async () => {
  const config=readConfig({NODE_ENV:'test',GEMINI_API_KEY:'synthetic-key',GEMINI_MODEL:'synthetic-model',GEMINI_THINKING_LEVEL:'low',AI_MAX_OUTPUT_TOKENS:'4096'});
  const response=new GenerateContentResponse();
  response.candidates=[{finishReason:FinishReason.STOP,content:{role:'model',parts:[{functionCall:{name:'respond',args:{}}}]}}];
  const model=new Gemini(config,{models:{generateContent:async params=>{
    assert.equal(params.config!.toolConfig!.functionCallingConfig!.mode,FunctionCallingConfigMode.ANY);
    assert.equal(params.config!.maxOutputTokens,4096);
    assert.equal(params.config!.thinkingConfig!.thinkingLevel,'LOW');
    assert.equal(params.config!.automaticContinuation,false);
    return response;
  }}});
  assert.equal((await model.generate([],[{name:'respond',parametersJsonSchema:{type:'object'}}],new AbortController().signal)).calls[0]!.name,'respond');
  for (const env of [{AI_MAX_OUTPUT_TOKENS:'16385'},{AI_MAX_OUTPUT_TOKENS:'511'},{GEMINI_THINKING_LEVEL:'unbounded'}])
    assert.throws(()=>readConfig(env),/Invalid/);
});
