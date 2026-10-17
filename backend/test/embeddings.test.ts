import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readConfig} from '../src/config.js';
import {Embeddings} from '../src/services/embeddings.js';
import {Retrieval} from '../src/services/retrieval.js';
import {TestRepository,protocolArticle,testContracts} from './support.js';
const config = readConfig({NODE_ENV:'test',GEMINI_API_KEY:'synthetic-test-key',GEMINI_MODEL:'test-generation',EMBEDDING_MODEL:'test-embedding',EMBEDDING_VERSION:'test-v1',EMBEDDING_DIMENSIONS:'3'});
test('embedding task, model identity, dimensions and hash accompany source/chunk storage',async () => {
  let calls = 0;
  const embeddings = new Embeddings(config,{models:{embedContent:async params => {
    calls++; assert.equal(params.model,'test-embedding'); assert.equal(params.config!.outputDimensionality,3);
    assert.equal(params.config!.taskType,'RETRIEVAL_DOCUMENT');
    return {embeddings:[{values:[0.1,0.2,0.3]}]};
  }}});
  const repository = new TestRepository();
  assert.deepEqual(await embeddings.index(repository,'test-source','test-chunk','Synthetic permitted excerpt'),{skipped:false});
  const stored = repository.writes[0]!.rows[0]!;
  assert.equal(stored.source_id,'test-source'); assert.equal(stored.chunk_id,'test-chunk');
  assert.equal(stored.model_version,'test-v1'); assert.equal(stored.dimensions,3);
  repository.data.embedding_chunks = [stored];
  assert.deepEqual(await embeddings.index(repository,'test-source','test-chunk','Synthetic permitted excerpt'),{skipped:true}); assert.equal(calls,1);
  assert.equal(stored.content_hash,createHash('sha256').update('Synthetic permitted excerpt').digest('hex'));
});
test('invalid vectors trigger explicit keyword fallback and never relax filters',async () => {
  const embeddings = new Embeddings(config,{models:{embedContent:async () => ({embeddings:[{values:[1,2]}]})}});
  await assert.rejects(embeddings.embed('synthetic','RETRIEVAL_QUERY'),/invalid embedding/);
  const retrieval = new Retrieval(testContracts(),new TestRepository({news:[protocolArticle(),protocolArticle('test-outside',{location_ids:['outside']})]}),embeddings);
  const result = await retrieval.news({semantic_query:'synthetic',location_ids:['test-place']});
  assert.equal(result.search_mode,'keyword_fallback'); assert.equal((result.items as unknown[]).length,1);
});
test('successful semantic retrieval passes strict constraints and matching embedding metadata to repository',async () => {
  const embeddings = new Embeddings(config,{models:{embedContent:async params => {
    assert.equal(params.config!.taskType,'RETRIEVAL_QUERY'); return {embeddings:[{values:[1,2,3]}]};
  }}});
  const repository = new TestRepository({semantic_news:[protocolArticle(),protocolArticle('test-outside',{location_ids:['outside']})]});
  const result = await new Retrieval(testContracts(),repository,embeddings).news({semantic_query:'test',location_ids:['test-place']});
  assert.equal(result.search_mode,'semantic'); assert.equal((result.items as unknown[]).length,1);
  const query = repository.calls.find(call => call.name === 'semantic_news')!.input;
  assert.deepEqual(query.location_ids,['test-place']); assert.equal(query.model_version,'test-v1'); assert.equal(query.vector,'[1,2,3]');
});
