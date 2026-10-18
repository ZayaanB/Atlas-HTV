import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Contracts, normalizeQuery} from '../src/services/validation.js';
import {Retrieval} from '../src/services/retrieval.js';
import {Tools} from '../src/services/gemini/tools.js';
import {filterNewsPlan} from '../src/data/news-filters.js';
import {TestRepository} from './support.js';

// Actual shared contracts and shared historical examples; no provider/database calls.
const shared = await import(new URL('../../contracts/dist/index.js',import.meta.url).href);
const contracts = new Contracts(shared.schemas,shared.newsFiltering);
const {news} = JSON.parse(await readFile(new URL('../../contracts/examples/helene-api.json',import.meta.url),'utf8'));

test('event/topic OR within groups, AND across groups, review and location filters share manual/tool semantics',async()=>{
  const repository = new TestRepository({news:news.items});
  const retrieval = new Retrieval(contracts,repository);
  const query = {event_types:['flood','cyclone'],topics:['health'],verification_status:'reviewed',has_location:true};
  const manual = await retrieval.news(query);
  assert.ok((manual.items as unknown[]).length > 0);
  assert.deepEqual(manual,await new Tools(contracts,retrieval).dispatch('search_news',query));
  assert.deepEqual((await retrieval.news({...query,topics:['technology']})).items,[]);
  assert.deepEqual((await retrieval.news({...query,has_location:false})).items,[]);
  const tools = new Tools(contracts,retrieval,undefined,query);
  assert.deepEqual(await tools.dispatch('search_news',{}),manual);
  for (const changed of [{event_types:['earthquake']},{topics:['politics']},{verification_status:'unreviewed'},{has_location:false}])
    await assert.rejects(tools.dispatch('search_news',changed),/set_filters/);
  await assert.rejects(new Tools(contracts,retrieval,undefined,{has_location:false}).dispatch('search_news',{has_location:true}),/set_filters/);
  await assert.rejects(new Retrieval(new Contracts(shared.schemas),repository).news(query),/Rebuild shared contracts/);
  const fallback = await retrieval.news({...query,semantic_query:'flood'});
  assert.equal(fallback.search_mode,'keyword_fallback');
  assert.deepEqual(repository.calls.findLast(call => call.name === 'news')!.input,{...query,semantic_query:'flood',keyword:'flood',limit:50,offset:0});
  await assert.rejects(tools.action({type:'set_filters',filters:{event_types:['invented']}}),/Invalid UIAction/);
});

test('GET parsing preserves false and rejects unknown categories and loose boolean coercion',()=>{
  assert.deepEqual(contracts.parse('NewsQuery',normalizeQuery({event_types:'flood,earthquake',topics:'environment',has_location:'false'})),
    {event_types:['flood','earthquake'],topics:['environment'],has_location:false});
  for (const query of [{event_types:['floods']},{topics:['anything']},{has_location:'yes'},{verification_status:'verified'}, {event_types:['flood','flood']}])
    assert.throws(()=>contracts.parse('NewsQuery',normalizeQuery(query)),/Invalid NewsQuery/);
});

test('category matching uses whole English terms, existing tags, and never fills null publication or location values',()=>{
  const matches = shared.newsFiltering.matches;
  const row = {title:'Synthetic market research about broad roads',excerpt:null,themes:[],location_ids:[],verification_status:'unreviewed',published_at:null};
  assert.equal(matches(row,{topics:['infrastructure']}),true);
  assert.equal(matches({...row,title:'Synthetic broad statement'},{topics:['infrastructure']}),false);
  assert.equal(matches({...row,title:'Synthetic rainfall'},{event_types:['flood']}),false);
  assert.equal(matches({...row,themes:['hurricanes']},{event_types:['cyclone']}),true);
  assert.equal(matches(row,{has_location:false,verification_status:'unreviewed'}),true);
  assert.equal(row.published_at,null);
});

test('repository adapter binds categories and provenance before keyword/semantic ranking and pagination',()=>{
  const query = {event_types:['flood'],topics:['environment'],has_location:false,verification_status:'unreviewed'};
  const base = {text:'SELECT a.id FROM atlas.article_records a WHERE a.title = $1 LIMIT $2 OFFSET $3',values:["x'); DROP TABLE articles; --",2,4]};
  const adapted = filterNewsPlan(base,query,shared.newsFiltering);
  assert.match(adapted.text,/^WITH atlas_filtered_articles AS/);
  assert.match(adapted.text,/FROM atlas_filtered_articles a/);
  assert.ok(adapted.text.indexOf('cardinality') < adapted.text.indexOf('LIMIT'));
  assert.equal(adapted.text.includes('DROP TABLE'),false);
  assert.deepEqual(adapted.values.slice(0,3),base.values);
  assert.equal(adapted.values.at(-1),false);
  assert.equal(adapted.values.at(-2),'unreviewed');
  assert.equal(JSON.parse(String(adapted.values[3]))[0].id,'flood');
  const semantic = filterNewsPlan({text:'WITH ranked AS (SELECT a.id FROM atlas.article_records a) SELECT a.id FROM ranked r JOIN atlas.article_records a ON a.id=r.id LIMIT $1',values:[2]},query,shared.newsFiltering);
  assert.match(semantic.text,/, ranked AS/);
  assert.equal((semantic.text.match(/atlas\.article_records/g) ?? []).length,1);
  assert.equal((semantic.text.match(/FROM atlas_filtered_articles|JOIN atlas_filtered_articles/g) ?? []).length,2);
  assert.equal(filterNewsPlan(base,{},shared.newsFiltering),base);
  assert.throws(()=>filterNewsPlan(base,query),/agreed article view/);
  assert.throws(()=>filterNewsPlan({...base,text:'SELECT * FROM other_view'},query,shared.newsFiltering),/agreed article view/);
});
