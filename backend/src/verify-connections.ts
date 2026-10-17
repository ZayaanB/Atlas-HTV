import { readConfig } from './config.js';
import { AppError } from './runtime/errors.js';
import { connectionTargets, verifyDatabase, verifyGemini } from './runtime/connections.js';
async function main() {
  const targets = connectionTargets(process.argv.slice(2)), config = readConfig();
  const entries = await Promise.all(targets.map(async target => [target,target === 'database' ? await verifyDatabase(config) : await verifyGemini(config)] as const));
  const checks = Object.fromEntries(entries);
  console.log(JSON.stringify({check:'read_only_connections',...checks,
    generation_verified:false,application_schema_verified:false,
    note:'Database catalog/model metadata checks only. No migrations, imports, embeddings, or generated answers.'},null,2));
  if (entries.some(([,result]) => result.status === 'failed')) process.exitCode = 1;
  else if (entries.some(([,result]) => result.status === 'missing_configuration')) process.exitCode = 2;
}
main().catch(error => {
  console.error(JSON.stringify({error:{code:error instanceof AppError ? error.code : 'CONFIG_INVALID',
    message:error instanceof AppError ? error.message : 'Connection check configuration is invalid'}}));
  process.exitCode = 1;
});
