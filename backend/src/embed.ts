import { readConfig } from './config.js';
import { createServices } from './runtime/services.js';
import { Embeddings } from './services/embeddings.js';
import { string } from './services/validation.js';
async function main() {
  const config = readConfig(), services = await createServices(config);
  try {
    const [sourceId,chunkId] = process.argv.slice(2);
    if (!sourceId || !chunkId) throw new Error('Source and chunk IDs required');
    const signal = AbortSignal.timeout(60000);
    const [chunk] = await services.repository.read('embedding_chunks',{source_id:sourceId,chunk_id:chunkId},signal);
    if (!chunk || chunk.embedding_permitted !== true || !string(chunk.text)) throw new Error('No permitted stored chunk');
    const result = await new Embeddings(config).index(services.repository,sourceId,chunkId,string(chunk.text),signal);
    console.log(JSON.stringify({source_id:sourceId,chunk_id:chunkId,...result}));
  } finally { await services.repository.close(); }
}
main().catch(() => { console.error('Embedding failed; verify configured model, dimensions, permissions, and database handoff. Keyword retrieval remains available.'); process.exitCode = 1; });
