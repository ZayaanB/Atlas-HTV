import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Retrieval, matchesNews } from '../src/services/retrieval.js';
import { Tools } from '../src/services/gemini/tools.js';
import { timelineTarget } from '../src/services/gemini/context.js';
import { bounds, range, normalizeQuery } from '../src/services/validation.js';
import { protocolArticle, testContracts, TestRepository } from './support.js';
import type { Read } from '../src/data/queries.js';
import type { Data } from '../src/services/validation.js';
test('manual/tool news share exact filtering including fractional UTC timestamps, null publication and keyword',async () => {
  const contracts = testContracts(), repository = new TestRepository({news:[protocolArticle('test-a'),protocolArticle('test-b',{location_ids:['elsewhere']}),protocolArticle('test-c',{published_at:null})]});
  const retrieval = new Retrieval(contracts,repository), tools = new Tools(contracts,retrieval);
  const query = {location_ids:['test-place'],keyword:'SYNTHETIC',published_from:'2026-01-01T00:00:00Z',published_to:'2026-01-01T00:00:00Z'};
  assert.deepEqual(await retrieval.news(query),await tools.dispatch('search_news',query));
  assert.deepEqual((await retrieval.news(query)).items,[protocolArticle('test-a')]);
  assert.equal(matchesNews(protocolArticle(),{themes:['other']}),false);
  assert.equal(matchesNews(protocolArticle(),{entity_ids:['absent']}),false);
  await assert.rejects(tools.dispatch('search_news',{sql:'DROP TABLE articles'}),/Invalid NewsQuery/);
  await assert.rejects(tools.dispatch('fetch_url',{url:'https://example.invalid'}),/allowlisted/);
});
test('UTC range, bounds and strict query schemas reject ambiguous/oversized input',async () => {
  const retrieval = new Retrieval(testContracts(),new TestRepository());
  for (const [from,to] of [['2026-01-01','2026-01-02'],['2026-02-30T00:00:00Z','2026-03-01T00:00:00Z'],['2026-03-01T00:00:00Z','2026-01-01T00:00:00Z'],['2020-01-01T00:00:00Z','2026-01-01T00:00:00Z']]) {
    assert.throws(() => range({from,to},'from','to'));
  }
  assert.throws(() => bounds([180,-90,-180,90]));
  await assert.rejects(retrieval.news({limit:101}));
  assert.deepEqual(normalizeQuery({location_ids:'a,b',limit:'2',bounds:'-80,40,-70,50'}),{location_ids:['a','b'],limit:2,bounds:[-80,40,-70,50]});
});
test('bounds preserve broad precision rather than matching an invented local pin',async () => {
  const repository = new TestRepository({news:[protocolArticle()],locations:[{id:'test-place',name:'Synthetic region',precision:'region',coordinates:[0,0],bounds:[-10,-10,10,10]}]});
  const retrieval = new Retrieval(testContracts(),repository);
  assert.deepEqual((await retrieval.news({bounds:[-1,-1,1,1]})).items,[]);
});
test('area search retains matching articles beyond the default location page and across ID batches',async () => {
  class PagedLocations extends TestRepository {
    override async read(name: Read,input: Data) {
      const rows=await super.read(name,input);
      if (name!=='locations') return rows;
      const requested=new Set(input.ids as string[]);
      return rows.filter(row => requested.has(String(row.id))).slice(Number(input.offset),Number(input.offset)+Number(input.limit));
    }
  }
  for (const [articleCount,placesPerArticle] of [[75,1],[51,3]] as const) {
    const articles=Array.from({length:articleCount},(_,index) => protocolArticle(`test-article-${index}`,{
      location_ids:Array.from({length:placesPerArticle},(_,place) => `test-place-${index}-${place}`)
    }));
    const places=articles.flatMap(article => (article.location_ids as string[]).map(id => ({id,name:'Synthetic point',precision:'facility',coordinates:[0,0]})));
    const repository=new PagedLocations({news:articles,locations:places});
    const retrieval=new Retrieval(testContracts(),repository),tools=new Tools(retrieval.contracts,retrieval);
    const query={bounds:[-1,-1,1,1],limit:100};
    const manual=await retrieval.news(query);
    assert.deepEqual(manual.items,articles);
    assert.deepEqual(await tools.dispatch('search_news',query),manual);
    assert.ok(repository.calls.filter(call => call.name==='locations').every(call => (call.input.ids as string[]).length>0 && (call.input.ids as string[]).length<=100));
  }
});
test('an empty area result never triggers an unrestricted location query',async () => {
  const repository=new TestRepository({news:[]});
  const result=await new Retrieval(testContracts(),repository).news({bounds:[-1,-1,1,1]});
  assert.deepEqual(result.items,[]);
  assert.equal(repository.calls.some(call => call.name==='locations'),false);
});
test('semantic fallback is disclosed and preserves strict filters',async () => {
  const retrieval = new Retrieval(testContracts(),new TestRepository({news:[protocolArticle('test-a'),protocolArticle('test-b',{location_ids:['elsewhere']})]}));
  const result = await retrieval.news({semantic_query:'synthetic',location_ids:['test-place']});
  assert.equal(result.search_mode,'keyword_fallback');
  assert.equal((result.items as unknown[]).length,1);
});
test('comparison computes from one compatible series and rejects mixed units/sources',async () => {
  const repository = new TestRepository({observations:[{id:'test-o1',location_id:'test-place',metric:'test-metric',unit:'test-unit',source_id:'test-source',value:2,observed_at:'2026-01-01T00:00:00Z'},
    {id:'test-o2',location_id:'test-place',metric:'test-metric',unit:'test-unit',source_id:'test-source',value:5,observed_at:'2026-01-02T00:00:00Z'}]});
  const retrieval = new Retrieval(testContracts(),repository);
  const result = await retrieval.compare({location_id:'test-place',metric:'test-metric'});
  assert.deepEqual(result.comparison,{first_id:'test-o1',last_id:'test-o2',difference:3,unit:'test-unit'});
  repository.data.observations![1]!.unit = 'different';
  await assert.rejects(retrieval.compare({location_id:'test-place',metric:'test-metric'}),/one location/);
});
test('series_id selects one of two series sharing a location and metric, in the query and the post-filter',async () => {
  const row = (id: string, series_id: string, source_id: string, value: number, observed_at: string) =>
    ({id,series_id,location_id:'test-place',metric:'test-metric',unit:'test-unit',source_id,value,observed_at});
  const repository = new TestRepository({observations:[row('a1','test-archive','test-archive-source',2,'2024-01-01T00:00:00Z'),
    row('l1','test-live','test-live-source',5,'2026-01-01T00:00:00Z'),row('l2','test-live','test-live-source',7,'2026-01-02T00:00:00Z')]});
  const retrieval = new Retrieval(testContracts(),repository);
  const result = await retrieval.compare({location_id:'test-place',metric:'test-metric',series_id:'test-live'});
  assert.equal(repository.calls.at(-2)!.input.series_id,'test-live');
  assert.deepEqual(result.comparison,{first_id:'l1',last_id:'l2',difference:2,unit:'test-unit'});
  // Without series_id the two sources mix, and comparison refuses rather than diffing across them.
  await assert.rejects(retrieval.compare({location_id:'test-place',metric:'test-metric'}),/one location/);
});

