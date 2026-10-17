import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function apiExamples() {
  const core = JSON.parse(await readFile(new URL('../examples/helene-core.json', import.meta.url), 'utf8'));
  const coverage = {
    mode: 'fixture', live: false, scope: 'all', feeds: [], datasets: [],
    articles: {
      total: core.articles.length,
      reviewed: core.articles.filter(a => a.verification_status === 'reviewed').length,
      unreviewed: core.articles.filter(a => a.verification_status === 'unreviewed').length,
      publication_time_known: core.articles.filter(a => a.published_at !== null).length,
      publication_date_only: core.articles.filter(a => a.publication_time_basis === 'date_only').length
    }
  };
  return {
    provenance: core.provenance,
    news: { items: core.articles, limit: 50, offset: 0, coverage, search_mode: 'keyword' },
    locations: { items: core.locations, coverage },
    emptyNews: { items: [], limit: 50, offset: 0, coverage, search_mode: 'keyword' }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL('../examples/helene-api.json', import.meta.url), `${JSON.stringify(await apiExamples(), null, 2)}\n`);
}
