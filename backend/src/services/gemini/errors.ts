import {AppError} from '../../runtime/errors.js';
export function modelFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status=error && typeof error==='object' && 'status' in error?Number(error.status):undefined;
  if (status===401 || status===403) return new AppError('GEMINI_AUTH_FAILED','Gemini authentication or project access failed',503);
  if (status===404) return new AppError('GEMINI_MODEL_UNAVAILABLE','The configured Gemini model is unavailable',503);
  if (status===400) return new AppError('GEMINI_REQUEST_REJECTED','Gemini rejected the model or tool configuration',503);
  if (status===429) return new AppError('GEMINI_RATE_LIMITED','Gemini quota is temporarily unavailable; retry later',503,true);
  if (status===408 || status===504) return new AppError('GEMINI_TIMEOUT',`Gemini did not complete in time (provider HTTP ${status}). Try a shorter question or retry later`,503,true);
  if (status===500 || status===502 || status===503)
    return new AppError('GEMINI_UNAVAILABLE',`Gemini returned a temporary server error (provider HTTP ${status}). Retry later`,503,true);
  const name=error && typeof error==='object' && 'name' in error ? error.name : undefined;
  if (name==='AbortError' || name==='TimeoutError')
    return new AppError('GEMINI_TIMEOUT','The backend timed out waiting for Gemini. Try a shorter question or retry later',503,true);
  const cause=error && typeof error==='object' && 'cause' in error ? error.cause : undefined;
  const code=cause && typeof cause==='object' && 'code' in cause ? cause.code : undefined;
  if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH'].includes(String(code)))
    return new AppError('GEMINI_NETWORK_ERROR','The backend could not connect to Gemini. Check the backend network connection, then retry',503,true);
  if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(String(code)))
    return new AppError('GEMINI_TIMEOUT','The backend connection to Gemini timed out. Retry later',503,true);
  return new AppError('GEMINI_UNAVAILABLE','Gemini generation failed or could not be reached',503,true);
}
