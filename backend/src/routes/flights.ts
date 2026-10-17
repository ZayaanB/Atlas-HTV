import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery } from '../services/validation.js';
export function flightsRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/flights', request => services.flights.get(normalizeQuery(request.query),request.atlasSignal));
  app.get('/api/flights/find', request => services.flights.find(normalizeQuery(request.query),request.atlasSignal));
}
