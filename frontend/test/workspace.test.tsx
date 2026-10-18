import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import examples from "@atlas/contracts/examples/helene-api.json";
import type { NewsResponse } from "@atlas/contracts";
import { App } from "../src/app/App";
import type { AtlasMapProps } from "../src/app/map-interface";
import { useWorkspace } from "../src/app/state";
import { createHttpApi } from "../src/lib/api";
import type { AtlasApi } from "../src/lib/api";
import { createFixtureApi } from "../src/lib/fixture-api";
import { createQueryClient } from "../src/lib/queries";
import { readContract } from "../src/lib/validation";

let mapProps: AtlasMapProps;
function MapProbe(props: AtlasMapProps) {
  mapProps = props;
  return (
    <div aria-label="Test map">
      <output aria-label="Map article IDs">
        {props.articles.map((a) => a.id).join(",")}
      </output>
      <button
        onClick={() =>
          props.onViewportChange({
            bounds: [-83, 35, -82, 36],
            center: [-82.5, 35.5],
            zoom: 8,
          })
        }
      >
        Pan map
      </button>
      <button
        onClick={() =>
          props.onSelect({
            articleId: props.articles[0]?.id ?? null,
            locationId: null,
          })
        }
      >
        Select map article
      </button>
      <button
        onClick={() =>
          props.cameraCommand &&
          props.onCameraCommandHandled(props.cameraCommand.id)
        }
      >
        Acknowledge camera command
      </button>
    </div>
  );
}
function mount(api: AtlasApi) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  const result = render(
    <QueryClientProvider client={client}>
      <App api={api} MapComponent={MapProbe} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}
beforeEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true));

it('opens the assistant directly from the AI dock button without losing drafts or filters',async()=>{
  const user=userEvent.setup(), fixture=createFixtureApi();
  const assistant=vi.spyOn(fixture,'assistant');
  useWorkspace.getState().applyFilters({themes:['flooding']});
  // Injected fixture responses exercise the API-mode shell without live providers.
  mount({...fixture,mode:'api'});
  expect(screen.queryByText('Stored reporting')).not.toBeInTheDocument();
  const dock=within(screen.getByRole('navigation',{name:'Workspace'}));
  expect(dock.getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(['Open search','Open news','Open assistant']);
  const before=useWorkspace.getState().filters;
  await user.click(dock.getByRole('button',{name:'Open assistant'}));
  expect(dock.getByRole('button',{name:'Open assistant'})).toHaveAttribute('aria-pressed','true');
  expect(dock.getByRole('button',{name:'Open search'})).toHaveAttribute('aria-pressed','false');
  await user.type(screen.getByLabelText('Your question'),'Keep my question');
  await user.click(dock.getByRole('button',{name:'Open assistant'}));
  expect(useWorkspace.getState().panel).toBeNull();
  await user.click(dock.getByRole('button',{name:'Open assistant'}));
  expect(screen.getByLabelText('Your question')).toHaveValue('Keep my question');
  expect(useWorkspace.getState().filters).toEqual(before);
  expect(assistant).not.toHaveBeenCalled();
});

it("keeps current-page map/feed IDs together through pagination, empty pages, and filters", async () => {
  const user = userEvent.setup();
  useWorkspace.getState().applyFilters({ limit: 2 });
  mount(createFixtureApi());
  await waitFor(() => expect(mapProps.locations.length).toBeGreaterThan(0));
  expect(screen.getByLabelText("Map article IDs")).toHaveTextContent(
    examples.news.items
      .slice(0, 2)
      .map((a) => a.id)
      .join(","),
  );
  await user.click(screen.getByRole("button", { name: "Open news" }));
  expect(
    within(screen.getByRole("region", { name: "News feed" })).getAllByRole(
      "heading",
      { level: 3 },
    ),
  ).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Map article IDs")).toHaveTextContent(
      examples.news.items
        .slice(2, 4)
        .map((a) => a.id)
        .join(","),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await user.type(
    screen.getByRole("textbox", { name: "Search reporting" }),
    "zz-no-match",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(/No articles returned on this page/);
  expect(screen.getByLabelText("Map article IDs")).toBeEmptyDOMElement();
  expect(useWorkspace.getState().filters.offset).toBe(0);
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await user.click(
    screen.getByRole("button", { name: "Remove keyword filter" }),
  );
  await waitFor(() => expect(mapProps.articles).toHaveLength(2));
  act(() => useWorkspace.getState().setPage(50));
  await screen.findByText(/No articles returned on this page/);
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
});

it("does not fetch on panning and applies bounds only after Search this area", async () => {
  const user = userEvent.setup(),
    api = createFixtureApi();
  const spy = vi.spyOn(api, "news");
  mount(api);
  await waitFor(() => expect(mapProps.articles).toHaveLength(10));
  const calls = spy.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Pan map" }));
  expect(spy).toHaveBeenCalledTimes(calls);
  expect(useWorkspace.getState().filters.bounds).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "Search this area" }));
  await waitFor(() =>
    expect(spy.mock.lastCall?.[0].bounds).toEqual([-83, 35, -82, 36]),
  );
  await user.click(screen.getByRole("button", { name: "Return to globe" }));
  expect(useWorkspace.getState().filters.bounds).toEqual([-83, 35, -82, 36]);
});

