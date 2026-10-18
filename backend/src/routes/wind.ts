import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { normalizeQuery, object } from '../services/validation.js';
import { AppError, unavailable } from '../runtime/errors.js';
export function windRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/wind', request => {
    if (!services.wind) throw unavailable('WIND_DISABLED', 'Wind service is not configured');
    const raw = object(request.query);
    if (typeof raw.bounds === 'string' && (raw.bounds.split(',').length !== 4 ||
      raw.bounds.split(',').some(value => !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))))
      throw new AppError('INVALID_INPUT', 'Use four numeric wind bounds: west,south,east,north');
    return services.wind.get(normalizeQuery(raw), request.atlasSignal);
  });
}
