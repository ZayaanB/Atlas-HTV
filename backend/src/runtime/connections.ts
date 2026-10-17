import { GoogleGenAI } from '@google/genai';
import type { Config } from '../config.js';
import { createPool } from '../data/database.js';
import { AppError, bounded } from './errors.js';
export interface ProbePool {
  query(text: string): Promise<{rows: Record<string,unknown>[]}>;
  end(): Promise<void>;
}
export interface ProbeModel { name?: string; supportedActions?: string[] }
export interface ProbeDependencies {
  pool(config: Config): Promise<ProbePool | undefined>;
  model(config: Config, signal: AbortSignal): Promise<ProbeModel>;
}
export interface ConnectionResult {
  status: 'passed' | 'failed' | 'missing_configuration';
  code?: string;
  message?: string;
  tls_verified?: boolean;
  extensions?: {timescaledb: boolean; pgvector: boolean};
  generate_content_advertised?: boolean;
}
const defaults: ProbeDependencies = {
  pool: createPool,
  model: (config,signal) => new GoogleGenAI({apiKey:config.geminiKey!,httpOptions:{timeout:config.providerTimeoutMs,retryOptions:{attempts:1}}})
    .models.get({model:config.geminiModel!,config:{abortSignal:signal}})
};
function databaseFailure(error: unknown): ConnectionResult {
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const known: Record<string,[string,string]> = {
    '28P01':['DATABASE_AUTH_FAILED','Check the database username and password with Person 4.'],
    '3D000':['DATABASE_NOT_FOUND','Check the actual database name from the service connection details.'],
    ENOTFOUND:['DATABASE_HOST_UNREACHABLE','Check the service hostname and network/VPN access.'],
    EAI_AGAIN:['DATABASE_HOST_UNREACHABLE','Check DNS and network/VPN access, then retry.'],
    ECONNREFUSED:['DATABASE_HOST_UNREACHABLE','Check that the service is running and the host/port are correct.'],
    ETIMEDOUT:['DATABASE_TIMEOUT','Check service availability and any network access restrictions.'],
    REQUEST_CANCELLED:['DATABASE_TIMEOUT','The read-only connection check timed out.'],
    ENOENT:['DATABASE_CA_UNAVAILABLE','Check DATABASE_CA_FILE, or leave it commented when the system trust store is sufficient.']
  };
  const tlsCodes = ['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'];
  if (typeof rawCode === 'string' && tlsCodes.includes(rawCode)) return {status:'failed',code:'DATABASE_TLS_FAILED',message:'Ask Person 4 for the correct hostname/trusted CA. Keep certificate verification enabled.'};
  const [code,message] = typeof rawCode === 'string' && known[rawCode] ? known[rawCode]! : ['DATABASE_CONNECTION_FAILED','Connection check failed. Confirm the service credentials, network access, and trusted CA with Person 4.'];
  return {status:'failed',code,message};
}
export async function verifyDatabase(config: Config, dependencies: ProbeDependencies = defaults): Promise<ConnectionResult> {
  if (!config.databaseUrl) return {status:'missing_configuration',code:'DATABASE_URL_MISSING',message:'Uncomment DATABASE_URL in backend/.env and fill in the existing service credentials.'};
  let pool: ProbePool | undefined;
  try {
    pool = await dependencies.pool(config);
    if (!pool) throw new Error('No pool');
    const deadline = AbortSignal.timeout(config.providerTimeoutMs);
    // Fixed operational catalogs only: no migrations, imports, application tables, or writes.
    const result = await bounded(pool.query("SELECT ssl AS tls, (SELECT COALESCE(json_agg(extname), '[]'::json) FROM pg_extension WHERE extname IN ('timescaledb', 'vector')) AS extensions FROM pg_stat_ssl WHERE pid = pg_backend_pid()"),deadline);
    const row = result.rows[0];
    if (row?.tls !== true) return {status:'failed',code:'DATABASE_TLS_UNCONFIRMED',message:'The database session did not confirm TLS. Check the service connection with Person 4.'};
    const extensions = Array.isArray(row.extensions) ? row.extensions : [];
    return {status:'passed',tls_verified:true,extensions:{timescaledb:extensions.includes('timescaledb'),pgvector:extensions.includes('vector')}};
  } catch (error) { return databaseFailure(error); }
  finally { if (pool) await pool.end().catch(() => {}); }
}
export async function verifyGemini(config: Config, dependencies: ProbeDependencies = defaults): Promise<ConnectionResult> {
  if (!config.geminiKey || !config.geminiModel) return {status:'missing_configuration',code:'GEMINI_CONFIGURATION_MISSING',message:'Uncomment and fill both GEMINI_API_KEY and GEMINI_MODEL in backend/.env.'};
  try {
    const deadline = AbortSignal.timeout(config.providerTimeoutMs);
    const model = await bounded(dependencies.model(config,deadline),deadline);
    if (!model.name || !model.supportedActions?.includes('generateContent')) return {status:'failed',code:'GEMINI_MODEL_UNSUPPORTED',message:'Choose an available text model that advertises generateContent support.'};
    return {status:'passed',generate_content_advertised:true};
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
    if (status === 400 || status === 401 || status === 403) return {status:'failed',code:'GEMINI_AUTH_FAILED',message:'Check the API key/project permissions and use a key intended for the Gemini API.'};
    if (status === 404) return {status:'failed',code:'GEMINI_MODEL_UNAVAILABLE',message:'Check the exact API model ID and its availability for your project.'};
    if (status === 429) return {status:'failed',code:'GEMINI_RATE_LIMITED',message:'The metadata request was rate limited. Check quota and retry later.'};
    return {status:'failed',code:'GEMINI_CONNECTION_FAILED',message:'Metadata check failed or timed out. Check network access, project/key status, and the model ID.'};
  }
}
export function connectionTargets(args: string[]): ('database' | 'gemini')[] {
  if (args.some(arg => !['--database','--gemini'].includes(arg))) throw new AppError('INVALID_ARGUMENT','Use --database, --gemini, or no flags to check both.');
  return args.length ? [...new Set(args.map(arg => arg === '--database' ? 'database' as const : 'gemini' as const))] : ['database','gemini'];
}