it("shares selection with map events and emits sourced camera commands from feed selection", async () => {
  const user = userEvent.setup();
  mount(createFixtureApi());
  await waitFor(() => expect(mapProps.locations.length).toBeGreaterThan(0));
  await user.click(screen.getByRole("button", { name: "Select map article" }));
  expect(
    screen.getByRole("region", { name: "Selected story" }),
  ).toHaveTextContent(examples.news.items[0]!.title);
  await user.click(screen.getByRole("button", { name: "Open news" }));
  const article = mapProps.articles.find((a) =>
    a.location_ids.some((id) =>
      mapProps.locations.some((l) => l.id === id && l.bounds),
    ),
  )!;
  await user.click(screen.getByRole("button", { name: article.title }));
  await user.click(screen.getByRole("button", { name: "Open article" }));
  expect(mapProps.selection.articleId).toBe(article.id);
  const location = mapProps.locations.find(
    (l) => l.id === mapProps.selection.locationId,
  )!;
  expect(mapProps.cameraCommand).toMatchObject(
    location.bounds
      ? { type: "fit_bounds", bounds: location.bounds }
      : { type: "focus_point", coordinates: location.coordinates },
  );
  act(() =>
    mapProps.onSelect({ articleId: "unknown-record", locationId: null }),
  );
  expect(useWorkspace.getState().selection.articleId).toBe(article.id);
});

it("opens news fullscreen, restores it with Escape, and resets fullscreen after closing", async () => {
  const user = userEvent.setup();
  mount(createFixtureApi());
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(screen.getByRole("button", { name: "Fullscreen news" }));
  expect(screen.getByRole("dialog", { name: "News" })).toHaveClass("is-fullscreen");
  expect(screen.getByRole("dialog", { name: "News" })).toHaveAttribute("aria-modal", "true");
  expect(screen.getByLabelText("Test map").closest(".workspace-canvas")).toHaveAttribute("inert");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("complementary", { name: "News" })).not.toHaveClass("is-fullscreen");
  expect(screen.getByLabelText("Test map").closest(".workspace-canvas")).not.toHaveAttribute("inert");
  await user.click(screen.getByRole("button", { name: "Fullscreen news" }));
  await user.click(screen.getByRole("button", { name: "Close panel" }));
  await user.click(screen.getByRole("button", { name: "Open news" }));
  expect(screen.getByRole("complementary", { name: "News" })).not.toHaveClass("is-fullscreen");
});

it("shares event/topic filters between News and Search and resets pagination for new constraints", async () => {
  const user = userEvent.setup(), api = createFixtureApi();
  const spy = vi.spyOn(api, 'news');
  useWorkspace.getState().applyFilters({limit:2});
  mount(api);
  await waitFor(() => expect(mapProps.articles).toHaveLength(2));
  await user.click(screen.getByRole('button',{name:'Open news'}));
  await user.click(screen.getByRole('button',{name:'Next page'}));
  await waitFor(() => expect(useWorkspace.getState().filters.offset).toBe(2));
  await user.click(screen.getByRole('button',{name:'Filters'}));
  await user.click(screen.getByRole('checkbox',{name:'Floods'}));
  await user.click(screen.getByRole('checkbox',{name:'Health'}));
  await user.click(screen.getByRole('button',{name:'Apply filters'}));
  await waitFor(() => expect(spy.mock.lastCall?.[0]).toMatchObject({event_types:['flood'],topics:['health'],offset:0}));
  await waitFor(() => expect(mapProps.articles.length).toBeGreaterThan(0));
  expect(mapProps.articles.every(a => a.themes.includes('drinking-water'))).toBe(true);
  await user.click(screen.getByRole('button',{name:'Open search'}));
  expect(screen.getByRole('checkbox',{name:'Floods'})).toBeChecked();
  expect(screen.getByRole('checkbox',{name:'Health'})).toBeChecked();
  await user.click(screen.getByRole('button',{name:'Remove topics filter'}));
  await waitFor(() => expect(useWorkspace.getState().filters.topics).toBeUndefined());
  expect(useWorkspace.getState().filters.event_types).toEqual(['flood']);
  await user.click(screen.getByRole('button',{name:'Clear filters'}));
  await waitFor(() => expect(useWorkspace.getState().filters).toEqual({limit:2,offset:0}));
});

