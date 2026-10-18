import { AirLabs } from '../data/providers/airlabs.js';
import { GlobalFlights } from '../services/global-flights.js';
import { FileFlightBudget } from '../services/flight-budget.js';
import type { Config } from '../config.js';
import { createPool } from '../data/database.js';
import { PgRepository, UnavailableRepository, type Repository } from '../data/queries.js';
import { AdsbLol } from '../data/providers/adsblol.js';
import { OpenMeteo } from '../data/providers/open-meteo.js';
import { Wind } from '../services/wind.js';
import { Contracts } from '../services/validation.js';
import { Retrieval } from '../services/retrieval.js';
import { Embeddings } from '../services/embeddings.js';
import { Flights } from '../services/flights.js';
import { Gemini } from '../services/gemini/client.js';
import { Assistant } from '../services/gemini/orchestrator.js';
import { loadHandoffs } from './handoffs.js';
export interface Services { contracts: Contracts; repository: Repository; retrieval: Retrieval; flights: Flights; assistant: Assistant; wind?: Wind }
export async function createServices(config: Config): Promise<Services> {
  const {contracts,databaseHandoff,regions} = await loadHandoffs(config);
  let repository: Repository = new UnavailableRepository();
  // No connections/migrations/SQL consumers until a frozen, reviewed handoff is supplied.
  if (databaseHandoff && config.databaseUrl) {
    const pool = await createPool(config);
    if (pool) {
      try { repository = new PgRepository(pool,databaseHandoff,contracts.newsFiltering); }
      catch (error) { await pool.end(); throw error; }
    }
  }
  const retrieval = new Retrieval(contracts,repository,new Embeddings(config));
  const flights = new Flights(contracts,config,regions,config.flightsEnabled && config.flightsProvider === 'adsb.lol' ? new AdsbLol(contracts,config.providerTimeoutMs,config.flightsContact!) : undefined, Date.now,
    config.flightsEnabled && config.flightsProvider === 'airlabs' ? new GlobalFlights(contracts, new AirLabs(contracts,config.airlabsKey!,config.providerTimeoutMs), new FileFlightBudget(config.flightsBudgetDirectory)) : undefined);
  const assistant = new Assistant(config,contracts,retrieval,flights,config.geminiKey ? new Gemini(config) : undefined);
  const wind = new Wind(contracts, config.providerTimeoutMs, config.windEnabled ? new OpenMeteo() : undefined);
  return {contracts,repository,retrieval,flights,assistant,wind};
}
