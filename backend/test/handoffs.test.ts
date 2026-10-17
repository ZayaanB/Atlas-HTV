import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readConfig} from '../src/config.js';
import {loadLocalModule} from '../src/runtime/load.js';
import {loadHandoffs} from '../src/runtime/handoffs.js';
import {validateDatabaseHandoff} from '../src/data/queries.js';
import {Contracts} from '../src/services/validation.js';
test('local handoffs reject missing modules, traversal, symlink escape and unsupported file types',async t => {
  const root = await mkdtemp(join(tmpdir(),'atlas-handoff-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'contracts')); await mkdir(join(root,'outside'));
  await writeFile(join(root,'contracts','valid.mjs'),'export const schemas = {};');
  await writeFile(join(root,'outside','secret.mjs'),'export const secret = "must not import";');
  await symlink(join(root,'outside','secret.mjs'),join(root,'contracts','escape.mjs'));
  await writeFile(join(root,'contracts','unsupported.ts'),'export const schemas = {};');
  assert.deepEqual((await loadLocalModule('contracts/valid.mjs',['contracts'],root))!.schemas,{});
  await assert.rejects(loadLocalModule('contracts/missing.mjs',['contracts'],root),/could not be found/);
  await assert.rejects(loadLocalModule('outside/secret.mjs',['contracts'],root),/owned repository paths/);
  await assert.rejects(loadLocalModule('contracts/escape.mjs',['contracts'],root),/owned repository paths/);
  await assert.rejects(loadLocalModule('contracts/unsupported.ts',['contracts'],root),/portable/);
});
test('handoff diagnostics validate exports and preserve absence as an explicit incomplete setup',async t => {
  const root = await mkdtemp(join(tmpdir(),'atlas-check-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const absent = await loadHandoffs(readConfig({NODE_ENV:'test'}),root);
  assert.equal(absent.contracts.ready,false); assert.equal(absent.databaseHandoff,undefined);
  await mkdir(join(root,'contracts'));
  await writeFile(join(root,'contracts','invalid.mjs'),'export const schemas = { Invalid: { type: "not-a-type" } };');
  await assert.rejects(loadHandoffs(readConfig({ATLAS_CONTRACTS_MODULE:'contracts/invalid.mjs'}),root),/could not be compiled/);
  await mkdir(join(root,'scripts','source-definitions'),{recursive:true});
  await writeFile(join(root,'scripts','source-definitions','invalid.mjs'),'export const sources = [{id:"duplicate"},{id:"duplicate"}];');
  await assert.rejects(loadHandoffs(readConfig({ATLAS_SOURCES_MODULE:'scripts/source-definitions/invalid.mjs'}),root),/unique/);
});
test('database plan validation rejects malformed or unrecognized exports before connecting',() => {
  for (const value of [null,[],{}, {version:'wrong',plans:{}},{version:'atlas-p3-v1',plans:[]},
    {version:'atlas-p3-v1',plans:{arbitrary_sql:{text:'select 1',parameters:[]}}},
    {version:'atlas-p3-v1',plans:{news:{text:42,parameters:[]}}},
    {version:'atlas-p3-v1',plans:{news:{text:'select 1',parameters:['model.sql']}}}]) assert.throws(() => validateDatabaseHandoff(value),/versioned database handoff/);
});
test('shared schemas can reference one another without private copies and outputs fail closed',() => {
  const contracts = new Contracts({Shared:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
    Wrapper:{type:'object',properties:{record:{$ref:'Shared'}},required:['record'],additionalProperties:false}});
  assert.deepEqual(contracts.parse('Wrapper',{record:{id:'synthetic-id'}}),{record:{id:'synthetic-id'}});
  assert.throws(() => contracts.parse('Wrapper',{record:{id:42}},true),/Upstream data failed/);
});
