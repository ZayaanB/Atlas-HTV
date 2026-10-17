import { lazy, Suspense, type ComponentType } from 'react';
import type { Article } from '@atlas/contracts';
import type { AtlasApi } from '../lib/api';
import { isSearchableBounds } from '../lib/api';
import { useWorkspaceData } from '../lib/queries';
import { FilterBar } from '../features/feed/FilterBar';
import { NewsFeed } from '../features/feed/NewsFeed';
import { CoverageNotice } from '../features/feed/CoverageNotice';
import { useWorkspace } from './state';
import type { AtlasMapProps, MapSelection } from './map-interface';

const ImportedAtlasMap = lazy(() => import('../features/map/AtlasMap').then(module => ({ default: module.AtlasMap })));

function DefaultAtlasMap(props: AtlasMapProps) {
  return <Suspense fallback={<div className="map-preview" role="status">Loading the interactive map...</div>}>
    <ImportedAtlasMap {...props} />
  </Suspense>;
}

/** AtlasMap is the default renderer; MapComponent remains injectable for isolated previews. */
export function App({ api, MapComponent = DefaultAtlasMap }: { api: AtlasApi; MapComponent?: ComponentType<AtlasMapProps> }) {
  const filters = useWorkspace(s => s.filters);
  const selection = useWorkspace(s => s.selection);
  const viewport = useWorkspace(s => s.viewport);
  const inspected = useWorkspace(s => s.inspectedCoordinates);
  const basemap = useWorkspace(s => s.basemap);
  const cameraCommand = useWorkspace(s => s.cameraCommand);
  const applyFilters = useWorkspace(s => s.applyFilters);
  const acknowledgeCamera = useWorkspace(s => s.acknowledgeCamera);
  const setViewport = useWorkspace(s => s.setViewport);
  const inspectCoordinates = useWorkspace(s => s.inspectCoordinates);
  const { news, locations, missingLocationIds } = useWorkspaceData(api, filters);
  const articles = news.data?.items ?? [];
  const places = locations.data ?? [];
  const offset = filters.offset ?? 0, limit = filters.limit ?? 50;
  const selected = articles.find(a => a.id === selection.articleId);
  function select(next: MapSelection) {
    const article = next.articleId ? articles.find(a => a.id === next.articleId) : undefined;
    if (next.articleId && !article) return;
    const location = next.locationId ? places.find(l => l.id === next.locationId) : undefined;
    if (next.locationId && (!location || (article && !article.location_ids.includes(next.locationId)))) return;
    useWorkspace.getState().select(next);
    if (location) useWorkspace.getState().focusLocation(location);
  }
  function selectArticle(article: Article) {
    const location = places.find(l => article.location_ids.includes(l.id));
    select({ articleId: article.id, locationId: location?.id ?? null });
  }
  const error = news.error ?? locations.error;
  const loading = news.isPending || (articles.some(a => a.location_ids.length > 0) && locations.isPending);
  return <>
    <header className="masthead"><div><span className="brand">ATLAS</span><span className="tagline">Reporting, placed in context.</span></div>
      <span className="edition">News & evidence workspace</span></header>
    {api.mode === 'fixture' && <div className="fixture-banner" role="status">Historical fixture mode · Curated Hurricane Helene examples from 2024. No live API or current coverage.</div>}
    <main className="workspace">
      <section className="feed-panel" aria-label="News feed">
        <span className="eyebrow">Explore the evidence</span><h1>Follow the story.</h1>
        <FilterBar api={api} filters={filters} onApply={applyFilters} />
        <div className="feed-summary" aria-live="polite">{news.isPending ? 'Loading reporting…' : `${articles.length} articles on this page`}</div>
        <p className="muted">Map locations and feed share the current page. More results may exist; no matching total is supplied.</p>
        {news.isError && <div role="alert" className="error"><p>{news.error.message}</p>
          {news.data && <p>Showing cached results. Refresh failed; freshness is not confirmed.</p>}
          <button onClick={() => void news.refetch()}>Retry news</button></div>}
        {news.isSuccess && articles.length === 0 && <p role="status">No articles returned on this page. Broaden the filters or return to the previous page.</p>}
        {news.isFetching && !news.isPending && <p role="status">Refreshing reporting…</p>}
        <NewsFeed articles={articles} selectedId={selection.articleId} onSelect={selectArticle} />
        <nav className="pagination" aria-label="News pagination">
          <button disabled={offset === 0 || news.isFetching} onClick={() => useWorkspace.getState().setPage(Math.max(0, offset - limit))}>Previous page</button>
          <span>Page {Math.floor(offset / limit) + 1}</span>
          <button disabled={!news.data || articles.length === 0 || news.isFetching || offset + limit > 10000} onClick={() => useWorkspace.getState().setPage(offset + limit)}>Next page</button>
        </nav>
        <CoverageNotice coverage={news.data?.coverage} />
      </section>
      <section className="context-panel" aria-label="Geographic workspace">
        <div className="map-toolbar">
          <button disabled={!viewport || !isSearchableBounds(viewport.bounds)} onClick={() => useWorkspace.getState().searchArea()}>Search this area</button>
          <button className="secondary" onClick={() => useWorkspace.getState().requestCamera({ type: 'return_to_globe' })}>Return to globe</button>
          <label>Basemap preference <select value={basemap} onChange={event => useWorkspace.getState().setBasemap(event.target.value as 'auto' | 'map' | 'satellite')}>
            <option value="auto">Auto</option><option value="map">Map</option><option value="satellite">Satellite</option>
          </select></label>
        </div>
        <p className="muted">{viewport && !isSearchableBounds(viewport.bounds) ? 'This viewport crosses the antimeridian or exceeds supported bounds. Move to a smaller area to search.' : 'Moving the map preserves results. Use Search this area to apply its bounds.'}</p>
        <MapComponent articles={articles} locations={places} selection={selection} basemap={basemap} cameraCommand={cameraCommand}
          status={{ state: error ? 'error' : loading ? 'loading' : articles.length ? 'ready' : 'empty', refreshing: news.isFetching || locations.isFetching,
            error: error?.message ?? null, coverage: news.data?.coverage ?? null, missingLocationIds }}
          onSelect={select} onViewportChange={setViewport} onInspectCoordinates={inspectCoordinates} onCameraCommandHandled={acknowledgeCamera} />
        {locations.isError && <button onClick={() => void locations.refetch()}>Retry locations</button>}
        {inspected && <p className="coordinate-readout">Longitude {inspected[0]}, latitude {inspected[1]}. Coordinates alone do not identify a building.</p>}
        {selected && <aside className="selection-context" aria-label="Selected story"><span className="eyebrow">Selected story</span><h2>{selected.title}</h2>
          <p>A deeper investigation is not available in this foundation. Read the original reporting for context.</p>
          <a href={selected.url} target="_blank" rel="noopener noreferrer">Open original source ↗</a>
        </aside>}
      </section>
    </main>
  </>;
}
