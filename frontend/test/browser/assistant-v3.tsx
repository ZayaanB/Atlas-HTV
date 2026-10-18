// Explicit offline review entry; never imported by the production app.
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import examples from '@atlas/contracts/examples/helene-api.json';
import type { AtlasMapProps } from '../../src/app/map-interface';
import { App } from '../../src/app/App';
import { useWorkspace } from '../../src/app/state';
import { createFixtureApi } from '../../src/lib/fixture-api';
import { createQueryClient } from '../../src/lib/queries';
import { readContract } from '../../src/lib/validation';
import type { AtlasApi } from '../../src/lib/api';
import '../../src/styles/global.css';

const articles = examples.news.items.slice(0, 2);
const api: AtlasApi = { ...createFixtureApi(2), async assistantV3(request, signal) {
  // The label is deliberately part of every answer. This tests UI, not Gemini.
  await new Promise<void>((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, 1200);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const clarification = /toronto/i.test(request.message);
  return readContract('AssistantResponseV3', {
    protocol_version: 3, request_id: request.request_id, conversation_id: 'offline-browser-session', context: request.workspace,
    research_scope: {}, kind: clarification ? 'clarification' : 'answer',
    answer: clarification ? 'Offline UI scenario: Toronto, Ontario or Toronto, Ohio?'
      : `Offline UI scenario using historical records.\n\n${articles.map((article, index) => `${index + 1}. ${article.title}\n${article.excerpt ?? 'Only the stored title is available.'}`).join('\n\n')}`,
    actions: clarification ? [] : [{ type: 'set_basemap', basemap: 'satellite' }],
    references: clarification ? [] : articles.map(article => ({ record_type: 'article', id: article.id, label: article.title })),
    pending: clarification ? { id: 'offline-place-question', question: 'Toronto, Ontario or Toronto, Ohio?', choices: ['Ontario', 'Ohio'], actions: [] } : null,
    citations: [], result_ids: [], coverage: examples.news.coverage, mode: 'fixture', errors: [], search: null, resolved_range: null, timeline: null,
  });
} };
function OfflineMap(props: AtlasMapProps) {
  return <section aria-label="Offline map placeholder" style={{ height: '100%', background: '#0b131b', padding: '140px 24px' }}>
    <p className="muted">Offline interaction review · historical fixtures · no map tiles or providers</p>
    <button className="text-button" onClick={() => props.onViewportChange({ bounds: [-80, 43, -79, 44], center: [-79.5, 43.5], zoom: 9 })}>Move to another view</button>
  </section>;
}
useWorkspace.getState().setAudience('general_public');
useWorkspace.getState().setViewport({ bounds: [-83.1, 35.3, -82.2, 36], center: [-82.65, 35.65], zoom: 9 });
useWorkspace.getState().openPanel({ view: 'news' });
useWorkspace.getState().openPanel({ view: 'assistant' });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={createQueryClient()}><App api={api} MapComponent={OfflineMap} /></QueryClientProvider>);
