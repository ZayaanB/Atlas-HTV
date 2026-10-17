import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery } from '../services/validation.js';
export function observationsRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/observations', request => services.retrieval.observations(normalizeQuery(request.query),request.atlasSignal));
  app.get('/api/observations/compare', request => services.retrieval.compare(normalizeQuery(request.query),request.atlasSignal));
}
