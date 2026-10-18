import type { FastifyInstance } from 'fastify';
import type { Services } from '../runtime/services.js';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { AppError, checkAbort } from '../runtime/errors.js';
import type { Data } from '../services/validation.js';
import { requireV2Contracts } from '../services/gemini/v2.js';
import { requireV3Contracts } from '../services/gemini/v3.js';
import type { Config } from '../config.js';
export function assistantRoutes(app: FastifyInstance, services: Services, config: Config) {
  app.post('/api/assistant', { bodyLimit: 65536, config:{ rateLimit: config.aiDemoMode ? false : {max:12,timeWindow:'1 minute'} } }, (request, reply) => {
    if (!request.headers.accept?.includes('text/event-stream')) return services.assistant.answer(request.body, request.atlasSignal);
    const v3 = (request.body as Data | null)?.protocol_version === 3;
    if (v3) requireV3Contracts(services.contracts); else requireV2Contracts(services.contracts);
    const eventSchema = v3 ? 'AssistantStreamEventV3' : 'AssistantStreamEvent';
    if (!services.contracts.has(eventSchema)) throw new AppError('CONTRACTS_UNAVAILABLE', 'Build streaming assistant contracts and restart the backend', 503, true);
    const input = services.contracts.parse(v3 ? 'AssistantRequestV3' : 'AssistantRequestV2', request.body);
    const stream = new PassThrough({ highWaterMark: 16384 });
    const emit = async (event: Data) => {
      checkAbort(request.atlasSignal);
      if (stream.destroyed) throw new AppError('REQUEST_CANCELLED', 'Question cancelled', 408, true);
      const value = services.contracts.parse(eventSchema, { ...event, request_id: input.request_id }, true);
      if (!stream.write(`data: ${JSON.stringify(value)}\n\n`)) await once(stream, 'drain', { signal: request.atlasSignal });
    };
    reply.header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform').header('X-Accel-Buffering', 'no');
    void services.assistant.answer(input, request.atlasSignal, emit).then(async response => {
      await emit({ type: 'complete', response });
    }).catch(async error => {
      if (request.atlasSignal.aborted || stream.destroyed) return;
      const known = error instanceof AppError;
      await emit({ type: 'error', error: {
        code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Assistant stream failed',
        retryable: known ? error.retryable : true, request_id: String(input.request_id),
      } });
    }).catch(() => {}).finally(() => stream.end());
    return reply.send(stream);
  });
}
