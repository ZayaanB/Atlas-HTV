import { AppError, checkAbort, unavailable } from '../runtime/errors.js';
import { type Data, object, publicUrl, records, string } from '../services/validation.js';
import type { Repository } from './queries.js';
import { assertNotInBackoff, markFailure } from './ingestion.js';
import { type Reading, UsgsWaterData, WATERDATA_ITEMS, validWaterDataDefinition } from './providers/usgs-waterdata.js';
const HOUR = 3600000, DAY = 24*HOUR;
// Re-read the last two hours on every refresh: provisional values published there can still be revised.
const REVISION_OVERLAP_MS = 2*HOUR;
const MAX_BACKFILL_DAYS = 30;
const ID = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
// A reviewed live series definition (scripts/source-definitions `observation_sources`). Series identity, units,
// descriptions and an optional investigation link are configuration, never derived from the provider response.
export function seriesDefinition(definition: Data): Data {
  const text = (key: string, max: number) => {
    const value = definition[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError('SOURCE_DEFINITION_INVALID',`Invalid ${key}`);
    return value;
  };
  const id = (key: string, required = true) => {
    const value = definition[key];
    if (value === undefined && !required) return null;
    if (typeof value !== 'string' || !ID.test(value)) throw new AppError('SOURCE_DEFINITION_INVALID',`Invalid ${key}`);
    return value;
  };
  if (definition.provider !== 'usgs_waterdata' || !validWaterDataDefinition(definition)) throw new AppError('SOURCE_DEFINITION_INVALID','Unsupported observation provider definition');
  if (!Number.isInteger(definition.expected_interval_seconds) || Number(definition.expected_interval_seconds) < 1 || Number(definition.expected_interval_seconds) > 86400)
    throw new AppError('SOURCE_DEFINITION_INVALID','Invalid expected_interval_seconds');
  const backfill = definition.backfill_days ?? 7;
  if (!Number.isInteger(backfill) || Number(backfill) < 1 || Number(backfill) > MAX_BACKFILL_DAYS) throw new AppError('SOURCE_DEFINITION_INVALID','Invalid backfill_days');
  if (!/^[a-z][a-z0-9_]*$/.test(string(definition.metric))) throw new AppError('SOURCE_DEFINITION_INVALID','Invalid metric');
  const site = string(definition.monitoring_location_id).slice(5), parameter = string(definition.parameter_code), statistic = string(definition.statistic_id);
  const url = new URL(WATERDATA_ITEMS);
  for (const [key,value] of Object.entries({monitoring_location_id:string(definition.monitoring_location_id),parameter_code:parameter,statistic_id:statistic}))
    url.searchParams.set(key,value);
  return {
    id:id('series_id'),source_id:`src-usgs-waterdata-${site}-${parameter}-${statistic}`,source_url:url.href,
    source_title:text('title',1000),publisher:'U.S. Geological Survey',location_id:id('location_id'),metric:definition.metric,
    unit:text('unit',100),statistic:'instantaneous',expected_interval_seconds:definition.expected_interval_seconds,
    provider_series_ref:`USGS:${site}:${parameter}:${statistic}`,description:text('description',2000),
    license:text('license',300),license_url:publicUrl(definition.license_url),attribution:text('attribution',1000),
    missing_data_rule:text('missing_data_rule',2000),investigation_id:id('investigation_id',false),backfill_days:backfill
  };
}
export class ObservationIngestion {
  private pending = new Map<string,Promise<Data>>();
  constructor(private repository: Repository, private definitions: Data[], private provider: UsgsWaterData, private clock = Date.now) {}
  refresh(id: string, signal?: AbortSignal): Promise<Data> {
    const existing = this.pending.get(id); if (existing) return existing;
    const promise = this.run(id,signal).finally(() => this.pending.delete(id));
    this.pending.set(id,promise); return promise;
  }
  private async run(id: string, signal?: AbortSignal): Promise<Data> {
    const definition = this.definitions.find(d => d.id === id);
    if (!definition || definition.permitted !== true || !string(definition.license_url)) throw new AppError('SOURCE_NOT_PERMITTED','Use a reviewed permitted source definition');
    if (!this.repository.writeBatch) throw unavailable('INGESTION_UNAVAILABLE','Database import handoff is missing');
    const series = seriesDefinition(definition);
    await assertNotInBackoff(this.repository,id,this.clock,signal);
    const attemptedAt = new Date(this.clock()).toISOString();
    let readings: Reading[] = [], truncated = false, since: string;
    try {
      checkAbort(signal);
      // Resume from the newest stored reading of this series (minus the revision overlap); a new series backfills.
      const [coverage] = await this.repository.read('freshness',{},signal);
      const stored = records(object(coverage ?? {}).datasets).find(d => d.series_id === series.id);
      const now = this.clock(), floor = now - MAX_BACKFILL_DAYS*DAY;
      const resume = stored?.coverage_to ? Date.parse(string(stored.coverage_to)) - REVISION_OVERLAP_MS : now - Number(series.backfill_days)*DAY;
      since = new Date(Math.max(floor,Math.min(resume,now))).toISOString();
      ({readings,truncated} = await this.provider.fetch(definition,since,signal));
      // Coverage is computed from the readings, so an empty refresh writes no series row (nothing new was published).
      if (readings.length) await this.repository.writeBatch('upsert_observation_series',[{
        ...series,retrieved_at:attemptedAt,readings:JSON.stringify(readings)
      }],signal);
    } catch (error) {
      await markFailure(this.repository,id,attemptedAt,error,this.clock);
      throw error;
    }
    const finished = new Date(this.clock()).toISOString();
    await this.repository.writeBatch('mark_refresh',[{source_id:id,attempted_at:attemptedAt,status:'success',last_successful_at:finished,next_retry_at:null}],signal);
    return {source_id:id,series_id:series.id,since,imported:readings.length,truncated,
      newest:readings.at(-1)?.observed_at ?? null,last_successful_at:finished,verification_status:'unreviewed'};
  }
}
