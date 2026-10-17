import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
export function investigationsRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/investigations/:id', request => services.retrieval.investigation(request.params,request.atlasSignal));
}
