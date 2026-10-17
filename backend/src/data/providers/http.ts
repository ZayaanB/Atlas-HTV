import { AppError } from '../../runtime/errors.js';
export type Fetch = typeof globalThis.fetch;
export async function readResponse(response: Response, maxBytes = 2000000): Promise<string> {
  if (!response.ok) {
    const error = new AppError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_UNAVAILABLE', 'Provider request failed', 503, true);
    Object.assign(error, { retryAfter: response.headers.get('retry-after') });
    await response.body?.cancel(); throw error;
  }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new AppError('PROVIDER_TOO_LARGE', 'Provider response exceeded safety bound', 502); }
  if (!response.body) return '';
  const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new AppError('PROVIDER_TOO_LARGE', 'Provider response exceeded safety bound', 502);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
