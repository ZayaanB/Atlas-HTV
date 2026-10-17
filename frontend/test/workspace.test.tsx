import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import examples from '@atlas/contracts/examples/helene-api.json';
import type { NewsResponse } from '@atlas/contracts';
import { App } from '../src/app/App';
import type { AtlasMapProps } from '../src/app/map-interface';
import { useWorkspace } from '../src/app/state';
import { createHttpApi } from '../src/lib/api';
import type { AtlasApi } from '../src/lib/api';
import { createFixtureApi } from '../src/lib/fixture-api';
import { createQueryClient } from '../src/lib/queries';
import { readContract } from '../src/lib/validation';

let mapProps: AtlasMapProps;
function MapProbe(props: AtlasMapProps) {
  mapProps = props;
  return <div aria-label="Test map">
    <output aria-label="Map article IDs">{props.articles.map(a => a.id).join(',')}</output>
    <button onClick={() => props.onViewportChange({ bounds: [-83, 35, -82, 36], center: [-82.5, 35.5], zoom: 8 })}>Pan map</button>
    <button onClick={() => props.onSelect({ articleId: props.articles[0]?.id ?? null, locationId: null })}>Select map article</button>
  </div>;
}
function mount(api: AtlasApi, preview = false) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  const result = render(<QueryClientProvider client={client}>{preview ? <App api={api} /> : <App api={api} MapComponent={MapProbe} />}</QueryClientProvider>);
  return { ...result, client };
}
beforeEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true));

it('keeps current-page map/feed IDs together through pagination, empty pages, and filters', async () => {
  const user = userEvent.setup();
  useWorkspace.getState().applyFilters({ limit: 2 });
  mount(createFixtureApi());
  await waitFor(() => expect(mapProps.locations.length).toBeGreaterThan(0));
  expect(screen.getByLabelText('Map article IDs')).toHaveTextContent(examples.news.items.slice(0, 2).map(a => a.id).join(','));
  expect(within(screen.getByRole('region', { name: 'News feed' })).getAllByRole('link', { name: /Read original source/ })).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(screen.getByLabelText('Map article IDs')).toHaveTextContent(examples.news.items.slice(2, 4).map(a => a.id).join(',')));
  await user.type(screen.getByRole('textbox', { name: 'Search reporting' }), 'zz-no-match');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText(/No articles returned on this page/);
  expect(screen.getByLabelText('Map article IDs')).toBeEmptyDOMElement();
  expect(useWorkspace.getState().filters.offset).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Remove keyword filter' }));
  await waitFor(() => expect(mapProps.articles).toHaveLength(2));
  act(() => useWorkspace.getState().setPage(50));
  await screen.findByText(/No articles returned on this page/);
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
});

it('does not fetch on panning and applies bounds only after Search this area', async () => {
  const user = userEvent.setup(), api = createFixtureApi();
  const spy = vi.spyOn(api, 'news');
  mount(api);
  await waitFor(() => expect(mapProps.articles).toHaveLength(10));
  const calls = spy.mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Pan map' }));
  expect(spy).toHaveBeenCalledTimes(calls);
  expect(useWorkspace.getState().filters.bounds).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'Search this area' }));
  await waitFor(() => expect(spy.mock.lastCall?.[0].bounds).toEqual([-83, 35, -82, 36]));
  await user.click(screen.getByRole('button', { name: 'Return to globe' }));
  expect(useWorkspace.getState().filters.bounds).toEqual([-83, 35, -82, 36]);
});

it('shares selection with map events and emits sourced camera commands from feed selection', async () => {
  const user = userEvent.setup();
  mount(createFixtureApi());
  await waitFor(() => expect(mapProps.locations.length).toBeGreaterThan(0));
  await user.click(screen.getByRole('button', { name: 'Select map article' }));
  expect(screen.getByRole('complementary', { name: 'Selected story' })).toHaveTextContent(examples.news.items[0]!.title);
  const article = mapProps.articles.find(a => a.location_ids.some(id => mapProps.locations.some(l => l.id === id && l.bounds)))!;
  await user.click(screen.getByRole('button', { name: article.title }));
  expect(mapProps.selection.articleId).toBe(article.id);
  const location = mapProps.locations.find(l => l.id === mapProps.selection.locationId)!;
  expect(mapProps.cameraCommand).toMatchObject(location.bounds ? { type: 'fit_bounds', bounds: location.bounds } : { type: 'focus_point', coordinates: location.coordinates });
  act(() => mapProps.onSelect({ articleId: 'unknown-record', locationId: null }));
  expect(useWorkspace.getState().selection.articleId).toBe(article.id);
});

it('discards old results when an adapter ignores cancellation', async () => {
  let resolveOld!: (response: NewsResponse) => void;
  const fixture = createFixtureApi();
  const response = readContract('NewsResponse', examples.news);
  const api: AtlasApi = { ...fixture, news: vi.fn(async query => query.keyword
    ? { ...response, items: response.items.slice(1, 2) }
    : new Promise<NewsResponse>(resolve => { resolveOld = resolve; })) };
  mount(api);
  await waitFor(() => expect(resolveOld).toBeDefined());
  act(() => useWorkspace.getState().applyFilters({ keyword: 'new-context' }));
  await waitFor(() => expect(mapProps.articles[0]?.id).toBe(response.items[1]!.id));
  await act(async () => resolveOld({ ...response, items: response.items.slice(0, 1) }));
  expect(mapProps.articles[0]?.id).toBe(response.items[1]!.id);
});

it('shows API failures without changing to historical examples', async () => {
  mount(createHttpApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: {
    code: 'CONTRACTS_UNAVAILABLE', message: 'Shared response contract is missing', retryable: true, request_id: 'req-test'
  } }), { status: 503 }))));
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Shared response contract is missing');
  expect(screen.queryByText(/Historical fixture mode/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry news' })).toBeEnabled();
});

it('labels the fixture preview and acknowledges its camera command', async () => {
  const user = userEvent.setup();
  mount(createFixtureApi(), true);
  expect(screen.getByText(/Historical fixture mode/)).toBeInTheDocument();
  await screen.findByRole('button', { name: /Preview search area: Asheville/ });
  await user.click(screen.getByRole('button', { name: 'Return to globe' }));
  await screen.findByText('Camera preview: return to globe.');
  expect(useWorkspace.getState().cameraCommand).toBeNull();
});
