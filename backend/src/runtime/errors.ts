export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly retryable = false) {
    super(message);
  }
}
export const unavailable = (code: string, message: string) => new AppError(code, message, 503, true);
function cancellation(signal: AbortSignal): AppError {
  return signal.reason instanceof AppError && signal.reason.code==='REQUEST_TIMEOUT'
    ? signal.reason : new AppError('REQUEST_CANCELLED','Request cancelled or timed out',408,true);
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellation(signal);
}
export async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may already have started evaluating before bounded() is entered.
    // Observe its rejection even when the caller's signal was already aborted.
    void work.catch(() => {});
    throw cancellation(signal);
  }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(cancellation(signal));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
