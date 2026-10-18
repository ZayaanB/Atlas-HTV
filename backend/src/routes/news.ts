import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery } from '../services/validation.js';
export function newsRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/news', request => services.retrieval.news(normalizeQuery(request.query),request.atlasSignal));
  app.get<{ Params: { id: string } }>('/api/articles/:id', request => services.retrieval.article(request.params.id, request.atlasSignal));
}
