import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Contracts} from '../src/services/validation.js';
import {geminiJsonSchema,modelParameters} from '../src/services/gemini/schema.js';

test('model schema projection resolves only local refs and migrates tuples without altering shared validation',()=>{
  const schema={$schema:'http://json-schema.org/draft-07/schema#',$id:'https://example.invalid/NewsQuery',type:'object',properties:{
    id:{$ref:'SharedId'},bound:{type:'array',items:[{type:'number',minimum:-180,maximum:180},{type:'number',minimum:-90,maximum:90}],minItems:2,maxItems:2,additionalItems:false},
    mode:{const:'read'},time:{$ref:'#/definitions/time'}
  },definitions:{time:{type:'string',pattern:'Z$'}},additionalProperties:false};
  const original=structuredClone(schema);
  const contracts=new Contracts({NewsQuery:schema,SharedId:{$id:'https://example.invalid/SharedId',type:'string',minLength:1}});
  const projected=modelParameters(contracts,'NewsQuery');
  assert.equal(projected.$schema,undefined); assert.equal(projected.$id,undefined);
  const properties=projected.properties as Record<string,Record<string,unknown>>;
  assert.deepEqual(properties.id,{type:'string',minLength:1}); assert.deepEqual(properties.mode,{enum:['read']});
  assert.equal((properties.bound!.prefixItems as unknown[]).length,2); assert.equal(properties.bound!.items,false);
  assert.deepEqual(properties.time,{type:'string',pattern:'Z$'}); assert.deepEqual(schema,original);
  assert.throws(()=>contracts.parse('NewsQuery',{bound:[0,91]}),/Invalid NewsQuery/);
  assert.throws(()=>contracts.parse('NewsQuery',{unknown:'still rejected'}),/Invalid NewsQuery/);
});
test('recursive and unknown references fail without network fetching',()=>{
  const recursive={type:'object',properties:{next:{$ref:'#'}}};
  assert.throws(()=>modelParameters(new Contracts({Recursive:recursive}),'Recursive'),/recursive/);
  const contracts=new Contracts(); contracts.schemas.Missing={$ref:'https://untrusted.invalid/schema'};
  assert.throws(()=>modelParameters(contracts,'Missing'),/unresolved/);
  assert.throws(()=>modelParameters(contracts,'Absent'),/has not been supplied/);
});
test('model hints omit cumulative array maxima while shared runtime still rejects oversized lists',()=>{
  const schema={type:'object',properties:{ids:{type:'array',items:{type:'string'},maxItems:3}},required:['ids'],additionalProperties:false};
  const contracts=new Contracts({List:schema});
  const projected=modelParameters(contracts,'List');
  assert.equal((projected.properties as Record<string,Record<string,unknown>>).ids!.maxItems,undefined);
  assert.equal(schema.properties.ids.maxItems,3);
  assert.throws(()=>contracts.parse('List',{ids:['a','b','c','d']}),/Invalid List/);
  assert.deepEqual(contracts.parse('List',{ids:['a','b','c']}),{ids:['a','b','c']});
});
test('provider schema projection uses supported unions and typed enums without expanding forbidden elements',()=>{
  const schema={type:'object',properties:{
    choice:{oneOf:[{type:'object',properties:{type:{enum:['open']},id:{type:'string',minLength:1,pattern:'^a'}},required:['type','id'],additionalProperties:false}]},
    actions:{type:'array',items:{oneOf:[{type:'object',properties:{deep:{type:'string'}}}]},maxItems:0},
  },required:['choice','actions'],additionalProperties:false};
  const original=structuredClone(schema), projected=geminiJsonSchema(schema);
  const properties=projected.properties as Record<string,Record<string,unknown>>;
  assert.equal(properties.choice!.oneOf,undefined);
  assert.deepEqual(properties.choice!.anyOf,[{type:'object',properties:{type:{type:'string',enum:['open']},id:{type:'string'}},required:['type','id'],additionalProperties:false}]);
  assert.deepEqual(properties.actions,{type:'array',maxItems:0,items:{type:'null'}});
  assert.deepEqual(schema,original);
});
test('zero array bounds survive contract projection and keep invalid final actions rejected',()=>{
  const schema={type:'object',properties:{actions:{type:'array',maxItems:0,items:{type:'string'}}},required:['actions'],additionalProperties:false};
  const contracts=new Contracts({Draft:schema});
  assert.equal((modelParameters(contracts,'Draft').properties as Record<string,Record<string,unknown>>).actions!.maxItems,0);
  assert.throws(()=>contracts.parse('Draft',{actions:['forbidden']}),/Invalid Draft/);
});
