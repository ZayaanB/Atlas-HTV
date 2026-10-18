import { fileURLToPath } from 'node:url';
import { AppError } from './runtime/errors.js';
import { flightUserAgent } from './data/providers/flight-identity.js';
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    if (env[key] !== undefined && !/^\d+$/.test(env[key]!)) throw new AppError('CONFIG_INVALID', `Invalid ${key}`, 500);
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new AppError('CONFIG_INVALID', `Invalid ${key}`, 500);
    return value;
  };
  const flag = (key: string) => {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key]!)) throw new AppError('CONFIG_INVALID', `Invalid ${key}`, 500);
    return env[key] === 'true';
  };
  const optional = (key: string) => {
    const value = env[key];
    if (value !== undefined && (!value.trim() || value !== value.trim())) throw new AppError('CONFIG_INVALID', `Invalid ${key}`, 500);
    return value;
  };
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new AppError('CONFIG_INVALID', 'Invalid NODE_ENV', 500);
  const databaseUrl = optional('DATABASE_URL');
  if (databaseUrl) {
    let url: URL;
    try { url = new URL(databaseUrl); } catch { throw new AppError('CONFIG_INVALID', 'Invalid DATABASE_URL', 500); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || [...url.searchParams.keys()].some(k => /^(ssl|uselibpq)/i.test(k)))
      throw new AppError('CONFIG_INVALID', 'DATABASE_URL must be PostgreSQL without TLS override parameters', 500);
  }
  const geminiKey = optional('GEMINI_API_KEY'), geminiModel = optional('GEMINI_MODEL');
  const aiDemoMode = flag('AI_DEMO_MODE');
  const geminiThinkingLevel = optional('GEMINI_THINKING_LEVEL');
  if (geminiThinkingLevel && !['minimal','low','medium','high'].includes(geminiThinkingLevel))
    throw new AppError('CONFIG_INVALID','Invalid GEMINI_THINKING_LEVEL',500);
  const embeddingModel = optional('EMBEDDING_MODEL'), embeddingVersion = optional('EMBEDDING_VERSION');
  if (!!geminiKey !== !!geminiModel) throw new AppError('CONFIG_INVALID', 'Set both GEMINI_API_KEY and GEMINI_MODEL', 500);
  if (!!embeddingModel !== !!env.EMBEDDING_DIMENSIONS) throw new AppError('CONFIG_INVALID', 'Set both embedding model and dimensions', 500);
  if (embeddingModel && !geminiKey) throw new AppError('CONFIG_INVALID','Embeddings require configured Gemini credentials',500);
  if (embeddingVersion && !embeddingModel) throw new AppError('CONFIG_INVALID','EMBEDDING_VERSION requires EMBEDDING_MODEL',500);
  const flightsStaleMs = integer('FLIGHTS_STALE_AFTER_MS',120000,1000,3600000);
  const flightsExpireMs = integer('FLIGHTS_CACHE_TTL_MS',300000,1000,3600000);
  if (flightsStaleMs > flightsExpireMs) throw new AppError('CONFIG_INVALID','Flight expiry must be at least the stale threshold',500);
  const flightsEnabled = flag('FLIGHTS_ENABLED'), flightsContact = optional('FLIGHTS_CONTACT');
  const flightsProvider = optional('FLIGHTS_PROVIDER') ?? 'adsb.lol';
  if (!['adsb.lol', 'airlabs'].includes(flightsProvider)) throw new AppError('CONFIG_INVALID', 'Invalid FLIGHTS_PROVIDER', 500);
  const airlabsKey = optional('AIRLABS_API_KEY');
  if (flightsProvider === 'adsb.lol' && (flightsEnabled || flightsContact !== undefined)) flightUserAgent(flightsContact);
  if (flightsEnabled && flightsProvider === 'airlabs' && !airlabsKey) throw new AppError('CONFIG_INVALID', 'AIRLABS_API_KEY is required', 500);
  return {
    nodeEnv, host: env.HOST ?? '127.0.0.1', port: integer('PORT', 3001, 1, 65535),
    databaseUrl, databaseCaFile: optional('DATABASE_CA_FILE'),
    contractsModule: optional('ATLAS_CONTRACTS_MODULE'), databaseModule: optional('ATLAS_DATABASE_MODULE'),
    sourceDefinitionsModule: optional('ATLAS_SOURCES_MODULE'),
    geminiKey, geminiModel, geminiThinkingLevel, aiDemoMode,
    embeddingModel, embeddingVersion: embeddingVersion ?? embeddingModel,
    embeddingDimensions: integer('EMBEDDING_DIMENSIONS', 768, 1, 3072),
    aiTimeoutMs: Math.max(aiDemoMode ? 600000 : 0, integer('AI_REQUEST_TIMEOUT_MS', 20000, 100, 3600000)),
    // Zero means no iteration/call cap. The request deadline and cancellation
    // still terminate generation, including a model stuck calling tools.
    aiMaxTools: aiDemoMode ? 0 : integer('AI_MAX_TOOL_CALLS', 8, 0, 16),
    aiMaxRounds: aiDemoMode ? 0 : integer('AI_MAX_ROUNDS', 4, 0, 8),
    aiMaxContextBytes: Math.max(aiDemoMode ? 1048576 : 0, integer('AI_MAX_CONTEXT_BYTES', 128000, 4000, 16777216)),
    aiMaxOutputTokens: Math.max(aiDemoMode ? 65536 : 0, integer('AI_MAX_OUTPUT_TOKENS', 16384, 512, 65536)),
    windEnabled: env.WIND_ENABLED === undefined ? true : flag('WIND_ENABLED'),
    flightsEnabled, flightsContact, flightsProvider, airlabsKey,
    flightsBudgetDirectory: optional('FLIGHTS_BUDGET_DIRECTORY') ?? fileURLToPath(new URL('../.flight-budget/', import.meta.url)),
    flightsRefreshMs: integer('FLIGHTS_REFRESH_INTERVAL_MS', 60000, 30000, 3600000),
    flightsStaleMs: integer('FLIGHTS_STALE_AFTER_MS', 120000, 1000, 3600000),
    flightsExpireMs: integer('FLIGHTS_CACHE_TTL_MS', 300000, 1000, 3600000),
    flightsMaxRegions: integer('FLIGHTS_MAX_ACTIVE_REGIONS', 2, 1, 10),
    flightsGlobalRefreshMs: integer('FLIGHTS_GLOBAL_INTERVAL_MS', 30000, 30000, 3600000),
    flightsActiveMs: integer('FLIGHTS_AREA_IDLE_MS', 120000, 60000, 3600000),
    providerTimeoutMs: integer('PROVIDER_TIMEOUT_MS', 8000, 100, 30000),
    ingestionProviderTimeoutMs: integer('INGESTION_PROVIDER_TIMEOUT_MS',30000,100,30000),
    rateMax: integer('RATE_LIMIT_MAX', 120, 1, 1000),
    aiConcurrency: Math.max(aiDemoMode ? 8 : 0, integer('AI_MAX_CONCURRENT', 2, 1, 64)),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS',30000,100,60000)
  };
}
export type Config = ReturnType<typeof readConfig>;
