import Fastify, { LogController } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { AppError, bounded, checkAbort } from './runtime/errors.js';
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
    errorResponseBuilder: () => new AppError('RATE_LIMIT','Request rate limit exceeded',429,true)
  });
  app.decorateRequest('atlasSignal');
  app.addHook('onRequest', async (request,reply) => {
    const controller = new AbortController();
    controllers.add(controller);
    // Fastify 5.12's request.signal/handlerTimeout abort on IncomingMessage.close,
    // which also fires after a complete POST body. Track actual disconnects and
    // the whole lifecycle deadline ourselves so valid JSON posts remain usable.
    request.atlasSignal = controller.signal;
    const deadline=setTimeout(()=>{
      if (reply.sent || reply.raw.destroyed) return;
      const error=new AppError('REQUEST_TIMEOUT','Request processing timed out',503,true);
      controller.abort(error);
      reply.send(error);
    },config.requestTimeoutMs).unref();
    const cleanup=()=>{
      clearTimeout(deadline);controllers.delete(controller);
      request.raw.off('aborted',abort);reply.raw.off('close',abort);reply.raw.off('finish',cleanup);
    };
    const abort = () => {cleanup();if (!reply.raw.writableEnded) controller.abort();};
    request.raw.once('aborted',abort); reply.raw.once('close',abort);
    reply.raw.once('finish',cleanup);
  });
  app.addHook('onRoute',route => {
    const handler = route.handler;
    route.handler = function (request,reply) {
      // Release the HTTP lifecycle even if an injected adapter ignores cancellation.
      return bounded(Promise.resolve().then(() => {
        checkAbort(request.atlasSignal);
        return handler.call(this,request,reply);
      }),request.atlasSignal);
    };
  });
  app.setErrorHandler((error,request,reply) => {
    if (reply.sent) return;
    const mapped = (error as {code?:string}).code === 'FST_ERR_HANDLER_TIMEOUT'
      ? new AppError('REQUEST_TIMEOUT','Request processing timed out',503,true) : error;
    const known = mapped instanceof AppError;
    const framework = error as {statusCode?:number};
    const status = known ? mapped.status : [400,413,415,429].includes(framework.statusCode ?? 0) ? framework.statusCode! : 500;
    // Never log raw provider/database errors, prompts, URLs, or credentials.
    request.log.warn({code:known ? mapped.code : 'INTERNAL_ERROR',request_id:request.id},'Request failed');
    reply.code(status).send({error:{code:known ? mapped.code : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message:known ? mapped.message : status === 500 ? 'Request failed' : 'Invalid request',retryable:known ? mapped.retryable : status >= 500,request_id:request.id}});
  });
  app.setNotFoundHandler((request,reply) => reply.code(404).send({error:{code:'NOT_FOUND',message:'Endpoint not found',retryable:false,request_id:request.id}}));
  healthRoutes(app,services); newsRoutes(app,services); locationsRoutes(app,services);
  investigationsRoutes(app,services); observationsRoutes(app,services); flightsRoutes(app,services); assistantRoutes(app,services);
  app.addHook('preClose',async () => { for (const controller of controllers) controller.abort(); });
  app.addHook('onClose', async () => { await services.flights.close(); await services.repository.close(); });
  return app;
}
