import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AssistantResponse } from "@atlas/contracts";
import { App } from "../src/app/App";
import { useWorkspace } from "../src/app/state";
import { createQueryClient } from "../src/lib/queries";
import { createFixtureApi } from "../src/lib/fixture-api";
import { readContract } from "../src/lib/validation";
import { evidenceUrl } from "../src/lib/presentation";
import { homeZoom } from "../src/features/map/style";
import type { AtlasApi } from "../src/lib/api";
const storage = new Map<string, string>();
beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true);
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
});
function mount(api: AtlasApi = createFixtureApi()) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <App api={api} MapComponent={() => <div aria-label="Test map" />} />
    </QueryClientProvider>,
  );
}
it("starts unobstructed, preserves search drafts, and closes with Escape", async () => {
  const user = userEvent.setup();
  mount();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await user.type(screen.getByLabelText("Search reporting"), "unsubmitted");
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(screen.getByRole("button", { name: "Open search" }));
  expect(screen.getByLabelText("Search reporting")).toHaveValue("unsubmitted");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open search" })).toHaveFocus();
});
it("opens real research, persists a save, and exposes dated evidence and sources", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(
    await screen.findByRole("button", {
      name: "Flash Floods Swamp North Carolina",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Open article" }));
  await user.click(
    await screen.findByRole("button", { name: /Open investigation/ }),
  );
  await screen.findByRole("button", { name: "Save investigation" });
  await user.click(screen.getByRole("button", { name: "Save investigation" }));
  expect(JSON.parse(storage.get("atlas.saved.v1")!)).toEqual([
    "inv-helene-asheville-2024",
  ]);
  await user.click(screen.getByRole("button", { name: "Evidence" }));
  expect(await screen.findByLabelText("Observation")).toHaveValue(
    "ev-hls-l30-asheville-2024-08-30",
  );
  expect(screen.getByRole("img")).toHaveAttribute(
    "alt",
    expect.stringContaining("before Helene"),
  );
  await user.click(screen.getByRole("button", { name: "Sources" }));
  expect(
    screen.getByRole("link", { name: "Flash Floods Swamp North Carolina ↗" }),
  ).toHaveAttribute("href", expect.stringContaining("science.nasa.gov"));
});
it("changes investigation emphasis while retaining every supplied fact and the active filters", async () => {
  const api = createFixtureApi(),
    user = userEvent.setup();
  const data = await api.investigation!(
    "inv-helene-asheville-2024",
    new AbortController().signal,
  );
  useWorkspace.getState().applyFilters({ themes: ["flooding"] });
  useWorkspace.getState().selectInvestigation(data.investigation.id);
  useWorkspace
    .getState()
    .openPanel({ view: "investigation", id: data.investigation.id });
  const filters = structuredClone(useWorkspace.getState().filters);
  mount(api);
  await screen.findByRole("heading", { name: data.investigation.title });
  for (const audience of ["general_public", "journalist", "investor"]) {
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Perspective" }),
      audience,
    );
    for (const item of data.investigation.items)
      expect(screen.getByText(item.text)).toBeVisible();
    expect(useWorkspace.getState().filters).toEqual(filters);
  }
});
it("rejects stale assistant actions after filters change", async () => {
  const user = userEvent.setup(),
    fixture = createFixtureApi();
  let respond!: (r: AssistantResponse) => void;
  let requestId = "";
  const api: AtlasApi = {
    ...fixture,
    workspace: async (signal) => {
      const catalog = await fixture.workspace!(signal);
      return {
        ...catalog,
        capabilities: { ...catalog.capabilities, assistant: true },
      };
    },
    assistant: vi.fn(async (request) => {
      requestId = request.request_id;
      return new Promise<AssistantResponse>((resolve) => {
        respond = resolve;
      });
    }),
  };
  mount(api);
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await user.click(screen.getByRole("button", { name: "Ask Atlas" }));
  await user.type(screen.getByLabelText("Your question"), "Show flood reports");
  await user.click(screen.getByLabelText("Allow map and filter updates"));
  await user.click(screen.getByRole("button", { name: /Send question/ }));
  await waitFor(() => expect(requestId).not.toBe(""));
  act(() => useWorkspace.getState().applyFilters({ keyword: "new context" }));
  const news = await fixture.news({}, new AbortController().signal);
  await act(async () =>
    respond(
      readContract("AssistantResponse", {
        request_id: requestId,
        answer: "Old answer",
        citations: [],
        result_ids: [],
        actions: [{ type: "set_filters", filters: { keyword: "old context" } }],
        coverage: news.coverage,
        mode: "live",
        errors: [],
      }),
    ),
  );
  expect(useWorkspace.getState().filters.keyword).toBe("new context");
  expect(screen.queryByText("Old answer")).not.toBeInTheDocument();
});
it("rejects unsafe asset paths and fits global home zoom to the available viewport", () => {
  expect(evidenceUrl("assets/evidence/../secret.png")).toBeNull();
  expect(evidenceUrl("https://example.invalid/image.png")).toBeNull();
  expect(
    homeZoom(1440, 900, { top: 0, right: 420, bottom: 0, left: 0 }),
  ).toBeLessThan(homeZoom(1440, 900, { top: 0, right: 0, bottom: 0, left: 0 }));
});

it("rejects an unresolved citation before applying any workspace action", async () => {
  const user = userEvent.setup(),
    fixture = createFixtureApi();
  const api: AtlasApi = {
    ...fixture,
    assistant: async (request, signal) => {
      const news = await fixture.news({}, signal);
      return readContract("AssistantResponse", {
        request_id: request.request_id,
        answer: "Synthetic unsupported answer",
        citations: [
          {
            record_id: news.items[0]!.id,
            source_id: news.items[0]!.source_id,
            title: news.items[0]!.title,
            url: "https://example.invalid/forged-source",
          },
        ],
        result_ids: [],
        actions: [{ type: "set_filters", filters: { keyword: "forged" } }],
        coverage: news.coverage,
        mode: "live",
        errors: [],
      });
    },
  };
  mount(api);
  await user.click(screen.getByRole("button", { name: "Open search" }));
  await user.click(screen.getByRole("button", { name: "Ask Atlas" }));
  await user.type(screen.getByLabelText("Your question"), "Explain this story");
  await user.click(screen.getByLabelText("Allow map and filter updates"));
  await user.click(screen.getByRole("button", { name: /Send question/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A citation could not be resolved",
  );
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  expect(
    screen.queryByText("Synthetic unsupported answer"),
  ).not.toBeInTheDocument();
});

afterEach(() => vi.unstubAllGlobals());
it("restores the selected article when navigating Back through related reporting", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(
    await screen.findByRole("button", {
      name: "Flash Floods Swamp North Carolina",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Open article" }));
  await user.click(
    screen.getByRole("button", {
      name: "USGS is collecting flood data and repairing streamgages damaged by Hurricane Helene",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Open article" }));
  expect(useWorkspace.getState().selection.articleId).toBe(
    "art-usgs-news-helene-streamgages",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(useWorkspace.getState().selection.articleId).toBe(
      "art-nasa-eo-flash-floods-nc",
    ),
  );
  expect(
    within(screen.getByRole("region", { name: "Selected story" })).getByRole(
      "heading",
      { name: "Flash Floods Swamp North Carolina" },
    ),
  ).toBeInTheDocument();
});
it("expands the mobile sheet and makes the background inert until it closes", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(screen.getByRole("button", { name: "Expand panel" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  expect(useWorkspace.getState().sheetExpanded).toBe(true);
  await user.click(screen.getByRole("button", { name: "Close panel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
