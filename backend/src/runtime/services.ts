import type { AnySchema } from 'ajv';
import type { Config } from '../config.js';
import { createPool } from '../data/database.js';
import { PgRepository, UnavailableRepository, type DatabaseHandoff, type Repository } from '../data/queries.js';
import { AdsbLol } from '../data/providers/adsblol.js';
import { Contracts, object, records } from '../services/validation.js';
import { Retrieval } from '../services/retrieval.js';
import { Embeddings } from '../services/embeddings.js';
import { Flights } from '../services/flights.js';
import { Gemini } from '../services/gemini/client.js';
import { Assistant } from '../services/gemini/orchestrator.js';
import { loadLocalModule } from './load.js';
export interface Services { contracts: Contracts; repository: Repository; retrieval: Retrieval; flights: Flights; assistant: Assistant }
export async function createServices(config: Config): Promise<Services> {
  const shared = await loadLocalModule(config.contractsModule,['contracts']);
  const contracts = new Contracts(shared ? object(shared.schemas) as Record<string,AnySchema> : {});
  const handoff = await loadLocalModule(config.databaseModule,['db','backend']);
  const sourceModule = await loadLocalModule(config.sourceDefinitionsModule,['scripts/source-definitions']);
  let repository: Repository = new UnavailableRepository();
  // No connections/migrations/SQL consumers until a frozen, reviewed handoff is supplied.
  if (handoff && config.databaseUrl) {
    const pool = await createPool(config);
    if (pool) {
      try { repository = new PgRepository(pool,object(handoff.databaseHandoff) as unknown as DatabaseHandoff); }
      catch (error) { await pool.end(); throw error; }
    }
  }
  const retrieval = new Retrieval(contracts,repository,new Embeddings(config));
  const flights = new Flights(contracts,config,records(sourceModule?.regions),config.flightsEnabled ? new AdsbLol(contracts,config.providerTimeoutMs) : undefined);
  const assistant = new Assistant(config,contracts,retrieval,flights,config.geminiKey ? new Gemini(config) : undefined);
  return {contracts,repository,retrieval,flights,assistant};
}
