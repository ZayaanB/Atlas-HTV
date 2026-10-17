import { readConfig } from './config.js';
import { createServices } from './runtime/services.js';
import { loadLocalModule } from './runtime/load.js';
import { records } from './services/validation.js';
import { Ingestion } from './data/ingestion.js';
import { Gdelt } from './data/providers/gdelt.js';
import { Rss } from './data/providers/rss.js';
async function main() {
  const config = readConfig(), services = await createServices(config);
  try {
    const sourceModule = await loadLocalModule(config.sourceDefinitionsModule,['scripts/source-definitions']);
    const sourceId = process.argv[2];
    if (!sourceId) throw new Error('Source ID required');
    const ingestion = new Ingestion(services.contracts,services.repository,records(sourceModule?.sources),new Gdelt(config.providerTimeoutMs),new Rss(config.providerTimeoutMs));
    const result = await ingestion.refresh(sourceId,AbortSignal.timeout(60000));
    console.log(JSON.stringify(result));
  } finally { await services.repository.close(); }
}
main().catch(() => { console.error('Import failed. Check the reviewed source, shared contracts, frozen database handoff, and provider access. Previous imports are retained.'); process.exitCode = 1; });
