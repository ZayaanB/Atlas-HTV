import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { AppError } from './runtime/errors.js';
import { createServices, type Services } from './runtime/services.js';
import { healthRoutes } from './routes/health.js';
import { newsRoutes } from './routes/news.js';
import { locationsRoutes } from './routes/locations.js';
import { investigationsRoutes } from './routes/investigations.js';
import { observationsRoutes } from './routes/observations.js';
import { flightsRoutes } from './routes/flights.js';
import { assistantRoutes } from './routes/assistant.js';
declare module 'fastify' { interface FastifyRequest { atlasSignal: AbortSignal } }
export async function buildApp(config: Config, injected?: Services) {
  const services = injected ?? await createServices(config);
  const controllers = new Set<AbortController>();
  const app = Fastify({
    logger: config.nodeEnv !== 'test' ? { level:'info', redact:['req.headers.authorization','req.headers.cookie','req.body','res.headers.set-cookie'] } : false,
    logController:new LogController({disableRequestLogging:true}), bodyLimit:32768, requestTimeout:30000, connectionTimeout:10000,
    forceCloseConnections:'idle', trustProxy:false
  });
  await app.register(rateLimit, { max:config.rateMax,timeWindow:'1 minute',
    errorResponseBuilder: request => ({error:{code:'RATE_LIMIT',message:'Request rate limit exceeded',retryable:true,request_id:request.id}})
  });
  app.decorateRequest('atlasSignal');
  app.addHook('onRequest', async (request,reply) => {
    const controller = new AbortController();
    controllers.add(controller);
    request.atlasSignal = AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
    const abort = () => { controllers.delete(controller); if (!reply.raw.writableEnded) controller.abort(); };
    request.raw.once('aborted',abort); reply.raw.once('close',abort);
    reply.raw.once('finish',() => { controllers.delete(controller); request.raw.off('aborted',abort); reply.raw.off('close',abort); });
  });
  app.setErrorHandler((error,request,reply) => {
    const known = error instanceof AppError;
    const framework = error as {statusCode?:number};
    const status = known ? error.status : [400,413,415,429].includes(framework.statusCode ?? 0) ? framework.statusCode! : 500;
    // Never log raw provider/database errors, prompts, URLs, or credentials.
    request.log.warn({code:known ? error.code : 'INTERNAL_ERROR',request_id:request.id},'Request failed');
    reply.code(status).send({error:{code:known ? error.code : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message:known ? error.message : status === 500 ? 'Request failed' : 'Invalid request',retryable:known ? error.retryable : status >= 500,request_id:request.id}});
  });
  app.setNotFoundHandler((request,reply) => reply.code(404).send({error:{code:'NOT_FOUND',message:'Endpoint not found',retryable:false,request_id:request.id}}));
  healthRoutes(app,services); newsRoutes(app,services); locationsRoutes(app,services);
  investigationsRoutes(app,services); observationsRoutes(app,services); flightsRoutes(app,services); assistantRoutes(app,services);
  app.addHook('preClose',async () => { for (const controller of controllers) controller.abort(); });
  app.addHook('onClose', async () => { services.flights.clear(); await services.repository.close(); });
  return app;
}
