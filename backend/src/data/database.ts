import pg from 'pg';
import { readFile } from 'node:fs/promises';
import type { Config } from '../config.js';
export async function createPool(config: Config): Promise<pg.Pool | undefined> {
  if (!config.databaseUrl) return;
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: true, ...(config.databaseCaFile ? { ca: await readFile(config.databaseCaFile, 'utf8') } : {}) },
    max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 8000, query_timeout: 9000, application_name: 'atlas-backend'
  });
  // Do not log errors carrying connection credentials or SQL/provider contents.
  pool.on('error', () => {});
  return pool;
}
