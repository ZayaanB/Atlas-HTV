import type { AnySchema } from 'ajv';
import type { Config } from '../config.js';
import { validateDatabaseHandoff } from '../data/queries.js';
import { Contracts, object, records, string, type Data } from '../services/validation.js';
import { AppError } from './errors.js';
import { loadLocalModule, repoRoot } from './load.js';
function definitionList(value: unknown): Data[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new AppError('SOURCE_HANDOFF_INVALID','Source/region exports must be bounded arrays',500);
  let items: Data[];
  try { items = records(value); }
  catch { throw new AppError('SOURCE_HANDOFF_INVALID','Source/region exports must contain records',500); }
  const ids = items.map(item => string(item.id));
  if (ids.some(id => !id.trim() || id.length > 256) || new Set(ids).size !== ids.length)
    throw new AppError('SOURCE_HANDOFF_INVALID','Source/region IDs must be nonempty and unique',500);
  return items;
}
// Validate local handoffs without opening a database or calling any provider.
export async function loadHandoffs(config: Config, root = repoRoot) {
  const shared = await loadLocalModule(config.contractsModule,['contracts'],root);
  let contracts: Contracts;
  try { contracts = new Contracts(shared ? object(shared.schemas) as Record<string,AnySchema> : {}); }
  catch { throw new AppError('CONTRACT_HANDOFF_INVALID','Shared schemas export could not be compiled',500); }
  const db = await loadLocalModule(config.databaseModule,['db','backend'],root);
  const databaseHandoff = db ? validateDatabaseHandoff(db.databaseHandoff) : undefined;
  const sources = await loadLocalModule(config.sourceDefinitionsModule,['scripts/source-definitions'],root);
  const sourceDefinitions = definitionList(sources?.sources), regions = definitionList(sources?.regions);
  const observationSources = definitionList(sources?.observation_sources);
  if (new Set([...sourceDefinitions,...observationSources].map(item => item.id)).size !== sourceDefinitions.length + observationSources.length)
    throw new AppError('SOURCE_HANDOFF_INVALID','News and observation source IDs share one refresh-state namespace and must be unique',500);
  if (contracts.has('FlightRegion')) {
    try { regions.forEach(region => contracts.parse('FlightRegion',region)); }
    catch { throw new AppError('SOURCE_HANDOFF_INVALID','Configured regions failed shared FlightRegion validation',500); }
  }
  return {contracts,databaseHandoff,sourceDefinitions,observationSources,regions};
}
