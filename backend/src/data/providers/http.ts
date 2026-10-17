import { AppError, bounded, checkAbort } from '../../runtime/errors.js';
import { object, type Data } from '../../services/validation.js';
export type Fetch = typeof globalThis.fetch;
function cancel(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}
export async function readResponse(response: Response, maxBytes = 2000000, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  if (!response.ok) {
    const error = new AppError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_UNAVAILABLE', 'Provider request failed', 503, true);
    Object.assign(error, { retryAfter: response.headers.get('retry-after'), upstreamStatus: response.status });
    cancel(response.body); throw error;
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    cancel(response.body); throw new AppError('PROVIDER_TOO_LARGE', 'Provider response exceeded safety bound', 502);
  }
  if (!response.body) return '';
  const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const pending = reader.read();
      const {done,value} = signal ? await bounded(pending,signal) : await pending;
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new AppError('PROVIDER_TOO_LARGE', 'Provider response exceeded safety bound', 502);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    // Cleanup must not mask the provider error or hang a cancelled request.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function fetchText(fetcher: Fetch, url: string | URL, options: RequestInit & {signal: AbortSignal}, maxBytes = 2000000): Promise<string> {
  checkAbort(options.signal);
  let response: Response;
  try {
    response = await bounded(Promise.resolve().then(() => {
      checkAbort(options.signal);
      return fetcher(url,options);
    }),options.signal);
  } catch (error) {
    checkAbort(options.signal);
    if (error instanceof AppError) throw error;
    throw new AppError('PROVIDER_NETWORK_ERROR','Provider could not be reached; verify the reviewed endpoint and network',503,true);
  }
  return readResponse(response,maxBytes,options.signal);
}
export function jsonObject(text: string): Data {
  try { return object(JSON.parse(text)); }
  catch { throw new AppError('INVALID_PROVIDER_DATA','Provider returned an invalid JSON object',502); }
}
