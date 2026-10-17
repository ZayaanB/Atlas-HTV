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
import { testContracts, TestRepository } from './support.js';
test('configuration fails closed without exposing credentials and accepts valid bounds',() => {
  for (const env of [{PORT:'x'},{DATABASE_URL:'postgres://secret@host/db?sslmode=no-verify'},{GEMINI_API_KEY:'secret'},{AI_MAX_TOOL_CALLS:'999'},{FLIGHTS_ENABLED:'yes'}]) assert.throws(() => readConfig(env));
  assert.equal(readConfig({PORT:'3100'}).port,3100);
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
