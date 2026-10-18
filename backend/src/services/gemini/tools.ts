import { AppError, checkAbort } from '../../runtime/errors.js';
import { Contracts, type Data, string } from '../validation.js';
import { Retrieval } from '../retrieval.js';
import type { Flights } from '../flights.js';
export const toolSchemas = {
  search_news: 'NewsQuery', search_locations: 'LocationsQuery', set_filters: 'NewsQuery', focus_location: 'FocusLocationArgs',
  get_investigation: 'InvestigationQuery', compare_observations: 'CompareObservationsArgs',
  get_aircraft_in_region: 'FlightsQuery', find_aircraft: 'FindAircraftArgs'
} as const;
export type ToolName = keyof typeof toolSchemas;
export function isTool(name: string): name is ToolName { return Object.hasOwn(toolSchemas,name); }
function hasConstraint(key: string,value: unknown): boolean {
  if (['location_ids','themes','entity_ids','event_types','topics'].includes(key)) return Array.isArray(value) && value.length>0;
  if (['keyword','semantic_query'].includes(key)) return typeof value==='string' && value.trim().length>0;
  return value!==undefined;
}
function equivalentConstraint(key: string,left: unknown,right: unknown): boolean {
  if (['location_ids','themes','entity_ids','event_types','topics'].includes(key) && Array.isArray(left) && Array.isArray(right))
    return JSON.stringify([...new Set(left)].sort())===JSON.stringify([...new Set(right)].sort());
  if (['published_from','published_to'].includes(key) && typeof left==='string' && typeof right==='string') return Date.parse(left)===Date.parse(right);
  if (key==='keyword' && typeof left==='string' && typeof right==='string') return left.trim().toLocaleLowerCase('en')===right.trim().toLocaleLowerCase('en');
  return JSON.stringify(left)===JSON.stringify(right);
}
export class Tools {
  readonly actions: Data[] = [];
  latestNews?: Data;
  constructor(private contracts: Contracts, private retrieval: Retrieval, private flights?: Flights, private activeFilters: Data = {}, private allowActions = true) {}
  async action(raw: unknown, signal?: AbortSignal): Promise<Data> {
    checkAbort(signal);
    if (!this.allowActions) throw new AppError('ACTION_NOT_AUTHORIZED','Workspace changes require allow_ui_actions for this request',502);
    const action = this.contracts.parse('UIAction', raw);
    if (action.type === 'set_filters') {
      const filters = this.retrieval.newsInput(action.filters);
      // Do not navigate to invented IDs even when the schema accepts a string.
      for (const id of Array.isArray(filters.location_ids) ? filters.location_ids : []) await this.retrieval.location(string(id),signal);
    } else if (action.type === 'focus_location') {
      await this.retrieval.location(string(action.location_id), signal);
    } else throw new AppError('INVALID_ACTION', 'Unsupported UI action', 502);
    checkAbort(signal);
    return action;
  }
  async dispatch(name: string, raw: unknown, signal?: AbortSignal): Promise<Data> {
    checkAbort(signal);
    if (!isTool(name)) throw new AppError('INVALID_TOOL', 'Tool is not allowlisted');
    const args = this.contracts.parse(toolSchemas[name],raw);
    switch (name) {
      case 'search_news': {
        for (const key of ['location_ids','themes','entity_ids','event_types','topics','verification_status','has_location','bounds','published_from','published_to','keyword','semantic_query']) {
          if (hasConstraint(key,this.activeFilters[key]) && args[key] !== undefined && !equivalentConstraint(key,this.activeFilters[key],args[key]))
            throw new AppError('FILTER_CONFLICT','Use set_filters to change active workspace constraints');
        }
        return this.retrieval.news({...this.activeFilters,...args},signal);
      }
      case 'search_locations': return this.retrieval.locations(args, signal);
      case 'set_filters': {
        const action = await this.action({ type:'set_filters', filters: args },signal);
        const result = await this.retrieval.news(args,signal);
        this.activeFilters = args; this.latestNews = result; this.actions.push(action); return { action, ...result };
      }
      case 'focus_location': {
        const location = await this.retrieval.location(string(args.location_id),signal);
        const action = await this.action({type:'focus_location',location_id:location.id},signal);
        this.actions.push(action); return {action,location};
      }
      case 'get_investigation': return this.retrieval.investigation(args,signal);
      case 'compare_observations': return this.retrieval.compare(args,signal);
      case 'get_aircraft_in_region': if (this.flights) return this.flights.get(args,signal); break;
      case 'find_aircraft': if (this.flights) return this.flights.find(args,signal); break;
    }
    throw new AppError('FLIGHTS_DISABLED','Flights are unavailable',503,true);
  }
}
