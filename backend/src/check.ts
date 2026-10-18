import { readConfig } from './config.js';
import { corePlans } from './data/queries.js';
import { AppError } from './runtime/errors.js';
import { loadHandoffs } from './runtime/handoffs.js';
import { requiredSchemas } from './services/validation.js';
async function main() {
  const config = readConfig();
  const {contracts,databaseHandoff,sourceDefinitions,observationSources,regions} = await loadHandoffs(config);
  const missingSchemas = requiredSchemas.filter(name => !contracts.has(name));
  const missingPlans = corePlans.filter(name => !databaseHandoff?.plans[name]);
  const dataConfigured = !missingSchemas.length && !missingPlans.length && !!config.databaseUrl;
  console.log(JSON.stringify({
    check:'local_configuration_only',ready_for_data:dataConfigured,
    contracts:{complete:contracts.ready,missing:missingSchemas},database:{credentials_configured:!!config.databaseUrl,missing_plans:missingPlans},
    gemini:{configured:!!config.geminiKey},embeddings:{configured:!!config.embeddingModel},
    sources:{count:sourceDefinitions.length,observation_series:observationSources.length},flights:{enabled:config.flightsEnabled,regions:regions.length},
    live_connections_verified:false
  },null,2));
  if (!dataConfigured) process.exitCode = 2;
}
main().catch(error => {
  console.error(JSON.stringify({error:{code:error instanceof AppError ? error.code : 'CONFIG_INVALID',
    message:error instanceof AppError ? error.message : 'Configuration check failed'}}));
  process.exitCode = 1;
});
