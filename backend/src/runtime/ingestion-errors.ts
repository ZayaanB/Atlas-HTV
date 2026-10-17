import {AppError} from './errors.js';
export function ingestionFailure(error: unknown) {
  if (error instanceof AppError) {
    const status='upstreamStatus' in error?error.upstreamStatus:undefined;
    return {code:error.code,message:error.message,retryable:error.retryable,
      ...(typeof status==='number' && Number.isInteger(status) && status>=100 && status<=599?{upstream_status:status}:{})};
  }
  const code=error && typeof error==='object' && 'code' in error?error.code:undefined;
  if (code==='42501') return {code:'DATABASE_PERMISSION_DENIED',message:'Import database privileges are incomplete; review the runtime grants with Person 4',retryable:false};
  return {code:'INGESTION_FAILED',message:'Import failed. Check reviewed source, contracts, database handoff and provider access. Previous imports are retained.',retryable:true};
}