test('missing observation values retain rows and provide a comparison limitation', async () => {
  const rows = [1, 2].map(n => ({ id: `test-${n}`, location_id: 'test-place', metric: 'test-metric', unit: 'test-unit',
    source_id: 'test-source', value: n === 1 ? null : 5, observed_at: `2026-01-0${n}T00:00:00Z` }));
  const retrieval = new Retrieval(testContracts(), new TestRepository({ observations: rows }));
  const result = await retrieval.compare({ location_id: 'test-place', metric: 'test-metric' });
  assert.equal(result.comparison, null);
  assert.deepEqual(result.items, rows);
  assert.match(String(result.limitation), /missing values/);
});

test('assistant timeline targets isolate archives and live series sharing a location and metric', async () => {
  const series = (id: string) => ({ id, location_id: 'test-place', metric: 'test-metric', source_id: 'test-source', unit: 'test-unit' });
  const repository = new TestRepository({
    investigation: [{ investigation: { id: 'test-investigation' }, observation_series: [series('test-archive'), series('test-live')] }],
    observations: ['test-archive', 'test-live'].flatMap(series_id => [1, 2].map(n => ({
      ...series(series_id), id: `${series_id}-${n}`, series_id, value: n, observed_at: `2026-01-0${n}T00:00:00Z`,
    }))),
  });
  const target = { investigation_id: 'test-investigation', series_id: 'test-live' };
  assert.deepEqual(await timelineTarget(target, new Retrieval(testContracts(), repository)), target);
  assert.equal(repository.calls.find(call => call.name === 'observations')!.input.series_id, 'test-live');
});
