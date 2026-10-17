import { readConfig } from './config.js';
import { createServices } from './runtime/services.js';
import { loadLocalModule } from './runtime/load.js';
import { records } from './services/validation.js';
import { Ingestion } from './data/ingestion.js';
import { Gdelt } from './data/providers/gdelt.js';
import { Rss } from './data/providers/rss.js';
import {AppError} from './runtime/errors.js';
import {ingestionFailure} from './runtime/ingestion-errors.js';
async function main() {
  const config = readConfig(), services = await createServices(config);
  try {
    const sourceModule = await loadLocalModule(config.sourceDefinitionsModule,['scripts/source-definitions']);
    const sourceId = process.argv[2];
    if (!sourceId || process.argv.length!==3) throw new AppError('INVALID_ARGUMENT','Provide exactly one reviewed source ID');
    const ingestion = new Ingestion(services.contracts,services.repository,records(sourceModule?.sources),new Gdelt(config.providerTimeoutMs),new Rss(config.providerTimeoutMs));
    const result = await ingestion.refresh(sourceId,AbortSignal.timeout(60000));
    console.log(JSON.stringify(result));
  } finally { await services.repository.close(); }
}
main().catch(error => { console.error(JSON.stringify({error:ingestionFailure(error)})); process.exitCode = 1; });
