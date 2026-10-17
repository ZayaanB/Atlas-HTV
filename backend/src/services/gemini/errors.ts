import {AppError} from '../../runtime/errors.js';
export function modelFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status=error && typeof error==='object' && 'status' in error?Number(error.status):undefined;
  if (status===401 || status===403) return new AppError('GEMINI_AUTH_FAILED','Gemini authentication or project access failed',503);
  if (status===404) return new AppError('GEMINI_MODEL_UNAVAILABLE','The configured Gemini model is unavailable',503);
  if (status===400) return new AppError('GEMINI_REQUEST_REJECTED','Gemini rejected the model or tool configuration',503);
  if (status===429) return new AppError('GEMINI_RATE_LIMITED','Gemini quota is temporarily unavailable; retry later',503,true);
  return new AppError('GEMINI_UNAVAILABLE','Gemini generation failed or could not be reached',503,true);
}