it("applies publication presets, provenance and location availability from Search",async()=>{
  const user = userEvent.setup();
  mount(createFixtureApi());
  await user.click(screen.getByRole('button',{name:'Open search'}));
  await user.click(screen.getByText('Refine reporting'));
  await user.selectOptions(screen.getByRole('combobox',{name:'Quick period'}),'7');
  expect(screen.getByRole('combobox',{name:'Quick period'})).toHaveValue('7');
  await user.selectOptions(screen.getByRole('combobox',{name:'Review status'}),'unreviewed');
  await user.selectOptions(screen.getByRole('combobox',{name:'Location availability'}),'false');
  await user.selectOptions(screen.getByRole('combobox',{name:'Stories per page'}),'20');
  await user.click(screen.getByRole('button',{name:'Apply filters'}));
  expect(useWorkspace.getState().filters).toMatchObject({verification_status:'unreviewed',has_location:false,limit:20,offset:0});
  const {published_from:from,published_to:to} = useWorkspace.getState().filters;
  expect(from).toMatch(/T00:00:00.000Z$/);
  expect(to).toMatch(/T23:59:59.999Z$/);
  expect(Date.parse(to!) - Date.parse(from!)).toBe(7*86400000-1);
  await screen.findByText(/No articles returned on this page/);
});

it("discards old results when an adapter ignores cancellation", async () => {
  let resolveOld!: (response: NewsResponse) => void;
  const fixture = createFixtureApi();
  const response = readContract("NewsResponse", examples.news);
  const api: AtlasApi = {
    ...fixture,
    news: vi.fn(async (query) =>
      query.keyword
        ? { ...response, items: response.items.slice(1, 2) }
        : new Promise<NewsResponse>((resolve) => {
            resolveOld = resolve;
          }),
    ),
  };
  mount(api);
  await waitFor(() => expect(resolveOld).toBeDefined());
  act(() => useWorkspace.getState().applyFilters({ keyword: "new-context" }));
  await waitFor(() =>
    expect(mapProps.articles[0]?.id).toBe(response.items[1]!.id),
  );
  await act(async () =>
    resolveOld({ ...response, items: response.items.slice(0, 1) }),
  );
  expect(mapProps.articles[0]?.id).toBe(response.items[1]!.id);
});

it("shows API failures without changing to historical examples", async () => {
  mount(
    createHttpApi(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "CONTRACTS_UNAVAILABLE",
              message: "Shared response contract is missing",
              retryable: true,
              request_id: "req-test",
            },
          }),
          { status: 503 },
        ),
      ),
    ),
  );
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
    "Shared response contract is missing",
  );
  expect(screen.queryByText(/Historical fixture mode/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry news" })).toBeEnabled();
});

it("labels historical mode and acknowledges only the current map command through the integration interface", async () => {
  const user = userEvent.setup();
  mount(createFixtureApi());
  expect(
    screen.getByRole("button", { name: /Historical fixture mode/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Return to globe" }));
  const obsolete = mapProps.cameraCommand!.id;
  act(() => useWorkspace.getState().requestCamera({ type: "zoom", delta: 1 }));
  const current = mapProps.cameraCommand!;
  act(() => mapProps.onCameraCommandHandled(obsolete));
  expect(useWorkspace.getState().cameraCommand).toEqual(current);
  await user.click(
    screen.getByRole("button", { name: "Acknowledge camera command" }),
  );
  expect(useWorkspace.getState().cameraCommand).toBeNull();
});
