import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GenerateContentResponse,FinishReason,FunctionCallingConfigMode,type GenerateContentParameters} from '@google/genai';
import {Gemini} from '../src/services/gemini/client.js';
import {readConfig} from '../src/config.js';
import {modelFailure} from '../src/services/gemini/errors.js';

const config=readConfig({NODE_ENV:'test',GEMINI_API_KEY:'synthetic-secret-key',GEMINI_MODEL:'synthetic-model'});
const declaration={name:'search_news',parametersJsonSchema:{type:'object',properties:{}}};
test('demo SDK configuration gives reasoning and signatures room beyond the ordinary 64 KB content cap',async()=>{
  const response=new GenerateContentResponse();
  response.candidates=[{finishReason:FinishReason.STOP,content:{role:'model',parts:[{text:'x'.repeat(70000),thought:true},{functionCall:{name:'search_news',args:{}}}]}}];
  const demo=readConfig({NODE_ENV:'test',AI_DEMO_MODE:'true',GEMINI_API_KEY:'synthetic-key',GEMINI_MODEL:'synthetic-model'});
  const sdk={models:{generateContent:async(params:GenerateContentParameters)=>{
    assert.equal(params.config!.maxOutputTokens,65536); return response;
  }}};
  const turn=await new Gemini(demo,sdk).generate([],[declaration],new AbortController().signal);
  assert.equal(turn.text,''); assert.equal(turn.calls[0]!.name,'search_news');
  await assert.rejects(new Gemini(config,{models:{generateContent:async()=>response}}).generate([],[declaration],new AbortController().signal),/output bound/);
});
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
  for (const env of [{AI_MAX_OUTPUT_TOKENS:'65537'},{AI_MAX_OUTPUT_TOKENS:'511'},{GEMINI_THINKING_LEVEL:'unbounded'}])
    assert.throws(()=>readConfig(env),/Invalid/);
});

test('failure diagnostics distinguish provider errors, transport timeouts and DNS failures without disclosing raw details', () => {
  const privateMessage='synthetic-private-prompt-and-key https://private.invalid/';
  for (const [error,code,fragment] of [
    [Object.assign(new Error(privateMessage),{status:503}),'GEMINI_UNAVAILABLE','provider HTTP 503'],
    [Object.assign(new Error(privateMessage),{status:500}),'GEMINI_UNAVAILABLE','provider HTTP 500'],
    [Object.assign(new Error(privateMessage),{status:504}),'GEMINI_TIMEOUT','provider HTTP 504'],
    [new DOMException(privateMessage,'AbortError'),'GEMINI_TIMEOUT','timed out'],
    [new DOMException(privateMessage,'TimeoutError'),'GEMINI_TIMEOUT','timed out'],
    [new TypeError(privateMessage,{cause:{code:'ENOTFOUND',hostname:'private.invalid'}}),'GEMINI_NETWORK_ERROR','network connection'],
    [new TypeError(privateMessage,{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}}),'GEMINI_TIMEOUT','timed out'],
  ] as const) {
    const failure=modelFailure(error);
    assert.equal(failure.code,code);assert.equal(failure.retryable,true);assert.ok(failure.message.includes(fragment));
    assert.ok(!JSON.stringify(failure).includes('private')); assert.ok(!failure.message.includes(privateMessage));
  }
});

test('HTTP 400 diagnostics identify the configuration area using fixed text and never echo provider content', () => {
  for (const [message,code,fragment] of [
    ['GenerateContentRequest.tools[0].function_declarations[8].parameters_json_schema.properties: should be non-empty for OBJECT type','GEMINI_REQUEST_REJECTED','empty object'],
    ['response_json_schema: schema too complex with too many states','GEMINI_REQUEST_REJECTED','complexity limit'],
    ['generationConfig.responseJsonSchema: unsupported schema','GEMINI_REQUEST_REJECTED','structured answer schema'],
    ['functionDeclarations: invalid parameters','GEMINI_REQUEST_REJECTED','function declaration'],
    ['thinking_config.thinking_level is unsupported','GEMINI_REQUEST_REJECTED','thinking configuration'],
    ['API_KEY_INVALID','GEMINI_AUTH_FAILED','API key'],
  ]) {
    const error=Object.assign(new Error(JSON.stringify({error:{message:`${message}; synthetic-private-prompt-and-key https://private.invalid/`}})),{status:400});
    const failure=modelFailure(error);
    assert.equal(failure.code,code); assert.match(failure.message,new RegExp(fragment!));
    assert.ok(!failure.message.includes('synthetic')); assert.ok(!failure.message.includes('private.invalid'));
  }
});

test('official SDK serializes the actual v2 interpretation schema and preserves sanitized provider status with one stubbed request', async () => {
  const {GoogleGenAI}=await import('@google/genai');
  const {modelParameters}=await import('../src/services/gemini/schema.js');
  const {loadHandoffs}=await import('../src/runtime/handoffs.js');
  const {contracts}=await loadHandoffs(readConfig({NODE_ENV:'test',ATLAS_CONTRACTS_MODULE:'contracts/dist/index.js'}));
  let requests=0;
  const sdk=new GoogleGenAI({apiKey:'synthetic-no-network-key',httpOptions:{retryOptions:{attempts:1},fetch:async (_url,init)=>{
    requests++;const body=JSON.parse(String(init?.body));
    assert.equal(body.tools[0].functionDeclarations[0].name,'interpret_request');
    assert.equal(body.generationConfig?.temperature,undefined);
    return new Response(JSON.stringify({error:{code:503,message:'synthetic-private-provider-response',status:'UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}});
  }}});
  const model=new Gemini(config,sdk);
  await assert.rejects(model.generate([{role:'user',parts:[{text:'Synthetic question.'}]}],[{name:'interpret_request',parametersJsonSchema:modelParameters(contracts,'AssistantIntent')}],new AbortController().signal,{forceTool:'interpret_request'}),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/provider HTTP 503/);assert.ok(!error.message.includes('private-provider'));return true;
  });
  assert.equal(requests,1);
});
