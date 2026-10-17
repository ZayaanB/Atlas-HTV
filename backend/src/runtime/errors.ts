export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly retryable = false) {
    super(message);
  }
}
export const unavailable = (code: string, message: string) => new AppError(code, message, 503, true);
export function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }
export async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may already have started evaluating before bounded() is entered.
    // Observe its rejection even when the caller's signal was already aborted.
    void work.catch(() => {});
    throw new AppError('REQUEST_CANCELLED', 'Request cancelled or timed out', 408, true);
  }
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new AppError('REQUEST_CANCELLED', 'Request cancelled or timed out', 408, true));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
