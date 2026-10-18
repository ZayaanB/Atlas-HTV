import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import examples from '@atlas/contracts/examples/helene-api.json';
import type { Article, AssistantRequestV3, AssistantResponseV3 } from '@atlas/contracts';
import { useAssistantSession } from '../src/features/ai/session';
import { AssistantPanel } from '../src/features/ai/AssistantPanel';
import { captureWorkspace } from '../src/features/ai/context';
import { useWorkspace } from '../src/app/state';
import { createFixtureApi } from '../src/lib/fixture-api';
import { createHttpApi, type AtlasApi } from '../src/lib/api';
import { createQueryClient } from '../src/lib/queries';
import { readContract } from '../src/lib/validation';
import { App } from '../src/app/App';

const article = readContract('Article', examples.news.items[0]);
const second = readContract('Article', examples.news.items[1]);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { resolve, promise }; }
function response(request: AssistantRequestV3, changes: Record<string, unknown> = {}): AssistantResponseV3 {
  return readContract('AssistantResponseV3', {
    protocol_version: 3, request_id: request.request_id, conversation_id: 'conversation-test', kind: 'answer',
    answer: 'The captured records support this answer.', citations: [], result_ids: [], actions: [], coverage: examples.news.coverage,
    mode: 'fixture', errors: [], search: null, resolved_range: null, timeline: null,
    context: request.workspace, research_scope: {}, references: [], pending: null, ...changes,
  });
}
function Harness({ api, articles }: { api: AtlasApi; articles: Article[] }) {
  const session = useAssistantSession(api, articles);
  return <AssistantPanel session={session} fixture={false} connected />;
}
function mount(api: AtlasApi, app = false) {
  const client = createQueryClient(); client.setDefaultOptions({ queries: { retry: false } });
  return { client, ...render(<QueryClientProvider client={client}>{app
    ? <App api={api} MapComponent={() => <div aria-label="Offline map" />} />
    : <Harness api={api} articles={[second, article]} />}</QueryClientProvider>) };
}
function send(message = 'What is happening here?') {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
}
beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true);
  useWorkspace.getState().setViewport({ bounds: [-80, 43, -79, 44], center: [-79.5, 43.5], zoom: 9 });
  useWorkspace.getState().openPanel({ view: 'news' });
  useWorkspace.getState().openPanel({ view: 'assistant' });
});
it('posts v3 with the visible map, actual filters, original panel and ordered displayed records', async () => {
  useWorkspace.getState().applyFilters({ themes: ['flooding'], keyword: 'water' });
  useWorkspace.getState().select({ articleId: article.id, locationId: article.location_ids[0]! });
  const requests: AssistantRequestV3[] = [];
  mount({ ...createFixtureApi(2), assistantV3: async request => { requests.push(readContract('AssistantRequestV3', request)); return response(request); } });
  send(); await screen.findByText('The captured records support this answer.');
  expect(requests[0]).toMatchObject({ protocol_version: 3, workspace: {
    viewport: { center: [-79.5, 43.5], zoom: 9 }, filters: { themes: ['flooding'], keyword: 'water' },
    selection: { article_id: article.id }, origin: { view: 'news' }, visible_article_ids: [second.id, article.id],
  } });
  expect(requests[0]).not.toHaveProperty('selected_bounds');
});
it('keeps an answer after panning and closing chat, then revalidates explicitly applied stale actions', async () => {
  const pending = deferred<AssistantResponseV3>(); let request!: AssistantRequestV3, signal!: AbortSignal;
  mount({ ...createFixtureApi(2), assistantV3: async (value, activeSignal) => { request = value; signal = activeSignal; return pending.promise; } });
  send('Show me this area');
  act(() => {
    useWorkspace.getState().setViewport({ bounds: [10, 40, 11, 41], center: [10.5, 40.5], zoom: 10 });
    useWorkspace.getState().closePanel();
  });
  expect(signal.aborted).toBe(false);
  await act(async () => pending.resolve(response(request, { actions: [{ type: 'set_basemap', basemap: 'satellite' }] })));
  expect(await screen.findByText('The captured records support this answer.')).toBeVisible();
  expect(screen.getByText(/Answer for Map near 43.5, -79.5/)).toBeVisible();
  expect(useWorkspace.getState().basemap).toBe('map');
  fireEvent.click(screen.getByRole('button', { name: 'Apply these workspace changes' }));
  await waitFor(() => expect(useWorkspace.getState().basemap).toBe('satellite'));
  expect(screen.getByText('Workspace updated.')).toBeVisible();
});
it('retains the answer when a late target lookup becomes stale', async () => {
  const target = deferred<Article>();
  const lookup = vi.fn(async () => target.promise);
  mount({ ...createFixtureApi(2), article: lookup, assistantV3: async request => response(request, {
    actions: [{ type: 'open_record', record_type: 'article', id: 'not-on-page' }],
  }) });
  send('Show that story');
  await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  act(() => useWorkspace.getState().applyFilters({ keyword: 'new topic' }));
  await act(async () => target.resolve({ ...article, id: 'not-on-page' }));
  expect(await screen.findByText('The captured records support this answer.')).toBeVisible();
  expect(useWorkspace.getState().panel?.view).toBe('assistant');
});
it('applies layer/basemap actions atomically and restores the preceding workspace with Undo', async () => {
  const previous = structuredClone(useWorkspace.getState().filters);
  mount({ ...createFixtureApi(2), wind: async () => { throw new Error('No provider call expected'); },
    assistantV3: async request => response(request, { actions: [{ type: 'set_basemap', basemap: 'satellite' }, { type: 'set_layers', wind: true }] }) });
  send('Use satellite and show wind');
  await screen.findByText('Workspace updated.');
  expect(useWorkspace.getState()).toMatchObject({ basemap: 'satellite', windEnabled: true, filters: previous });
  fireEvent.click(screen.getByRole('button', { name: 'Undo workspace change' }));
  expect(useWorkspace.getState()).toMatchObject({ basemap: 'map', windEnabled: false, filters: previous });
});
it('keeps a useful answer when an action target fails and applies no part of the batch', async () => {
  mount({ ...createFixtureApi(2), assistantV3: async request => response(request, { actions: [
    { type: 'set_basemap', basemap: 'satellite' }, { type: 'open_record', record_type: 'article', id: 'missing-record' },
  ] }) });
  send('Show that story on satellite');
  await screen.findByText('The captured records support this answer.');
  expect(screen.getByText(/Your answer is still available/)).toBeVisible();
  expect(useWorkspace.getState().basemap).toBe('map');
});
it('a new reporting scope clears the previous story selection through the shared action path', async () => {
  useWorkspace.getState().select({ articleId: article.id, locationId: article.location_ids[0]! });
  mount({ ...createFixtureApi(2), assistantV3: async request => response(request, { actions: [{ type: 'set_filters', filters: { keyword: 'new topic' } }] }) });
  send('Show me a new topic');
  await screen.findByText('Workspace updated.');
  expect(useWorkspace.getState().selection).toEqual({ articleId: null, locationId: null });
  expect(useWorkspace.getState().filters.keyword).toBe('new topic');
});
it('a clarification choice sends the short reply with the same conversation identity', async () => {
  const requests: AssistantRequestV3[] = [];
  mount({ ...createFixtureApi(2), assistantV3: async request => {
    requests.push(request);
    return requests.length === 1 ? response(request, { kind: 'clarification', answer: 'Toronto, Ontario or Toronto, Ohio?', pending: {
      id: 'pending-place', question: 'Toronto, Ontario or Toronto, Ohio?', choices: ['Ontario', 'Ohio'], actions: [],
    } }) : response(request, { answer: 'Continuing for Toronto, Ontario.' });
  } });
  send('Show me Toronto');
  fireEvent.click(await screen.findByRole('button', { name: 'Ontario' }));
  await screen.findByText('Continuing for Toronto, Ontario.');
  expect(requests[1]).toMatchObject({ message: 'Ontario', conversation_id: 'conversation-test' });
  expect(requests[1]!.history).toHaveLength(2);
});
it('opens a discussed article outside the current feed, preserves filters and returns to the conversation', async () => {
  const fixture = createFixtureApi(2);
  useWorkspace.getState().applyFilters({ keyword: 'a-filter-with-no-matches' });
  mount({ ...fixture, assistantV3: async request => response(request, { references: [{ record_type: 'article', id: article.id, label: article.title }] }) }, true);
  send('Find an article');
  fireEvent.click(await screen.findByRole('button', { name: `Open ${article.title}` }));
  await waitFor(() => expect(useWorkspace.getState().panel).toEqual({ view: 'article', id: article.id }));
  expect(await screen.findByRole('heading', { name: article.title })).toBeVisible();
  expect(useWorkspace.getState().filters.keyword).toBe('a-filter-with-no-matches');
  fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
  expect(screen.getByText('The captured records support this answer.')).toBeVisible();
});
it('Stop and New conversation cancel v3 generation and clear continuation identity', async () => {
  const requests: AssistantRequestV3[] = [], signals: AbortSignal[] = [];
  mount({ ...createFixtureApi(2), assistantV3: async (request, signal) => {
    requests.push(request); signals.push(signal);
    if (requests.length === 2) return new Promise<AssistantResponseV3>(() => {});
    return response(request);
  } });
  send(); await screen.findByText('The captured records support this answer.');
  send('Continue'); await waitFor(() => expect(requests).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  expect(signals[1]!.aborted).toBe(true);
  send('A fresh question'); await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]).not.toHaveProperty('conversation_id'); expect(requests[2]!.history).toEqual([]);
});
it('v3 SSE handles split UTF-8 and accepts only a validated v3 terminal response without downgrading', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const request = readContract('AssistantRequestV3', JSON.parse(String(init!.body)));
    const bytes = new TextEncoder().encode([
      { type: 'answer_delta', request_id: request.request_id, text: 'A globe 🌍' },
      { type: 'complete', request_id: request.request_id, response: response(request, { answer: 'A globe 🌍' }) },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  mount(createHttpApi(fetcher)); send();
  expect(await screen.findByText('A globe 🌍')).toBeVisible(); expect(fetcher).toHaveBeenCalledOnce();
});
it('captures manual timeline ranges and wraparound map bounds without converting calendar meaning', () => {
  useWorkspace.getState().selectInvestigation('investigation-test');
  useWorkspace.getState().setActiveTimeline({ investigation_id: 'investigation-test', series_id: 'series-test', observed_from: '2026-03-08T05:00:00.000Z', observed_to: '2026-03-09T03:59:59.999Z' });
  useWorkspace.getState().setViewport({ bounds: [170, -10, 190, 10], center: [180, 0], zoom: -0.5 });
  const context = captureWorkspace(useWorkspace.getState(), [article]);
  expect(context.timeline?.observed_to).toBe('2026-03-09T03:59:59.999Z');
  expect(context.viewport?.bounds).toEqual([170, -10, -170, 10]);
  expect(context.viewport?.zoom).toBe(-0.5);
});
