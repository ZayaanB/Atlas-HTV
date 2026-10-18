import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Services } from '../runtime/services.js';

export function workspaceRoutes(app: FastifyInstance, services: Services, config: Config) {
  app.get('/api/workspace', request => {
    const has = (names: string[]) => names.every(name => services.contracts.has(name));
    // Person 1 adds this optional capability to the authoritative workspace
    // schema. Older shared schemas must continue producing valid catalogs.
    const schema = services.contracts.schemas.WorkspaceResponse as { properties?: { capabilities?: { properties?: Record<string, unknown> } } } | undefined;
    const areaCapability = schema?.properties?.capabilities?.properties?.flight_areas;
    return services.retrieval.workspace({
      investigations: has(['InvestigationQuery', 'InvestigationResponse']),
      observations: has(['ObservationsQuery', 'ObservationsResponse', 'Observation']),
      assistant: !!config.geminiKey && has(['AssistantRequest', 'AssistantDraft', 'AssistantResponse']),
      ...(schema?.properties?.capabilities?.properties?.flight_global ? { flight_global: services.flights.globalAvailable } : {}),
      flights: config.flightsEnabled && config.flightsProvider === 'adsb.lol' && has(['FlightRegion', 'FlightsResponse', 'AircraftState']),
      ...(areaCapability ? { flight_areas: services.flights.areaAvailable } : {}),
      assistant_context: has(['AssistantRequest', 'InvestigationResponse']),
      series_filter: false // Frozen queries identify a series by location + metric.
    }, services.flights.catalog(), request.atlasSignal);
  });
}
