import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { Contracts } from '../src/services/validation.js';
import { UnavailableRepository, PgRepository } from '../src/data/queries.js';
import { Retrieval } from '../src/services/retrieval.js';
import { Flights } from '../src/services/flights.js';
import { Assistant } from '../src/services/gemini/orchestrator.js';
import type pg from 'pg';
import { deferred, protocolArticle, testContracts, TestRepository } from './support.js';
test('configuration fails closed without exposing credentials and accepts valid bounds',() => {
  for (const env of [{PORT:'x'},{DATABASE_URL:'postgres://secret@host/db?sslmode=no-verify'},{GEMINI_API_KEY:'secret'},{AI_MAX_TOOL_CALLS:'999'},{FLIGHTS_ENABLED:'yes'}]) assert.throws(() => readConfig(env));
  assert.equal(readConfig({PORT:'3100'}).port,3100);
});
test('demo configuration overrides old research caps while ordinary profiles and explicit uncapped research remain available',()=>{
  const demo=readConfig({NODE_ENV:'test',AI_DEMO_MODE:'true',AI_MAX_ROUNDS:'6',AI_MAX_TOOL_CALLS:'8',AI_REQUEST_TIMEOUT_MS:'50000',AI_MAX_CONTEXT_BYTES:'128000',AI_MAX_OUTPUT_TOKENS:'16384',AI_MAX_CONCURRENT:'2'});
  assert.equal(demo.aiMaxRounds,0); assert.equal(demo.aiMaxTools,0); assert.equal(demo.aiTimeoutMs,600000);
  assert.equal(demo.aiMaxContextBytes,1048576); assert.equal(demo.aiMaxOutputTokens,65536); assert.equal(demo.aiConcurrency,8);
  const ordinary=readConfig({NODE_ENV:'test'});
  assert.equal(ordinary.aiDemoMode,false); assert.equal(ordinary.aiMaxRounds,4); assert.equal(ordinary.aiMaxTools,8);
  const uncapped=readConfig({AI_MAX_ROUNDS:'0',AI_MAX_TOOL_CALLS:'0'});
  assert.equal(uncapped.aiMaxRounds,0); assert.equal(uncapped.aiMaxTools,0);
  assert.throws(()=>readConfig({AI_DEMO_MODE:'yes'}),/Invalid AI_DEMO_MODE/);
});
test('liveness is usable without setup; readiness/data accurately report missing contracts',async () => {
  const app = await buildApp(readConfig({NODE_ENV:'test'}));
  try {
    assert.equal((await app.inject('/api/health/live')).statusCode,200);
    const ready = await app.inject('/api/health'); assert.equal(ready.statusCode,503);
    assert.equal(ready.json().data_mode,'unavailable');
    const news = await app.inject('/api/news'); assert.equal(news.statusCode,503); assert.equal(news.json().error.code,'CONTRACTS_UNAVAILABLE');
    assert.equal((await app.inject('/api/unknown')).json().error.code,'NOT_FOUND');
    assert.equal((await app.inject({method:'POST',url:'/api/assistant',headers:{'content-type':'application/json'},payload:'{'})).statusCode,400);
  } finally { await app.close(); }
});
test('errors redact database/provider details; close releases owned repository',async () => {
  const config = readConfig({NODE_ENV:'test'}), contracts = testContracts(), repository = new TestRepository();
  repository.read = async () => { throw new Error('password=secret SELECT private_data'); };
  const retrieval = new Retrieval(contracts,repository), flights = new Flights(contracts,config,[]);
  const app = await buildApp(config,{contracts,repository,retrieval,flights,assistant:new Assistant(config,contracts,retrieval,flights)});
  const response = await app.inject('/api/news'); assert.equal(response.statusCode,500);
  assert.ok(!response.body.includes('secret')); assert.ok(!response.body.includes('SELECT'));
  await app.close(); assert.equal(repository.closed,true);
});
test('pg query values are parameterized; transactions roll back without SQL construction',async () => {
  const calls: {text:string;values?:unknown[]}[] = [];
  const query = async (input: string | {text:string;values:unknown[]}) => {
    calls.push(typeof input === 'string' ? {text:input} : input);
    if (typeof input !== 'string' && input.values[0] === 'fail') throw new Error('failure');
    return {rows:[]};
  };
  let released = false;
  const pool = {query,connect:async () => ({query,release:() => {released = true;}}),end:async () => {}} as unknown as pg.Pool;
  const repo = new PgRepository(pool,{version:'atlas-p3-v1',plans:{news:{text:'SELECT record FROM approved_handoff WHERE title = $1',parameters:['keyword']},upsert_articles:{text:'SELECT approved_import($1)',parameters:['id']}}});
  const attack = "'; DROP TABLE test;--";
  await repo.read('news',{keyword:attack});
  assert.equal(calls[0]!.values![0],attack); assert.ok(!calls[0]!.text.includes(attack));
  await assert.rejects(repo.writeBatch('upsert_articles',[{id:'fail'}]));
  assert.equal(calls.at(-1)!.text,'ROLLBACK'); assert.equal(released,true);
  await assert.rejects(new UnavailableRepository().read(),/handoff/);
});
function appServices(config: ReturnType<typeof readConfig>, repository = new TestRepository()) {
  const contracts = testContracts(), retrieval = new Retrieval(contracts,repository), flights = new Flights(contracts,config,[]);
  return {contracts,repository,retrieval,flights,assistant:new Assistant(config,contracts,retrieval,flights)};
}
test('demo chat bypasses the assistant throttle and the short manual HTTP deadline without disabling other route limits',async()=>{
  const config={...readConfig({NODE_ENV:'test',AI_DEMO_MODE:'true',RATE_LIMIT_MAX:'1'}),requestTimeoutMs:10};
  const services=appServices(config,new TestRepository({news:[protocolArticle()],sources:[{id:'source-test-record',title:'Synthetic source',url:'https://example.invalid/test-record'}]}));
  let calls=0;
  services.assistant=new Assistant(config,services.contracts,services.retrieval,services.flights,{generate:async()=>{
    calls++; await new Promise(resolve=>setTimeout(resolve,20));
    return {content:{role:'model',parts:[]},text:'',calls:[{name:'respond',args:{answer:'Demo response',citations:[{record_id:'test-record',source_id:'source-test-record'}],result_ids:['test-record'],actions:[]}}]};
  }});
  const app=await buildApp(config,services);
  try {
    for(let index=0;index<14;index++) {
      const response=await app.inject({method:'POST',url:'/api/assistant',payload:{request_id:`demo-${index}`,message:'Continue researching',timezone:'UTC',filters:{}}});
      assert.equal(response.statusCode,200,response.body); assert.equal(response.json().answer,'Demo response');
    }
    assert.equal(calls,14);
    assert.equal((await app.inject('/api/health/live')).statusCode,200);
    assert.equal((await app.inject('/api/health/live')).statusCode,429);
  } finally {await app.close();}
});
test('rate limiting returns a stable 429 envelope and Retry-After rather than a 500',async () => {
  const config = readConfig({NODE_ENV:'test',RATE_LIMIT_MAX:'1'}), app = await buildApp(config,appServices(config));
  try {
    assert.equal((await app.inject('/api/health/live')).statusCode,200);
    const limited = await app.inject('/api/health/live');
    assert.equal(limited.statusCode,429); assert.equal(limited.json().error.code,'RATE_LIMIT');
    assert.equal(limited.json().error.retryable,true); assert.ok(limited.headers['retry-after']);
  } finally { await app.close(); }
});
test('request deadline releases a stuck manual adapter and aborts its signal', {timeout:2000},async () => {
  const config = readConfig({NODE_ENV:'test',REQUEST_TIMEOUT_MS:'100'}), services = appServices(config);
  let signal: AbortSignal | undefined;
  services.repository.read = async (_name,_input,requestSignal?: AbortSignal) => { signal = requestSignal; return new Promise(() => {}); };
  const app = await buildApp(config,services);
  try {
    const response = await app.inject('/api/news');
    assert.equal(response.statusCode,503); assert.equal(response.json().error.code,'REQUEST_TIMEOUT');
    assert.equal(signal?.aborted,true);
  } finally { await app.close(); }
});
test('closing the app cancels in-flight work before releasing the repository', {timeout:2000},async () => {
  const config = readConfig({NODE_ENV:'test'}), services = appServices(config);
  const entered = deferred<void>(); let signal: AbortSignal | undefined;
  services.repository.read = async (_name,_input,requestSignal?: AbortSignal) => { signal = requestSignal; entered.resolve(); return new Promise(() => {}); };
  const app = await buildApp(config,services);
  const response = app.inject('/api/news');
  await entered.promise;
  await app.close();
  assert.equal(signal?.aborted,true); assert.equal(services.repository.closed,true);
  assert.equal((await response).statusCode,408);
});
test('invalid configuration combinations fail using variable names, never secret values',() => {
  for (const env of [{GEMINI_API_KEY:' secret ',GEMINI_MODEL:'test-model'},{EMBEDDING_MODEL:'test-embedding',EMBEDDING_DIMENSIONS:'3'},
    {EMBEDDING_VERSION:'orphan'},{FLIGHTS_ENABLED:''},{PORT:'3e3'},{REQUEST_TIMEOUT_MS:''},
    {FLIGHTS_STALE_AFTER_MS:'300000',FLIGHTS_CACHE_TTL_MS:'10000'},{DATABASE_URL:'postgresql://host/'}]) {
    assert.throws(() => readConfig(env),error => error instanceof Error && !error.message.includes('secret'));
  }
});
test('incomplete query plans cannot report ready even with a working database connection',async () => {
  const config = readConfig({NODE_ENV:'test'}), services = appServices(config);
  const repository = {mode:'stored' as const,missingPlans:['news'],read:services.repository.read.bind(services.repository),
    health:async () => true,close:async () => {}};
  const app = await buildApp(config,{...services,repository});
  try {
    const response = await app.inject('/api/health');
    assert.equal(response.statusCode,503); assert.equal(response.json().database,true); assert.equal(response.json().query_plans,false);
  } finally { await app.close(); }
});
test('rollback failure discards the broken client and preserves the original write error',async () => {
  const original = new Error('original write failed'); let discarded: boolean | undefined;
  const client = {query:async (input: unknown) => {
    if (input === 'BEGIN') return;
    if (input === 'ROLLBACK') throw new Error('rollback failed');
    throw original;
  },release:(discard: boolean) => {discarded = discard;}};
  const repo = new PgRepository({connect:async () => client} as unknown as pg.Pool,
    {version:'atlas-p3-v1',plans:{upsert_articles:{text:'SELECT approved_import($1)',parameters:['id']}}});
  await assert.rejects(repo.writeBatch('upsert_articles',[{id:'test-record'}]),error => error === original);
  assert.equal(discarded,true);
});
test('already-cancelled writes do not acquire a connection',async () => {
  let acquired = false;
  const repo = new PgRepository({connect:async () => {acquired = true; throw new Error('unexpected connect');}} as unknown as pg.Pool,
    {version:'atlas-p3-v1',plans:{}});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repo.writeBatch('upsert_articles',[],controller.signal),/cancelled/); assert.equal(acquired,false);
});
