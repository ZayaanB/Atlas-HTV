import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Services } from '../runtime/services.js';

export function workspaceRoutes(app: FastifyInstance, services: Services, config: Config) {
  app.get('/api/workspace', request => {
    const has = (names: string[]) => names.every(name => services.contracts.has(name));
    return services.retrieval.workspace({
      investigations: has(['InvestigationQuery', 'InvestigationResponse']),
      observations: has(['ObservationsQuery', 'ObservationsResponse', 'Observation']),
      assistant: !!config.geminiKey && has(['AssistantRequest', 'AssistantDraft', 'AssistantResponse']),
      flights: config.flightsEnabled && has(['FlightRegion', 'FlightsResponse', 'AircraftState']),
      assistant_context: has(['AssistantRequest', 'InvestigationResponse']),
      series_filter: false // Frozen queries identify a series by location + metric.
    }, services.flights.catalog(), request.atlasSignal);
  });
}
