import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeGeminiTools} from '../src/services/gemini/probe.js';
import {readConfig} from '../src/config.js';
import {Retrieval} from '../src/services/retrieval.js';
import {testContracts,TestRepository,protocolArticle} from './support.js';
import type {Model} from '../src/services/gemini/client.js';

function setup(model: Model,articles=[protocolArticle()]) {
  const repository=new TestRepository({news:articles,sources:[{id:'source-test-record',title:'Synthetic source',url:'https://example.invalid/test-record'}]});
  const retrieval=new Retrieval(testContracts(),repository);
  return {repository,run:(signal=new AbortController().signal)=>probeGeminiTools(readConfig({NODE_ENV:'test'}),retrieval,model,{keyword:'synthetic',limit:3},signal)};
}
test('tool diagnostic verifies canonical retrieval/citation with shared contracts and preserves model tool IDs/signatures',async()=>{
  let calls=0;
  const model: Model={generate:async(contents,_declarations,_signal,options)=>{
    calls++;
    if(calls===1) {
      assert.equal(options!.forceTool,'search_news');
      return {content:{role:'model',parts:[{functionCall:{name:'search_news',args:{},id:'id-1'},thoughtSignature:'synthetic'}]},text:'',calls:[{name:'search_news',args:{},id:'id-1'}]};
    }
    assert.equal(options!.forceTool,'cite_record');
    assert.equal(contents[1]!.parts![0]!.thoughtSignature,'synthetic');
    assert.equal(contents[2]!.parts![0]!.functionResponse!.id,'id-1');
    return {content:{role:'model',parts:[]},text:'',calls:[{name:'cite_record',args:{record_id:'test-record',source_id:'source-test-record'}}]};
  }};
  const result=await setup(model).run();
  assert.equal(result.status,'passed');assert.equal(result.assistant_api_verified,false);
  assert.equal(result.data_mode,'fixture');assert.equal(result.citation.url,'https://example.invalid/test-record');assert.equal(calls,2);
});
test('tool diagnostic refuses arbitrary tool names, filter replacement and invented citation records',async()=>{
  for (const bad of [{name:'fetch_url',args:{url:'https://untrusted.invalid'}},{name:'search_news',args:{keyword:'replace active constraint'}}]) {
    const {run,repository}=setup({generate:async()=>({content:{role:'model',parts:[]},text:'',calls:[bad]})});
    await assert.rejects(run(),/Expected exactly|set_filters/);
    assert.equal(repository.calls.filter(c=>c.name==='news').length,1);
  }
  let turn=0;
  await assert.rejects(setup({generate:async()=>({content:{role:'model',parts:[]},text:'',calls:++turn===1?[{name:'search_news',args:{}}]:[{name:'cite_record',args:{record_id:'invented',source_id:'source-test-record'}}]})}).run(),/returned article/);
});
test('tool diagnostic skips generation for empty evidence and stops before a large second turn',async()=>{
  let calls=0;
  const model: Model={generate:async()=>{calls++;return {content:{role:'model',parts:[]},text:'',calls:[{name:'search_news',args:{}}]};}};
  await assert.rejects(setup(model,[]).run(),/No stored articles/);assert.equal(calls,0);
  const repository=new TestRepository({news:[protocolArticle('test-record',{excerpt:'x'.repeat(5000)})]});
  await assert.rejects(probeGeminiTools(readConfig({NODE_ENV:'test',AI_MAX_CONTEXT_BYTES:'4000'}),new Retrieval(testContracts(),repository),model,{},new AbortController().signal),/context bound/);
  assert.equal(calls,1);
});
