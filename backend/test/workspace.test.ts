import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../src/config.js';
import {loadHandoffs} from '../src/runtime/handoffs.js';
import {buildApp} from '../src/app.js';
import {Retrieval} from '../src/services/retrieval.js';
import {Flights} from '../src/services/flights.js';
import {Assistant} from '../src/services/gemini/orchestrator.js';
import {PgRepository} from '../src/data/queries.js';
import {TestRepository} from './support.js';
import type pg from 'pg';

test('workspace discovery uses authoritative schemas and preserves explicit stored associations',async()=>{
  const config=readConfig({NODE_ENV:'test',ATLAS_CONTRACTS_MODULE:'contracts/dist/index.js'});
  const {contracts}=await loadHandoffs(config);
  const catalog={themes:[{id:'theme-flood',label:'Flooding'}],entities:[{id:'entity-usgs',label:'USGS'}],
    investigations:[{id:'inv-test',title:'Synthetic discovery test',article_ids:['art-related']}]};
  const repository=new TestRepository({workspace:[catalog]});
  const retrieval=new Retrieval(contracts,repository),flights=new Flights(contracts,config,[]);
  const app=await buildApp(config,{contracts,repository,retrieval,flights,assistant:new Assistant(config,contracts,retrieval,flights)});
  try {
    const response=await app.inject({url:'/api/workspace'});
    assert.equal(response.statusCode,200);const body=response.json();
    assert.deepEqual(body.investigations,catalog.investigations);
    assert.deepEqual(body.themes,catalog.themes);
    assert.equal(body.capabilities.assistant,false);assert.equal(body.capabilities.flights,false);
    assert.equal(body.capabilities.observations,true);assert.equal(body.capabilities.series_filter,false);
    assert.deepEqual(repository.calls,[{name:'workspace',input:{}}]);
    repository.data.workspace=[{...catalog,investigations:[{id:'inv-test',title:'Bad',article_ids:['invented ID with spaces']}]}];
    const invalid=await app.inject({url:'/api/workspace'});
    assert.equal(invalid.statusCode,502);assert.equal(invalid.json().error.code,'INVALID_UPSTREAM_DATA');
  } finally {await app.close();}
});

test('optional catalog SQL uses only frozen tables with bounded lists and never interpolates request input',async()=>{
  let submitted: {text:string;values:unknown[]}|undefined;
  const pool={query:async(plan:typeof submitted)=>{submitted=plan;return {rows:[]};}} as unknown as pg.Pool;
  const repo=new PgRepository(pool,{version:'atlas-p3-v1',plans:{}});
  await repo.read('workspace',{sql:'DROP TABLE atlas.articles',id:'invented'});
  assert.deepEqual(submitted!.values,[]);
  assert.ok(!submitted!.text.includes('DROP'));
  for (const table of ['atlas.themes','atlas.entities','atlas.investigations','atlas.investigation_articles']) assert.ok(submitted!.text.includes(table));
  assert.equal(submitted!.text.match(/LIMIT 100/g)!.length,4);
  assert.ok(!repo.missingPlans.includes('workspace')); // Optional discovery never hides missing core plans.
});
