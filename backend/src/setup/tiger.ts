import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,rename,rm,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {createPool} from '../data/database.js';
import type {Config} from '../config.js';
import {AppError} from '../runtime/errors.js';
import {backendRoot,repoRoot} from '../runtime/load.js';
const execute = promisify(execFile);
export const migrations = ['001_extensions','002_records','003_observations','004_embeddings','005_aircraft','006_live'] as const;
export function cleanTigerUri(raw: string): URL {
  let uri: URL;
  try {uri = new URL(raw.trim());} catch {throw new AppError('TIGER_URI_INVALID','Tiger CLI did not return a valid database URI',500);}
  if (!['postgres:','postgresql:'].includes(uri.protocol) || !uri.hostname.endsWith('.tsdb.cloud.timescale.com') && !uri.hostname.endsWith('.tsdb.cloud.tigerdata.com') || !uri.password || !uri.username || uri.pathname.length < 2)
    throw new AppError('TIGER_URI_INVALID','Expected Tiger Cloud credentials with a saved database password',500);
  for (const key of [...uri.searchParams.keys()]) if (/^(ssl|uselibpq)/i.test(key)) uri.searchParams.delete(key);
  return uri;
}
export function mergeEnvironment(text: string, settings: Record<string,string>): string {
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map(line => {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (!key || !Object.hasOwn(settings,key)) return line;
    if (seen.has(key)) return `# Duplicate ${key} removed by Tiger setup`;
    seen.add(key); return `${key}=${JSON.stringify(settings[key])}`;
  });
  for (const [key,value] of Object.entries(settings)) if (!seen.has(key)) lines.push(`${key}=${JSON.stringify(value)}`);
  return lines.join('\n').replace(/\n+$/,'')+'\n';
}
export function assertMigrationPrefix(applied: string[]): void {
  if (applied.length > migrations.length || applied.some((version,index) => version !== migrations[index]))
    throw new AppError('TIGER_SCHEMA_CONFLICT','Existing migration history does not match the frozen handoff; preserve the database and review it',409);
}
function pgpassField(value: string) {return value.replaceAll('\\','\\\\').replaceAll(':','\\:');}
export function pgpass(uri: URL): string {
  return [uri.hostname,uri.port || '5432',decodeURIComponent(uri.pathname.slice(1)),decodeURIComponent(uri.username),decodeURIComponent(uri.password)].map(pgpassField).join(':')+'\n';
}
async function tiger(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const result = await execute('tiger',['--analytics=false','--version-check=false',...args],{
      timeout:20000,maxBuffer:1000000,env:{...process.env,...extraEnv},windowsHide:true
    });
    return result.stdout;
  } catch {
    // execFile errors may contain stdout/stderr and passwords. Never log them.
    throw new AppError('TIGER_CLI_FAILED','Tiger CLI could not read the selected service or its saved role password; check login and password storage',503,true);
  }
}
export interface SetupOptions {service: string; initialize: boolean; caFile?: string}
export function setupOptions(args: string[]): SetupOptions {
  let service = '', initialize = false, caFile: string | undefined;
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg==='--initialize') initialize=true;
    else if (arg==='--service' && args[i+1]) service=args[++i]!;
    else if (arg==='--ca-file' && args[i+1]) caFile=resolve(args[++i]!);
    else throw new AppError('INVALID_ARGUMENT','Use --service ID [--ca-file TRUSTED_CA_PATH] [--initialize]');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(service)) throw new AppError('INVALID_ARGUMENT','Provide the existing Tiger service ID or name with --service');
  return {service,initialize,caFile};
}
interface RuntimePool {query(sql: string): Promise<{rows: Record<string,unknown>[]}>;end(): Promise<void>}
export async function verifyRuntime(config: Config, factory: (config: Config) => Promise<RuntimePool | undefined> = createPool): Promise<void> {
  const pool=await factory(config);
  if (!pool) throw new AppError('TIGER_RUNTIME_FAILED','Runtime connection is not configured',503);
  try {
    const row=(await pool.query("SELECT current_user AS role, (SELECT count(*)::int FROM atlas.schema_migrations) AS migrations, (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit FROM pg_roles WHERE rolname=current_user) OR has_schema_privilege(current_user, 'atlas', 'CREATE') AS privileged")).rows[0];
    if (row?.role!=='atlas_runtime' || row.migrations!==migrations.length || row.privileged!==false)
      throw new AppError('TIGER_RUNTIME_FAILED','Runtime role or readable schema history does not match the handoff',503);
  } finally {await pool.end();}
}
async function saveRuntimeEnvironment(uri: URL, caFile: string | undefined, directory: string) {
  const path = join(backendRoot,'.env');
  let existing: string;
  try {existing = await readFile(path,'utf8');} catch {existing = await readFile(join(backendRoot,'.env.example'),'utf8');}
  const settings: Record<string,string> = {DATABASE_URL:uri.href,ATLAS_CONTRACTS_MODULE:'contracts/dist/index.js',
    ATLAS_DATABASE_MODULE:'db/handoff/database.mjs',ATLAS_SOURCES_MODULE:'scripts/source-definitions/atlas.mjs'};
  if (caFile) settings.DATABASE_CA_FILE=caFile;
  const staged = join(directory,'runtime.env');
  await writeFile(staged,mergeEnvironment(existing,settings),{mode:0o600});
  await rename(staged,path); await chmod(path,0o600);
}
function safeSetupError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = error && typeof error==='object' && 'code' in error ? String(error.code) : '';
  if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED'].includes(code))
    return new AppError('TIGER_TLS_UNTRUSTED','Service TLS is not trusted. Supply a CA obtained from Tiger Console/support via --ca-file; verification remains enabled',503,true);
  return new AppError('TIGER_SETUP_FAILED','Tiger setup failed. Existing database and private environment were not reset; review the reported phase',503,true);
}
interface SetupDependencies {pool: (config: Config) => Promise<RuntimePool | undefined>;cli: typeof tiger}
export async function setupTiger(config: Config, options: SetupOptions, report: (value: Record<string,unknown>) => void,
  dependencies: SetupDependencies = {pool:createPool,cli:tiger}) {
  const directory = await mkdtemp(join(backendRoot,'.env.tiger-'));
  let pool: RuntimePool | undefined;
  try {
    const service = JSON.parse(await dependencies.cli(['service','get',options.service,'-o','json'])) as {metadata?:{environment?:string};status?:string};
    if (service.metadata?.environment !== 'DEV' || service.status !== 'READY')
      throw new AppError('TIGER_SERVICE_NOT_DEV','Setup requires an existing READY service tagged DEV; no provisioning or production mutation is performed',409);
    const role = options.initialize ? 'tsdbadmin' : 'atlas_runtime';
    const uri = cleanTigerUri(await dependencies.cli(['db','uri',options.service,'--role',role,'--with-password']));
    if (decodeURIComponent(uri.username)!==role) throw new AppError('TIGER_ROLE_MISMATCH','CLI returned an unexpected role',409);
    const caFile = options.caFile ?? config.databaseCaFile;
    pool = await dependencies.pool({...config,databaseUrl:uri.href,databaseCaFile:caFile});
    if (!pool) throw new AppError('TIGER_SETUP_FAILED','No database connection configured',500);
    report({phase:'verify_tls',status:'checking'});
    const state = (await pool.query("SELECT to_regnamespace('atlas') IS NOT NULL AS atlas_schema, to_regclass('atlas.schema_migrations')::text AS migrations, EXISTS(SELECT 1 FROM pg_roles WHERE rolname='atlas_runtime') AS runtime_role")).rows[0] as {atlas_schema:boolean;migrations:string|null;runtime_role:boolean};
    if (state.atlas_schema && !state.migrations) throw new AppError('TIGER_SCHEMA_CONFLICT','Existing atlas schema has no recognized migration history; no changes applied',409);
    const applied: string[] = state.migrations ? (await pool.query('SELECT version FROM atlas.schema_migrations ORDER BY version')).rows.map(row => row.version as string) : [];
    assertMigrationPrefix(applied);
    if (!options.initialize && applied.length!==migrations.length) throw new AppError('TIGER_SCHEMA_INCOMPLETE','Reviewed migrations are missing; use --initialize only when authorized to apply the frozen handoff',409);
    if (options.initialize) {
      const passwordFile = join(directory,'pgpass');
      await writeFile(passwordFile,pgpass(uri),{mode:0o600});
      const psqlEnv: NodeJS.ProcessEnv = {...process.env,PGHOST:uri.hostname,PGPORT:uri.port || '5432',PGDATABASE:decodeURIComponent(uri.pathname.slice(1)),
        PGUSER:'tsdbadmin',PGPASSFILE:passwordFile,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c statement_timeout=120000'};
      delete psqlEnv.PGPASSWORD; delete psqlEnv.PGSERVICE; delete psqlEnv.PGSERVICEFILE;
      // libpq otherwise expects ~/.postgresql/root.crt, unlike Node's bundled trust store.
      const trustedRoots=caFile ?? join(directory,'trusted-roots.pem');
      if (!caFile) await writeFile(trustedRoots,rootCertificates.join('\n'),{mode:0o600});
      psqlEnv.PGSSLROOTCERT=trustedRoots;
      const apply = async (path: string, phase: string) => {
        report({phase,status:'applying'});
        try {await execute('psql',['-X','--no-password','--set=ON_ERROR_STOP=1','--file',join(repoRoot,path)],{cwd:repoRoot,env:psqlEnv,timeout:180000,maxBuffer:2000000});}
        catch {throw new AppError('TIGER_SQL_FAILED',`Reviewed setup file failed during ${phase}; completed migrations/seed transactions are preserved`,503);}
      };
      for (const migration of migrations.slice(applied.length)) await apply(`db/migrations/${migration}.sql`,migration);
      await apply('db/roles/atlas_runtime.sql','runtime_role_grants');
      if (!state.runtime_role) {
        const password=randomBytes(32).toString('base64url');
        // Generated base64url only, never request/model text. PostgreSQL role DDL has no bind placeholder here.
        await pool.query(`ALTER ROLE atlas_runtime PASSWORD '${password}'`);
        uri.username='atlas_runtime'; uri.password=password;
        // Persist the newly generated credential before further probes, so a failed
        // grant/seed check can be retried without rotating or losing this role password.
        await saveRuntimeEnvironment(uri,caFile,directory);
        try {await dependencies.cli(['db','save-password',options.service,'--role','atlas_runtime'],{TIGER_NEW_PASSWORD:password});}
        catch {report({phase:'cli_runtime_password_cache',status:'not_saved',note:'Runtime credentials were saved only in the private backend environment'});}
        await verifyRuntime({...config,databaseUrl:uri.href,databaseCaFile:caFile},dependencies.pool);
      } else {
        let runtime: URL | undefined;
        if (config.databaseUrl) {
          const local=cleanTigerUri(config.databaseUrl);
          if (decodeURIComponent(local.username)==='atlas_runtime' && local.hostname===uri.hostname && local.port===uri.port && local.pathname===uri.pathname) runtime=local;
        }
        runtime ??= cleanTigerUri(await dependencies.cli(['db','uri',options.service,'--role','atlas_runtime','--with-password']));
        if (decodeURIComponent(runtime.username)!=='atlas_runtime' || runtime.hostname!==uri.hostname || runtime.port!==uri.port || runtime.pathname!==uri.pathname) throw new AppError('TIGER_ROLE_MISMATCH','Runtime role or endpoint differs from the selected service',409);
        await verifyRuntime({...config,databaseUrl:runtime.href,databaseCaFile:caFile},dependencies.pool);
        await saveRuntimeEnvironment(runtime,caFile,directory);
      }
      const count = Number((await pool.query('SELECT count(*)::int AS count FROM atlas.investigations')).rows[0]?.count);
      if (count===0) {
        const articles=Number((await pool.query('SELECT count(*)::int AS count FROM atlas.articles')).rows[0]?.count);
        const observations=Number((await pool.query('SELECT count(*)::int AS count FROM atlas.observations')).rows[0]?.count);
        const partial=Number((await pool.query('SELECT (SELECT count(*) FROM atlas.sources) + (SELECT count(*) FROM atlas.locations) + (SELECT count(*) FROM atlas.entities) + (SELECT count(*) FROM atlas.evidence) + (SELECT count(*) FROM atlas.observation_series) AS count')).rows[0]?.count);
        if (articles || observations || partial) throw new AppError('TIGER_SEED_CONFLICT','Existing records found without the expected investigation; no seed overwrite performed',409);
        await apply('db/seeds/helene-asheville-2024/load.sql','helene_seed');
      } else report({phase:'helene_seed',status:'preserved_existing_data'});
    } else {
      await verifyRuntime({...config,databaseUrl:uri.href,databaseCaFile:caFile},dependencies.pool);
      await saveRuntimeEnvironment(uri,caFile,directory);
    }
    report({phase:'complete',status:'configured',role:'atlas_runtime',credentials_printed:false});
  } catch(error) {throw safeSetupError(error);}
  finally {if(pool) await pool.end(); await rm(directory,{recursive:true,force:true});}
}
