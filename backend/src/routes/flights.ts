import { AppError } from '../runtime/errors.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery } from '../services/validation.js';
export function flightsRoutes(app: FastifyInstance, services: Services) {
  const respond = async (reply: FastifyReply, work: () => Promise<unknown>) => {
    reply.header('Cache-Control', 'no-store');
    try { return await work(); }
    catch (error) {
      const retry = (error as { retryAfter?: string }).retryAfter;
      if (typeof retry === 'string' && /^\d+$/.test(retry)) reply.header('Retry-After', retry);
      throw error;
    }
  };
  app.get('/api/flights', (request, reply) => respond(reply, () => services.flights.get(normalizeQuery(request.query),request.atlasSignal)));
  app.get('/api/flights/find', (request, reply) => respond(reply, () => services.flights.find(normalizeQuery(request.query),request.atlasSignal)));
  app.get('/api/flights/global', (request, reply) => respond(reply, () => {
    if (Object.keys(request.query as object).length) throw new AppError('INVALID_QUERY', 'Global flight requests take no query parameters');
    return services.flights.global(request.atlasSignal);
  }));
  app.get('/api/flights/area', (request, reply) => respond(reply, () => services.flights.area(normalizeQuery(request.query),request.atlasSignal)));
}
