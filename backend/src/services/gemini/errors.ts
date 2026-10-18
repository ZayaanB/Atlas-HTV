import {AppError} from '../../runtime/errors.js';

function rejectedRequest(error: object): AppError {
  // Inspect a bounded SDK message only to select fixed, safe diagnostics. Never
  // forward provider text: it may echo request content, credentials or URLs.
  const message='message' in error && typeof error.message==='string'?error.message.slice(0,64000):'';
  if (message.includes('API_KEY_INVALID')) return new AppError('GEMINI_AUTH_FAILED','Gemini rejected the configured API key (provider HTTP 400)',503);
  const schema=/schema|parameters|properties/i.test(message);
  const detail=schema && /non.empty|empty properties/i.test(message)?'an empty object in a tool schema'
    : schema && /too many states|too (?:large|complex|deep)|schema.{0,80}(?:complexity|nesting)/i.test(message)?'a schema that exceeds its complexity limit'
    : /response_?json_?schema|responseJsonSchema/i.test(message)?'the structured answer schema'
    : /parameters_?json_?schema|parametersJsonSchema|function_declarations|functionDeclarations/i.test(message)?'a function declaration'
    : /thinking_?(?:config|level)|thinkingConfig|thinkingLevel/i.test(message)?'the thinking configuration'
    : 'the model or tool configuration';
  return new AppError('GEMINI_REQUEST_REJECTED',`Gemini rejected ${detail} (provider HTTP 400)`,503);
}
export function modelFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status=error && typeof error==='object' && 'status' in error?Number(error.status):undefined;
  if (status===401 || status===403) return new AppError('GEMINI_AUTH_FAILED','Gemini authentication or project access failed',503);
  if (status===404) return new AppError('GEMINI_MODEL_UNAVAILABLE','The configured Gemini model is unavailable',503);
  if (status===400) return rejectedRequest(error as object);
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
