import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {Retrieval} from '../src/services/retrieval.js';
import {Flights} from '../src/services/flights.js';
import {Assistant} from '../src/services/gemini/orchestrator.js';
import type {Model} from '../src/services/gemini/client.js';
import {testContracts,TestRepository,protocolArticle,deferred} from './support.js';

const input={request_id:'http-test',message:'Explain the synthetic test record',timezone:'America/Toronto',filters:{}};
const draft={answer:'Synthetic transport-test answer',citations:[{record_id:'test-record',source_id:'source-test-record'}],result_ids:['test-record'],actions:[]};
async function server(model: Model,requestTimeoutMs=2000) {
  const config=readConfig({NODE_ENV:'test',REQUEST_TIMEOUT_MS:String(requestTimeoutMs),AI_REQUEST_TIMEOUT_MS:'2000'});
  const contracts=testContracts(),repository=new TestRepository({news:[protocolArticle()],sources:[{id:'source-test-record',title:'Synthetic source',url:'https://example.invalid/test-record'}]});
  const retrieval=new Retrieval(contracts,repository),flights=new Flights(contracts,config,[]);
  const app=await buildApp(config,{contracts,repository,retrieval,flights,assistant:new Assistant(config,contracts,retrieval,flights,model)});
  const url=await app.listen({host:'127.0.0.1',port:0});
  return {app,url};
}
test('a complete real HTTP JSON body is not mistaken for a disconnected assistant request',{timeout:5000},async()=>{
  let calls=0;
  const {app,url}=await server({generate:async(_contents,_declarations,signal)=>{
    calls++;assert.equal(signal.aborted,false);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(signal.aborted,false);
    return {content:{role:'model',parts:[]},text:'',calls:[{name:'respond',args:draft}]};
  }});
  try {
    const response=await fetch(url+'/api/assistant',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    assert.equal(response.status,200);const body=await response.json() as Record<string,unknown>;
    assert.equal(body.request_id,input.request_id);assert.equal(body.mode,'fixture');assert.equal(calls,1);
  } finally {await app.close();}
});
test('a real HTTP POST deadline returns structured 503 and aborts outstanding model work',{timeout:5000},async()=>{
  let modelSignal: AbortSignal|undefined;
  const {app,url}=await server({generate:async(_contents,_declarations,signal)=>{modelSignal=signal;return new Promise(()=>{});}},100);
  try {
    const response=await fetch(url+'/api/assistant',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    assert.equal(response.status,503);assert.equal((await response.json() as {error:{code:string}}).error.code,'REQUEST_TIMEOUT');
    assert.equal(modelSignal?.aborted,true);
  } finally {await app.close();}
});
test('disconnecting after a complete POST body still cancels the in-flight assistant',{timeout:5000},async()=>{
  const entered=deferred<void>(),aborted=deferred<void>();
  const {app,url}=await server({generate:async(_contents,_declarations,signal)=>{
    signal.addEventListener('abort',()=>aborted.resolve(),{once:true});entered.resolve();return new Promise(()=>{});
  }});
  const body=JSON.stringify(input);
  const client=httpRequest(url+'/api/assistant',{method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}});
  client.on('error',()=>{});
  try {client.end(body);await entered.promise;client.destroy();await aborted.promise;}
  finally {client.destroy();await app.close();}
});
