import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
export function assistantRoutes(app: FastifyInstance, services: Services) {
  app.post('/api/assistant', { config:{ rateLimit: {max:12,timeWindow:'1 minute'} } }, request => services.assistant.answer(request.body,request.atlasSignal));
}
