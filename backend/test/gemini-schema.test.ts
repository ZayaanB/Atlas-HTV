import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Contracts} from '../src/services/validation.js';
import {modelParameters} from '../src/services/gemini/schema.js';

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
