// Synthetic protocol doubles only. Not seed data, shared fixtures, or production schemas.
// The deliberately minimal schemas exercise backend behavior; contracts/ remains authoritative.
import type { AnySchema } from 'ajv';
import { Contracts, type Data } from '../src/services/validation.js';
import type { Read, Repository } from '../src/data/queries.js';
const text = {type:'string'}, array = {type:'array',items:text,maxItems:20};
const shape = (properties: Data, required: string[] = [], additionalProperties = false) => ({type:'object',properties,required,additionalProperties});
const filters = shape({location_ids:array,themes:array,entity_ids:array,keyword:text,semantic_query:text,published_from:text,published_to:text,
  bounds:{type:'array',items:{type:'number'},minItems:4,maxItems:4},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0,maximum:10000}});
export function testContracts() {
  const schemas: Record<string,AnySchema> = {
    NewsQuery:filters,
    LocationsQuery:shape({ids:array,query:text,limit:{type:'integer'},offset:{type:'integer'}}),
    InvestigationQuery:shape({id:text},['id']),
    ObservationsQuery:shape({location_id:text,metric:text,observed_from:text,observed_to:text,limit:{type:'integer'},offset:{type:'integer'}}),
    CompareObservationsArgs:shape({location_id:text,metric:text,observed_from:text,observed_to:text,limit:{type:'integer'}},['location_id','metric']),
    FocusLocationArgs:shape({location_id:text},['location_id']),
    FlightsQuery:shape({region_id:text},['region_id']),FindAircraftArgs:shape({region_id:text,identifier:text},['region_id','identifier']),
    FlightRegion:shape({id:text,latitude:{type:'number'},longitude:{type:'number'},radius_nm:{type:'integer'}},['id','latitude','longitude','radius_nm']),
    UIAction:{oneOf:[shape({type:{const:'set_filters'},filters},['type','filters']),shape({type:{const:'focus_location'},location_id:text},['type','location_id'])]},
    AssistantRequest:shape({message:{type:'string',minLength:1},filters,request_id:text,timezone:text,selected_investigation_id:text,allow_ui_actions:{type:'boolean'}},['message','request_id','timezone']),
    AssistantDraft:shape({answer:text,citations:{type:'array',items:{type:'object'},maxItems:30},result_ids:array,actions:{type:'array',items:{type:'object'},maxItems:8}},['answer','citations','result_ids','actions'])
  };
  for (const name of ['Article','Location','Observation','Source','AircraftState','Citation']) schemas[name] = {type:'object'};
  for (const name of ['NewsResponse','LocationsResponse','ObservationsResponse','InvestigationResponse','FlightsResponse','AssistantResponse']) schemas[name] = {type:'object'};
  return new Contracts(schemas);
}
export class TestRepository implements Repository {
  readonly mode = 'fixture' as const;
  calls: {name:string;input:Data}[] = [];
  writes: {name:string;rows:Data[]}[] = [];
  closed = false;
  constructor(public data: Partial<Record<Read,Data[]>> = {}) {}
  async read(name: Read,input:Data) { this.calls.push({name,input}); return this.data[name] ?? []; }
  async writeBatch(name:'upsert_articles'|'upsert_embeddings'|'mark_refresh',rows:Data[]) { this.writes.push({name,rows}); }
  async health() { return true; }
  async close() { this.closed = true; }
}
export function protocolArticle(id = 'test-record', changes: Data = {}): Data {
  return {id,title:'Synthetic test headline',excerpt:null,source_id:`source-${id}`,
    url:`https://example.invalid/${id}`,location_ids:['test-place'],themes:['test-theme'],entity_ids:[],
    published_at:'2026-01-01T00:00:00.000Z',event_at:null,fetched_at:'2026-01-02T00:00:00.000Z',...changes};
}
