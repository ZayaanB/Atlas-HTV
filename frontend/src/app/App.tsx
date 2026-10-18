import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Article, NewsResponse } from "@atlas/contracts";
import type { AtlasApi } from "../lib/api";
import { isSearchableBounds } from "../lib/api";
import { useWorkspaceData } from "../lib/queries";
import {
  useCatalog,
  useInvestigation,
  readSaved,
  writeSaved,
} from "../lib/features";
import { useFlights } from "../lib/flights";
import { FilterBar } from "../features/feed/FilterBar";
import { NewsFeed } from "../features/feed/NewsFeed";
import { CoverageNotice } from "../features/feed/CoverageNotice";
import { SavedInvestigations } from "../features/feed/SavedInvestigations";
import { useAssistantSession } from "../features/ai/session";
import { AssistantPanel } from "../features/ai/AssistantPanel";
import {
  InvestigationPanel,
  type EvidenceOverlay,
} from "../features/research/InvestigationPanel";
import { Icon } from "../components/Icon";
import { Panel } from "../components/Panel";
import {AudienceOnboarding} from '../components/AudienceOnboarding';
import {AudienceSelect} from '../components/AudienceSelect';
import { dateTime, publication, words } from "../lib/presentation";
import { useWorkspace, type PanelView } from "./state";
import type { AtlasMapProps, MapSelection } from "./map-interface";
const ImportedMap = lazy(() =>
  import("../features/map/AtlasMap").then((module) => ({
    default: module.AtlasMap,
  })),
);
function DefaultMap(props: AtlasMapProps) {
  return (
    <Suspense
      fallback={
        <div className="map-loading" role="status">
          Preparing the globe…
        </div>
      }
    >
      <ImportedMap {...props} />
    </Suspense>
  );
}
const titles: Record<PanelView, string> = {
  search: "Explore",
  news: "News",
  article: "Article",
  assistant: "Ask Atlas",
  investigation: "Investigation",
  saved: "Saved investigations",
  coverage: "Coverage",
  coordinates: "Location",
  aircraft: "Aircraft",
};
export function App({
  api,
  MapComponent = DefaultMap,
}: {
  api: AtlasApi;
  MapComponent?: ComponentType<AtlasMapProps>;
}) {
  const state = useWorkspace(),
    {
      filters,
      selection,
      viewport,
      basemap,
      cameraCommand,
      panel,
      inspectedCoordinates,
    } = state;
  const { news, locations, missingLocationIds } = useWorkspaceData(
      api,
      filters,
    ),
    catalog = useCatalog(api),
    research = useInvestigation(api, state.selectedInvestigationId),
    client = useQueryClient();
  const [layers, setLayers] = useState(false),
    [newsFullscreen, setNewsFullscreen] = useState(false),
    [newsFiltersOpen, setNewsFiltersOpen] = useState(false),
    [saved, setSaved] = useState(readSaved),
    [saveError, setSaveError] = useState(""),
    [overlay, setOverlay] = useState<EvidenceOverlay>(null),
    [flightRegion, setFlightRegion] = useState(""),
    [flightsEnabled, setFlightsEnabled] = useState(false),
    [insets, setInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const layersRef = useRef<HTMLDivElement>(null),
    articles = news.data?.items ?? [],
    places = locations.data ?? [];
  const flights = useFlights(
      api,
      flightRegion,
      flightsEnabled && !!catalog.data?.capabilities.flights,
    ),
    aircraft = flights.aircraft.find((a) => a.id === state.selectedAircraftId);
  const selectedId = panel?.view === "article" ? panel.id : selection.articleId;
  const selected =
    articles.find((a) => a.id === selectedId) ??
    research.data?.articles.find((a) => a.id === selectedId) ??
    client
      .getQueriesData<NewsResponse>({ queryKey: [api.mode, "news"] })
      .flatMap(([, data]) => data?.items ?? [])
      .find((a) => a.id === selectedId);
  const assistant = useAssistantSession(api, articles, research.data);
  const pendingInvestigationFocus = useRef<string | null>(null);
  useEffect(() => {
    if (
      panel?.view === "article" &&
      selected &&
      articles.some((article) => article.id === selected.id) &&
      selection.articleId !== selected.id
    ) {
      const location = places.find((place) =>
        selected.location_ids.includes(place.id),
      );
      state.select({
        articleId: selected.id,
        locationId: location?.id ?? null,
      });
      if (location) state.focusLocation(location);
    }
    if (
      panel?.view === "investigation" &&
      panel.id &&
      panel.id !== state.selectedInvestigationId
    )
      state.selectInvestigation(panel.id);
  }, [
    panel?.view,
    panel?.id,
    selected?.id,
    selection.articleId,
    state.selectedInvestigationId,
    articles,
    places,
    state.select,
    state.focusLocation,
    state.selectInvestigation,
  ]);
  useEffect(() => {
    if (panel?.view !== "investigation")
      pendingInvestigationFocus.current = null;
    if (
      research.data &&
      pendingInvestigationFocus.current === research.data.investigation.id
    ) {
      const location = research.data.locations.find(
        (place) =>
          place.id === research.data!.investigation.primary_location_id,
      );
      if (location) state.focusLocation(location);
      pendingInvestigationFocus.current = null;
    }
  }, [research.data, state.focusLocation, panel?.view]);
  const error = news.error ?? locations.error,
    loading =
      news.isPending ||
      (articles.some((a) => a.location_ids.length > 0) && locations.isPending),
    offset = filters.offset ?? 0,
    limit = filters.limit ?? 50;
  const filterCount = Object.keys(filters).filter(
    (key) => !["offset", "limit"].includes(key),
  ).length;
  const panelOpen = !!panel;
  const fullscreenNews = panel?.view === "news" && newsFullscreen;
  useEffect(() => {
    if (panel?.view !== "news") setNewsFullscreen(false);
  }, [panel?.view]);
  useEffect(() => {
    const update = () => {
      const width = window.innerWidth,
        height = window.innerHeight;
      setInsets(
        panelOpen
          ? width >= 1200
            ? {
                top: 0,
                right: Math.min(380, Math.max(340, width * 0.27)) + 40,
                bottom: 0,
                left: 0,
              }
            : {
                top: 0,
                right: 0,
                bottom: height * (state.sheetExpanded ? 0.82 : panel?.view === "assistant" ? 0.76 : 0.38) + 20,
                left: 0,
              }
          : { top: 0, right: 0, bottom: 0, left: 0 },
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [panelOpen, panel?.view, state.sheetExpanded]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!state.onboardingComplete) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        state.openPanel({ view: "search" }, true);
      }
      if (event.key === "Escape" && layers) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setLayers(false);
        layersRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("keydown", keys, true);
    const outside = (e: PointerEvent) => {
      if (layers && !layersRef.current?.contains(e.target as Node))
        setLayers(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keys, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [layers, state.openPanel, state.onboardingComplete]);
  function select(next: MapSelection) {
    const article = next.articleId
      ? articles.find((a) => a.id === next.articleId)
      : undefined;
    if (next.articleId && !article) return;
    const location = next.locationId
      ? places.find((l) => l.id === next.locationId)
      : undefined;
    if (
      next.locationId &&
      (!location ||
        (article && !article.location_ids.includes(next.locationId)))
    )
      return;
    if (
      next.articleId &&
      state.selectedInvestigationId &&
      !research.data?.investigation.article_ids.includes(next.articleId)
    )
      state.selectInvestigation(null);
    state.select(next);
    if (location) state.focusLocation(location);
    state.openPanel(
      next.articleId
        ? { view: "article", id: next.articleId }
        : { view: "news", id: next.locationId ?? undefined },
    );
  }
  function selectArticle(article: Article) {
    select({
      articleId: article.id,
      locationId:
        places.find((l) => article.location_ids.includes(l.id))?.id ?? null,
    });
  }
  function ask(initial?: string) {
    if (initial !== undefined)
      assistant.populatePrompt({ id: crypto.randomUUID(), text: initial });
    state.openPanel({ view: "assistant" });
  }
  function investigate(id: string) {
    pendingInvestigationFocus.current = id;
    if (research.data?.investigation.id === id) {
      const location = research.data.locations.find(
        (place) =>
          place.id === research.data!.investigation.primary_location_id,
      );
      if (location) state.focusLocation(location);
      pendingInvestigationFocus.current = null;
    }
    state.selectInvestigation(id);
    state.setInvestigationTab("brief");
    setOverlay(null);
    state.openPanel({ view: "investigation", id });
  }
  function toggleSave(id: string) {
    const next = saved.includes(id)
      ? saved.filter((x) => x !== id)
      : [...saved, id];
    if (writeSaved(next)) {
      setSaved(next);
      setSaveError("");
    } else
      setSaveError(
        "Browser storage is unavailable. This change could not be saved.",
      );
  }
  const displayArticles =
    panel?.view === "news" && panel.id
      ? articles.filter((a) => a.location_ids.includes(panel.id!))
      : articles;
  const associated =
    catalog.data?.investigations.filter(
      (inv) => selected && inv.article_ids.includes(selected.id),
    ) ?? [];
  return (<>
    <main
      inert={!state.onboardingComplete}
      className={`atlas-workspace ${panel ? "has-panel" : ""}`}
      aria-label="Atlas geographic news workspace"
    >
      <div
        className="workspace-canvas"
        inert={fullscreenNews || (!!panel && insets.bottom > 0 && state.sheetExpanded)}
      >
        <div className="map-stage">
          <MapComponent
            articles={articles}
            locations={places}
            selection={selection}
            basemap={basemap}
            cameraCommand={cameraCommand}
            overlayInsets={insets}
            evidenceOverlay={overlay}
            aircraft={flights.aircraft}
            selectedAircraftId={state.selectedAircraftId}
            onSelectAircraft={(id) => {
              state.selectAircraft(id);
              state.openPanel({ view: "aircraft", id });
            }}
            status={{
              state: error
                ? "error"
                : loading
                  ? "loading"
                  : articles.length
                    ? "ready"
                    : "empty",
              refreshing: news.isFetching || locations.isFetching,
              error: error?.message ?? null,
              coverage: news.data?.coverage ?? null,
              missingLocationIds,
            }}
            onSelect={select}
            onViewportChange={state.setViewport}
            onInspectCoordinates={(coords) => {
              state.inspectCoordinates(coords);
              state.openPanel({ view: "coordinates" });
            }}
            onCameraCommandHandled={state.acknowledgeCamera}
          />
        </div>
        <header className="identity">
          <span className="brand">ATLAS</span>
          <AudienceSelect />
          {!state.audienceStorageAvailable && <span role="status" className="audience-storage-note">Preference kept for this visit only.</span>}
          {api.mode === 'fixture' && <button
            className="coverage-badge historical"
            onClick={() => state.openPanel({ view: "coverage" })}
          >
            <span className="status-dot" />
            Historical fixture mode · 2024
          </button>}
        </header>
        {news.isError && !panel && (
          <div className="workspace-notice" role="alert">
            {news.error.message}
            <button className="text-button" onClick={() => void news.refetch()}>
              Retry news
            </button>
          </div>
        )}
        <div className="map-controls" ref={layersRef}>
          <div className="map-control-capsule">
            <button
              className="icon-button"
              aria-label="Return to globe"
              title="Return to globe"
              onClick={() => state.requestCamera({ type: "return_to_globe" })}
            >
              <Icon name="globe" />
            </button>
            <button
              className="icon-button"
              aria-label="Map layers"
              aria-expanded={layers}
              onClick={() => setLayers(!layers)}
            >
              <Icon name="layers" />
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => state.requestCamera({ type: "zoom", delta: 1 })}
            >
              <Icon name="plus" />
            </button>
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => state.requestCamera({ type: "zoom", delta: -1 })}
            >
              <Icon name="minus" />
            </button>
          </div>
          {layers && (
            <section className="layers-popover" aria-label="Map layers">
              <h2>Map layers</h2>
              <label htmlFor="basemap">Basemap preference</label>
              <select
                id="basemap"
                value={basemap}
                onChange={(e) =>
                  state.setBasemap(e.target.value as typeof basemap)
                }
              >
                <option value="map">Map</option>
                <option value="satellite">Satellite</option>
                <option value="auto">Auto (satellite on zoom)</option>
              </select>
              <p className="muted">
                Map stays selected as you zoom. Zoom into streets for 3D
                buildings and stylized surface textures where available.
              </p>
              <p className="muted">
                Satellite imagery is geographic context, not dated event
                evidence.
              </p>
              <button
                className="text-button"
                onClick={() => {
                  state.requestCamera({ type: "return_to_globe" });
                  setLayers(false);
                }}
              >
                Return to globe
              </button>
              <h3>News locations</h3>
              <p className="legend">
                <span className="legend-dot" />
                Source-backed address or facility
              </p>
              <p className="legend">
                <span className="legend-area" />
                City or region extent
              </p>
              <details>
                <summary>Locations on this page ({places.length})</summary>
                <ul className="plain-list">
                  {places.map((place) => (
                    <li key={place.id}>
                      <button
                        className="text-button"
                        onClick={() => {
                          select({ articleId: null, locationId: place.id });
                          setLayers(false);
                        }}
                      >
                        {place.name} · {place.precision}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
              <h3>Aircraft</h3>
              {catalog.data?.capabilities.flights &&
              catalog.data.flight_regions.length ? (
                <>
                  <label>
                    Reviewed region
                    <select
                      value={flightRegion}
                      onChange={(e) => {
                        setFlightRegion(e.target.value);
                        state.selectAircraft(null);
                      }}
                    >
                      <option value="">Choose region</option>
                      {catalog.data.flight_regions.map((region) => (
                        <option key={region.id} value={region.id}>
                          {words(region.id)} · {region.radius_nm} nm
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      disabled={!flightRegion}
                      checked={flightsEnabled}
                      onChange={(e) => setFlightsEnabled(e.target.checked)}
                    />
                    Show aircraft
                  </label>
                </>
              ) : (
                <p className="muted">
                  Aircraft coverage is not connected. No flight-provider
                  requests are made.
                </p>
              )}
              {overlay && (
                <p className="notice">
                  Dated evidence: {overlay.evidence.observed_from?.slice(0, 10)}
                </p>
              )}
            </section>
          )}
        </div>
        {viewport &&
          viewport.userInitiated !== false &&
          JSON.stringify(viewport.bounds) !==
            JSON.stringify(filters.bounds) && (
            <div className="area-search">
              <button
                disabled={!isSearchableBounds(viewport.bounds)}
                title={
                  !isSearchableBounds(viewport.bounds)
                    ? "Move to a smaller area with supported bounds."
                    : undefined
                }
                onClick={() => {
                  state.searchArea();
                  state.openPanel({ view: "news" }, true);
                }}
              >
                Search this area
              </button>
            </div>
          )}
        {flightsEnabled && (
          <button
            className="flight-status"
            onClick={() => {
              setLayers(true);
            }}
          >
            {flights.query.isError
              ? "Aircraft unavailable"
              : flights.stale
                ? "Aircraft · stale sample"
                : `Aircraft · ${flights.aircraft.length} received`}{" "}
            {flights.query.data &&
              `· ${Math.max(0, Math.floor((flights.now - Date.parse(flights.query.data.fetched_at)) / 1000))}s ago`}
          </button>
        )}
        <div className="dock-area">
          {filterCount > 0 && (
            <button
              className="active-filters"
              onClick={() => state.openPanel({ view: "search" }, true)}
            >
              <Icon name="filter" size={14} />
              Filters · {filterCount}
            </button>
          )}
          <nav className="dock" aria-label="Workspace">
            <button
              aria-label="Open search"
              aria-pressed={panel?.view === "search"}
              onClick={() =>
                panel?.view === "search"
                  ? state.closePanel()
                  : state.openPanel({ view: "search" }, true)
              }
            >
              <Icon name="search" />
              Search
            </button>
            <button
              aria-label="Open news"
              aria-pressed={panel?.view === "news"}
              onClick={() =>
                panel?.view === "news"
                  ? state.closePanel()
                  : state.openPanel({ view: "news" }, true)
              }
            >
              <Icon name="news" />
              News
            </button>
            <button
              aria-label="Open assistant"
              aria-pressed={panel?.view === 'assistant'}
              onClick={() => panel?.view === 'assistant' ? state.closePanel() : ask()}
            >
              <Icon name="robot" />
              AI
            </button>
          </nav>
        </div>
      </div>
      <Panel
        title={panel ? titles[panel.view] : "Workspace"}
        viewKey={panel ? panel.view + ":" + (panel.id ?? "") : "closed"}
        allowFullscreen={panel?.view === "news"}
        fullscreen={fullscreenNews}
        onFullscreenChange={(next) => {
          setNewsFullscreen(next);
          if (next) setLayers(false);
        }}
      >
        <div hidden={panel?.view !== "search"}>
          <FilterBar
            api={api}
            filters={filters}
            catalog={catalog.data}
            onAsk={() => ask()}
            onApply={(next) => {
              state.applyFilters(next);
              state.openPanel({ view: "news" });
            }}
          />
        </div>
        <section hidden={panel?.view !== "news"} aria-label="News feed">
          <div className="panel-tools">
            <p className="meta" aria-live="polite">
              {news.isPending
                ? "Loading reporting…"
                : `${displayArticles.length} articles on this page`}
            </p>
            <button
              className="news-filter-button"
              aria-expanded={newsFiltersOpen}
              aria-controls="news-filter-panel"
              onClick={() => setNewsFiltersOpen(!newsFiltersOpen)}
            >
              <Icon name="filter" size={16} /> Filters{filterCount ? ` (${filterCount})` : ''}
            </button>
            <button
              className="icon-button"
              aria-label="Saved investigations"
              onClick={() => state.openPanel({ view: "saved" })}
            >
              <Icon name="bookmark" />
            </button>
            <button
              className="icon-button"
              aria-label="Data coverage"
              onClick={() => state.openPanel({ view: "coverage" })}
            >
              <Icon name="info" />
            </button>
          </div>
          <div id="news-filter-panel" className="news-filter-panel" hidden={!newsFiltersOpen}>
            {panel?.view === 'news' && newsFiltersOpen && <FilterBar api={api} filters={filters} catalog={catalog.data} onApply={next => {
              state.applyFilters(next);
              if (panel?.id) state.openPanel({view:'news'},true);
            }} />}
          </div>
          {panel?.view === "news" && panel.id && (
            <p className="notice">
              Coverage linked to{" "}
              {places.find((l) => l.id === panel.id)?.name ?? "this location"}
              <button
                className="text-button"
                onClick={() => state.openPanel({ view: "news" }, true)}
              >
                Show this page
              </button>
            </p>
          )}
          {news.isError && (
            <div role="alert" className="error">
              <p>{news.error.message}</p>
              {news.data && (
                <p>
                  Showing cached results. Refresh failed; freshness is not
                  confirmed.
                </p>
              )}
              <button onClick={() => void news.refetch()}>Retry news</button>
            </div>
          )}
          {news.isFetching && !news.isPending && (
            <p role="status" className="muted">
              Refreshing reporting…
            </p>
          )}
          {news.isPending ? (
            <div className="loading-lines" role="status">
              Loading source-linked reporting…
            </div>
          ) : displayArticles.length === 0 ? (
            <div className="empty-state">
              <h2>No stories here yet.</h2>
              <p>
                No articles returned on this page. Broaden the filters or return
                to the previous page.
              </p>
              <button onClick={() => state.openPanel({ view: "search" })}>
                Adjust filters
              </button>
            </div>
          ) : (
            <NewsFeed
              articles={displayArticles}
              selectedId={selection.articleId}
              onSelect={selectArticle}
            />
          )}
          <nav className="pagination" aria-label="News pagination">
            <button
              disabled={offset === 0 || news.isFetching}
              onClick={() => state.setPage(Math.max(0, offset - limit))}
            >
              Previous page
            </button>
            <span>Page {Math.floor(offset / limit) + 1}</span>
            <button
              disabled={
                !news.data ||
                !articles.length ||
                news.isFetching ||
                offset + limit > 10000
              }
              onClick={() => state.setPage(offset + limit)}
            >
              Next page
            </button>
          </nav>
          <p className="muted">
            Map and feed share this page. More results may exist.
          </p>
        </section>
        {panel?.view === "article" &&
          (selected ? (
            <section aria-label="Selected story">
              <p className="meta">{selected.publisher}</p>
              <h2 className="article-title">{selected.title}</h2>
              <p className="meta">Published {publication(selected)}</p>
              {selected.excerpt && (
                <p className="article-excerpt">{selected.excerpt}</p>
              )}
              <dl className="metadata">
                <dt>Location</dt>
                <dd>
                  {selected.location_ids
                    .map((id) => {
                      const place =
                        places.find((p) => p.id === id) ??
                        research.data?.locations.find((p) => p.id === id);
                      if (!place) return "Location unavailable";
                      // Provider-published points (e.g. GDACS) are shown, but never as reviewed geography.
                      return place.verification_status === "unreviewed"
                        ? `${place.name} (provider-reported, not reviewed)`
                        : place.name;
                    })
                    .join(" · ") || "Not verified"}
                </dd>
                <dt>Precision</dt>
                <dd>{selected.geographic_precision ?? "Not verified"}</dd>
                <dt>Source review</dt>
                <dd>{selected.verification_status}</dd>
              </dl>
              <p className="topics">{selected.themes.map(words).join(" · ")}</p>
              {selected.entity_ids.length > 0 && (
                <p className="muted">
                  {selected.entity_ids
                    .map(
                      (id) =>
                        catalog.data?.entities.find((x) => x.id === id)
                          ?.label ?? words(id.replace(/^ent-/, "")),
                    )
                    .join(" · ")}
                </p>
              )}
              <a
                className="source-link"
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read original article ↗
              </a>
              <details>
                <summary>Provenance</summary>
                <dl className="metadata">
                  <dt>Event time</dt>
                  <dd>
                    {dateTime(selected.event_at)}
                    {selected.event_at &&
                    selected.verification_status === "unreviewed"
                      ? " · provider-reported"
                      : ""}
                  </dd>
                  <dt>Discovered</dt>
                  <dd>{dateTime(selected.discovered_at)}</dd>
                  <dt>Fetched</dt>
                  <dd>{dateTime(selected.fetched_at)}</dd>
                  <dt>Publication basis</dt>
                  <dd>{words(selected.publication_time_basis)}</dd>
                </dl>
              </details>
              <div className="article-actions">
                <button
                  onClick={() =>
                    ask("What do the sources establish about this article?")
                  }
                >
                  Ask about this article <Icon name="spark" size={16} />
                </button>
                {associated.map((inv) => (
                  <button
                    key={inv.id}
                    className="primary"
                    onClick={() => investigate(inv.id)}
                  >
                    Open investigation <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
              {!associated.length && (
                <p className="muted">
                  No curated investigation available
                  {catalog.isError
                    ? " · investigation discovery is not connected."
                    : "."}
                </p>
              )}
              <h3>Related reporting</h3>
              <p className="muted">
                Other articles on this page sharing a location or topic.
              </p>
              <NewsFeed
                articles={articles
                  .filter(
                    (a) =>
                      a.id !== selected.id &&
                      (a.location_ids.some((id) =>
                        selected.location_ids.includes(id),
                      ) ||
                        a.themes.some((t) => selected.themes.includes(t))),
                  )
                  .slice(0, 4)}
                selectedId={null}
                onSelect={selectArticle}
              />
            </section>
          ) : (
            <p className="empty-state">
              This article is no longer available in the current collection.
              <button onClick={() => state.openPanel({ view: "news" }, true)}>
                Browse reporting
              </button>
            </p>
          ))}
        <div className="assistant-view" hidden={panel?.view !== "assistant"}>
          <AssistantPanel
            session={assistant}
            fixture={api.mode === "fixture"}
            connected={!!(api.assistant || api.assistantStream)}
          />
        </div>
        <div hidden={panel?.view !== "investigation"}>
          {research.isPending && state.selectedInvestigationId && (
            <p role="status">Loading investigation…</p>
          )}
          {research.isError && (
            <div role="alert" className="error">
              {research.error.message}
              <button onClick={() => void research.refetch()}>
                Retry investigation
              </button>
            </div>
          )}
          {research.data && (
            <InvestigationPanel
              key={research.data.investigation.id}
              api={api}
              data={research.data}
              saved={saved.includes(research.data.investigation.id)}
              onSave={() => toggleSave(research.data!.investigation.id)}
              onAsk={ask}
              onOverlay={setOverlay}
              onFocus={(bounds) =>
                state.requestCamera({ type: "fit_bounds", bounds })
              }
            />
          )}
        </div>
        <div hidden={panel?.view !== "saved"}>
          <SavedInvestigations
            ids={saved}
            catalog={catalog.data}
            onOpen={investigate}
            onRemove={(id) => toggleSave(id)}
          />
        </div>
        {saveError && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
        <section hidden={panel?.view !== "coverage"}>
          <h2>
            {api.mode === "fixture"
              ? "A historical lens."
              : "Know the coverage."}
          </h2>
          {api.mode === "fixture" && (
            <p className="notice">
              Curated Hurricane Helene examples from 2024. No live API or
              current coverage.
            </p>
          )}
          <CoverageNotice coverage={news.data?.coverage} />
          {!news.data?.coverage && (
            <p>
              Coverage metadata is unavailable. The connection does not
              establish live or complete coverage.
            </p>
          )}
          {catalog.isError && (
            <p className="notice">
              Additional workspace capabilities are unavailable. News and place
              search can still be used.
            </p>
          )}
          <p className="muted">
            {missingLocationIds.length} unresolved location records on this
            page.
          </p>
          {locations.isError && (
            <button onClick={() => void locations.refetch()}>
              Retry locations
            </button>
          )}
          {news.data?.coverage.datasets?.map((dataset) => (
            <section key={dataset.series_id} className="source-row">
              <h3>
                {words(dataset.metric)} · {dataset.unit}
              </h3>
              <p className="muted">
                {dateTime(dataset.coverage_from)} –{" "}
                {dateTime(dataset.coverage_to)}
              </p>
              <p className="muted">
                Retrieved {dateTime(dataset.retrieved_at)} ·{" "}
                {dataset.live ? "Live dataset" : "Historical / stored dataset"}
              </p>
            </section>
          ))}
        </section>
        {panel?.view === "coordinates" && (
          <section>
            <h2>Inspected coordinates</h2>
            <p className="coordinate-readout">
              Longitude {inspectedCoordinates?.[0].toFixed(5)}
              <br />
              Latitude {inspectedCoordinates?.[1].toFixed(5)}
            </p>
            <p className="muted">
              Coordinates alone do not identify a building or establish that a
              reported event occurred here.
            </p>
          </section>
        )}
        {panel?.view === "aircraft" && (
          <section>
            <h2>
              {aircraft?.callsign ?? aircraft?.id ?? "Aircraft unavailable"}
            </h2>
            {aircraft ? (
              <>
                <dl className="metadata">
                  <dt>Identifier</dt>
                  <dd>{aircraft.id}</dd>
                  <dt>Altitude</dt>
                  <dd>
                    {aircraft.altitude === null
                      ? "Unknown"
                      : `${aircraft.altitude.toLocaleString()} ft · barometric`}
                  </dd>
                  <dt>Speed</dt>
                  <dd>
                    {aircraft.speed === null
                      ? "Unknown"
                      : `${aircraft.speed} kn`}
                  </dd>
                  <dt>Heading</dt>
                  <dd>
                    {aircraft.heading === null
                      ? "Unknown"
                      : `${aircraft.heading}°`}
                  </dd>
                  <dt>Position · lon, lat</dt>
                  <dd>{aircraft.coordinates.join(", ")}</dd>
                  <dt>Observed</dt>
                  <dd>{dateTime(aircraft.observed_at)}</dd>
                  <dt>Fetched</dt>
                  <dd>{dateTime(aircraft.fetched_at)}</dd>
                </dl>
                <p className="notice">
                  {flights.stale ? "Stale sample. " : ""}Positions do not
                  establish routes, delays, emergencies, or news impact.
                </p>
                <a
                  href={aircraft.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ADSB.lol · Original source ↗
                </a>
                <p className="muted">{flights.query.data?.attribution}</p>
              </>
            ) : (
              <p>
                This position is missing or expired. The investigation remains
                selected.
              </p>
            )}
          </section>
        )}
      </Panel>
    </main>
    {!state.onboardingComplete && <AudienceOnboarding />}
  </>
  );
}
