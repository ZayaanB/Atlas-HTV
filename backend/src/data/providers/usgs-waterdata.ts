import { AppError } from '../../runtime/errors.js';
import { type Data, object, records, string } from '../../services/validation.js';
import { fetchText, jsonObject, type Fetch } from './http.js';
// USGS Water Data for the Nation OGC API, `continuous` collection (verified 2026-10-17/18 for USGS-03451500 and
// USGS-03451000). It replaces the legacy waterservices IV endpoint the 2024 seed was archived from. Values arrive as
// strings in the provider's own unit; most recent readings are Provisional and can be revised.
export const WATERDATA_ITEMS = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items';
export const MAX_READINGS = 1000;
export interface Reading { observed_at: string; value: number | null; qualifiers: string[] }
const APPROVAL: Record<string,string> = { Provisional:'P', Approved:'A' };
export function validWaterDataDefinition(definition: Data): boolean {
  return /^USGS-\d{8,15}$/.test(string(definition.monitoring_location_id)) && /^\d{5}$/.test(string(definition.parameter_code)) &&
    /^\d{5}$/.test(string(definition.statistic_id)) && !!string(definition.unit).trim();
}
function utc(value: unknown): string | null {
  const text = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
function qualifiers(approval: unknown, qualifier: unknown): string[] {
  const codes: string[] = [];
  const status = string(approval).trim();
  if (status) codes.push(APPROVAL[status] ?? status);
  // Provider qualifier codes are kept verbatim (bounded); their meanings are USGS's, not inferred here.
  const raw = Array.isArray(qualifier) ? qualifier : typeof qualifier === 'string' ? qualifier.replace(/[[\]"']/g,' ').split(/[,\s]+/) : [];
  for (const code of raw) if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(code.trim())) codes.push(code.trim());
  return [...new Set(codes)].slice(0,10);
}
export class UsgsWaterData {
  constructor(private timeoutMs: number, private fetcher: Fetch = fetch) {}
  // Readings at or after `since`, ascending. `truncated` means the page limit was reached; the next refresh resumes
  // from the newest stored reading, so a long gap is filled over several bounded refreshes.
  async fetch(definition: Data, since: string, signal?: AbortSignal): Promise<{readings: Reading[]; truncated: boolean}> {
    if (!validWaterDataDefinition(definition)) throw new AppError('SOURCE_DEFINITION_INVALID','Water Data series requires a reviewed site, parameter, statistic and unit');
    if (!utc(since)) throw new AppError('INVALID_TIME','Water Data refresh requires a UTC start time');
    const url = new URL(WATERDATA_ITEMS);
    for (const [key,value] of Object.entries({
      monitoring_location_id:string(definition.monitoring_location_id),parameter_code:string(definition.parameter_code),
      statistic_id:string(definition.statistic_id),time:`${since}/..`,f:'json',limit:String(MAX_READINGS),
      properties:'time,value,unit_of_measure,approval_status,qualifier,monitoring_location_id,parameter_code,statistic_id'
    })) url.searchParams.set(key,value);
    const result = jsonObject(await fetchText(this.fetcher,url,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(signal ? [signal] : [])]),headers:{accept:'application/geo+json, application/json'}}));
    if (!Array.isArray(result.features) || result.features.length > MAX_READINGS) throw new AppError('INVALID_PROVIDER_DATA','Water Data returned an invalid feature list',502);
    const readings = new Map<string,Reading>();
    for (const feature of records(result.features)) {
      const p = object(feature.properties ?? {});
      // Never file a reading under the wrong site, parameter, statistic or unit.
      if ((p.monitoring_location_id !== undefined && p.monitoring_location_id !== definition.monitoring_location_id) ||
        (p.parameter_code !== undefined && p.parameter_code !== definition.parameter_code) ||
        (p.statistic_id !== undefined && p.statistic_id !== definition.statistic_id))
        throw new AppError('INVALID_PROVIDER_DATA','Water Data returned a reading for another series',502);
      if (p.unit_of_measure !== definition.unit) throw new AppError('PROVIDER_UNIT_CHANGED','Water Data unit differs from the reviewed series unit',502);
      const observed_at = utc(p.time);
      if (!observed_at) throw new AppError('INVALID_PROVIDER_DATA','Water Data returned an invalid reading time',502);
      const text = typeof p.value === 'string' ? p.value.trim() : p.value;
      const value = text === null || text === '' ? null : Number(text);
      if (value !== null && !Number.isFinite(value)) throw new AppError('INVALID_PROVIDER_DATA','Water Data returned a non-numeric value',502);
      readings.set(observed_at,{observed_at,value,qualifiers:qualifiers(p.approval_status,p.qualifier)});
    }
    return {readings:[...readings.values()].sort((a,b) => a.observed_at < b.observed_at ? -1 : 1),truncated:result.features.length >= MAX_READINGS};
  }
}
