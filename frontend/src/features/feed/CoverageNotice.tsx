import type { Coverage } from '@atlas/contracts';
import { dateTime } from '../../lib/presentation';

export function CoverageNotice({ coverage }: { coverage: Coverage | undefined }) {
  if (!coverage) return null;
  const refreshes = coverage.feeds?.flatMap(feed => feed.last_successful_at ? [feed.last_successful_at] : []) ?? [];
  const latest = refreshes.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  return <aside className="coverage" aria-label="Data coverage">
    <strong>{coverage.mode === 'fixture' ? 'Historical curated examples' : coverage.mode === 'unavailable' ? 'Coverage unavailable' : 'Stored reporting'}</strong>
    <p>Coverage is limited to available sources. Records are stored and refreshed from provider feeds on a schedule; this is not a live stream or a complete news feed.</p>
    <p>{latest ? `Latest successful source refresh: ${dateTime(latest)}` : 'No successful feed-refresh time supplied.'}</p>
    {coverage.articles && <p>Stored corpus: {coverage.articles.total} articles, {coverage.articles.unreviewed} unreviewed. These are not filtered-result totals.</p>}
    {!!coverage.feeds?.some(feed => feed.status === 'failed') && <p>Some source refreshes failed. Previously stored records remain available.</p>}
  </aside>;
}
