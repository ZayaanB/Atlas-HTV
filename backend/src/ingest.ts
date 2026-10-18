import { readConfig } from './config.js';
import { createServices } from './runtime/services.js';
import { loadLocalModule } from './runtime/load.js';
import { records, string } from './services/validation.js';
import { Ingestion } from './data/ingestion.js';
import { ObservationIngestion } from './data/observation-ingestion.js';
import { refreshAll, type RefreshTarget } from './data/refresh.js';
import { Gdelt } from './data/providers/gdelt.js';
import { Rss } from './data/providers/rss.js';
import { UsgsWaterData } from './data/providers/usgs-waterdata.js';
import {AppError} from './runtime/errors.js';
import {ingestionFailure} from './runtime/ingestion-errors.js';
// Usage: ingest <reviewed-source-id> | ingest --all
// --all refreshes every reviewed news and observation source once, sequentially (the scheduled timer uses this).
// It exits non-zero only when no source succeeded and at least one failed; backoff skips are not failures.
async function main() {
  const config = readConfig(), services = await createServices(config);
  try {
    const sourceModule = await loadLocalModule(config.sourceDefinitionsModule,['scripts/source-definitions']);
    const args = process.argv.slice(2);
    if (args.length!==1 || !args[0]) throw new AppError('INVALID_ARGUMENT','Provide exactly one reviewed source ID, or --all');
    const newsDefinitions = records(sourceModule?.sources), observationDefinitions = records(sourceModule?.observation_sources);
    const news = new Ingestion(services.contracts,services.repository,newsDefinitions,new Gdelt(config.ingestionProviderTimeoutMs),new Rss(config.ingestionProviderTimeoutMs));
    const observations = new ObservationIngestion(services.repository,observationDefinitions,new UsgsWaterData(config.ingestionProviderTimeoutMs));
    const targets: RefreshTarget[] = [
      ...newsDefinitions.map(d => ({id:string(d.id),provider:string(d.provider),refresh:(signal: AbortSignal) => news.refresh(string(d.id),signal)})),
      ...observationDefinitions.map(d => ({id:string(d.id),provider:string(d.provider),refresh:(signal: AbortSignal) => observations.refresh(string(d.id),signal)}))
    ];
    if (args[0] === '--all') {
      const results = await refreshAll(targets);
      console.log(JSON.stringify({results}));
      if (!results.some(r => r.status === 'success') && results.some(r => r.status === 'failed')) process.exitCode = 1;
      return;
    }
    const target = targets.find(t => t.id === args[0]);
    if (!target) throw new AppError('SOURCE_NOT_PERMITTED','Use a reviewed permitted source definition');
    console.log(JSON.stringify(await target.refresh(AbortSignal.timeout(60000))));
  } finally { await services.repository.close(); }
}
main().catch(error => { console.error(JSON.stringify({error:ingestionFailure(error)})); process.exitCode = 1; });
