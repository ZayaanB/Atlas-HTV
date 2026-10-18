import { Ajv, type AnySchema, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { AppError, unavailable } from '../runtime/errors.js';
// Backend integration ports only. Domain schemas/types remain owned by contracts/.
export type Data = Record<string, unknown>;
// Optional executable handoff from the authoritative contracts module. No private
// classification dictionary: fixtures, HTTP retrieval and Gemini use this export.
export interface NewsFiltering {
  categories: readonly Data[];
  matches(article: Data, query: Data): boolean;
}
export function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', 'Expected an object');
  return value as Data;
}
export const string = (value: unknown): string => typeof value === 'string' ? value : '';
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
export const records = (value: unknown): Data[] => Array.isArray(value) ? value.map(object) : [];
export const requiredSchemas = ['NewsQuery','NewsResponse','LocationsQuery','LocationsResponse','InvestigationQuery','InvestigationResponse',
  'ObservationsQuery','ObservationsResponse','CompareObservationsArgs','FlightsQuery','FlightsResponse','FindAircraftArgs','FlightRegion',
  'FocusLocationArgs','UIAction','AssistantRequest','AssistantDraft','AssistantResponse','Article','Location','Observation','Source','AircraftState','Citation'];
export class Contracts {
  private validators = new Map<string, ValidateFunction>();
  constructor(readonly schemas: Record<string, AnySchema> = {}, readonly newsFiltering?: NewsFiltering) {
    const ajv = new Ajv({ allErrors: false, strict: true, coerceTypes: false, removeAdditional: false });
    addFormats.default(ajv);
    for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema,name);
    for (const name of Object.keys(schemas)) this.validators.set(name, ajv.getSchema(name)!);
  }
  get ready() { return requiredSchemas.every(name => this.validators.has(name)); }
  has(name: string) { return this.validators.has(name); }
  parse(name: string, value: unknown, output = false): Data {
    const validator = this.validators.get(name);
    if (!validator) throw unavailable('CONTRACTS_UNAVAILABLE', `Shared schema ${name} has not been supplied`);
    if (!validator(value)) throw new AppError(output ? 'INVALID_UPSTREAM_DATA' : 'INVALID_INPUT', output ? 'Upstream data failed shared validation' : `Invalid ${name}`, output ? 502 : 400);
    return object(value);
  }
}
export function normalizeQuery(raw: unknown): Data {
  const query = { ...object(raw) };
  for (const key of ['location_ids', 'themes', 'entity_ids', 'ids', 'event_types', 'topics']) {
    if (typeof query[key] === 'string') query[key] = query[key].split(',');
  }
  for (const key of ['limit', 'offset', 'radius_nm']) if (typeof query[key] === 'string' && /^\d+$/.test(query[key])) query[key] = Number(query[key]);
  for (const key of ['latitude', 'longitude']) if (typeof query[key] === 'string' && /^-?\d+(?:\.\d+)?$/.test(query[key])) query[key] = Number(query[key]);
  if (typeof query.bounds === 'string') query.bounds = query.bounds.split(',').map(Number);
  if (query.has_location === 'true') query.has_location = true;
  else if (query.has_location === 'false') query.has_location = false;
  return query;
}
export function range(query: Data, start: string, end: string): void {
  const times = [query[start], query[end]].map(value => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))
      throw new AppError('INVALID_TIME', 'Use valid UTC timestamps with explicit Z');
    return Date.parse(value);
  });
  if (times[0] !== undefined && times[1] !== undefined && (times[1] < times[0] || times[1] - times[0] > 366 * 86400000))
    throw new AppError('INVALID_RANGE', 'Time range must be ordered and no longer than 366 days');
}
export function bounds(value: unknown): number[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 4 || value.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new AppError('INVALID_BOUNDS', 'Expected west,south,east,north');
  const [w, s, e, n] = value as [number, number, number, number];
  if (w < -180 || e > 180 || w > e || s < -90 || n > 90 || s > n) throw new AppError('INVALID_BOUNDS', 'Invalid geographic bounds; split antimeridian queries');
  return [w,s,e,n];
}
export function page(query: Data): { limit: number; offset: number } {
  const limit = query.limit ?? 50, offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100 || !Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 10000)
    throw new AppError('INVALID_PAGE', 'limit is 1–100; offset is 0–10000');
  return { limit: Number(limit), offset: Number(offset) };
}
export function publicUrl(value: unknown): string {
  const url = new URL(string(value));
  if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('INVALID_SOURCE', 'Sources must have HTTPS URLs');
  return url.href;
}
