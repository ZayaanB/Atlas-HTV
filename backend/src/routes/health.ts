import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
export function healthRoutes(app: FastifyInstance, services: Services) {
  app.get('/api/health/live', async () => ({ status:'ok' }));
  app.get('/api/health', async (_request,reply) => {
    const database = await services.repository.health();
    const contracts = services.contracts.ready;
    const queryPlans = services.repository.mode === 'stored' && (services.repository.missingPlans?.length ?? 0) === 0;
    const ready = database && contracts && queryPlans;
    return reply.code(ready ? 200 : 503).send({ status:ready ? 'ready' : 'not_ready', contracts, database, query_plans:queryPlans, data_mode:services.repository.mode });
  });
}
