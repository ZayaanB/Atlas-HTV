import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery } from '../services/validation.js';
export function locationsRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/locations', request => services.retrieval.locations(normalizeQuery(request.query),request.atlasSignal));
}
