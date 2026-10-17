import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import examples from "@atlas/contracts/examples/helene-api.json";
import research from "@atlas/contracts/examples/helene-research.json";
import type { ObservationsQuery, ObservationsResponse } from "@atlas/contracts";
import { App } from "../src/app/App";
import { useWorkspace } from "../src/app/state";
import { Timeline } from "../src/features/research/Timeline";
import { createQueryClient } from "../src/lib/queries";
import { createHttpApi } from "../src/lib/api";
import type { AtlasApi } from "../src/lib/api";
import { createFixtureApi } from "../src/lib/fixture-api";
import { readContract } from "../src/lib/validation";
const investigation = readContract(
  "InvestigationResponse",
  research.investigations[0],
);
const series = investigation.observation_series[0]!;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function mount(element: React.ReactNode) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
}
beforeEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true));

it("opens investigation by ID and pages the existing HTTP timeline without workspace discovery", async () => {
  const fixture = createFixtureApi(),
    observationQueries: ObservationsQuery[] = [];
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    const url = new URL(String(path), "https://atlas.invalid");
    if (url.pathname === "/api/workspace")
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Discovery not implemented",
            retryable: false,
            request_id: "workspace",
          },
        },
        404,
      );
    if (url.pathname === "/api/news") return json(examples.news);
    if (url.pathname === "/api/locations") return json(examples.locations);
    if (url.pathname.startsWith("/api/investigations/")) {
      expect(url.pathname).toBe(
        `/api/investigations/${investigation.investigation.id}`,
      );
      expect(init?.method).toBeUndefined();
      return json(investigation);
    }
    const raw = Object.fromEntries(url.searchParams);
    const query = readContract("ObservationsQuery", {
      ...raw,
      ...(raw.limit ? { limit: Number(raw.limit) } : {}),
      ...(raw.offset ? { offset: Number(raw.offset) } : {}),
    });
    expect(query).not.toHaveProperty("series_id");
    const signal = init!.signal as AbortSignal;
    if (url.pathname === "/api/observations/compare")
      return json(
        await fixture.compare!(
          readContract("CompareObservationsArgs", query),
          signal,
        ),
      );
    expect(url.pathname).toBe("/api/observations");
    observationQueries.push(query);
    return json(await fixture.observations!(query, signal));
  });
  mount(
    <App
      api={createHttpApi(fetcher)}
      MapComponent={() => <div aria-label="Test map" />}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open news" }));
  await user.click(
    screen.getByRole("button", { name: "Saved investigations" }),
  );
  await user.type(
    screen.getByLabelText("Open investigation by ID"),
    investigation.investigation.id,
  );
  await user.click(screen.getByRole("button", { name: "Open investigation" }));
  await screen.findByRole("heading", {
    name: investigation.investigation.title,
  });
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  // This end-to-end path deliberately waits for every raw observation page.
  await screen.findByText(
    /Data coverage · historical fixture/,
    {},
    { timeout: 5000 },
  );
  expect(observationQueries.length).toBeGreaterThan(1);
  expect(observationQueries[0]).toMatchObject({
    location_id: series.location_id,
    metric: series.metric,
    limit: 100,
    offset: 0,
  });
  expect(observationQueries[1]!.offset).toBe(100);
  expect(
    screen.getByText(`${series.unit} · raw observations · historical`),
  ).toBeInTheDocument();
  const source = investigation.sources.find((s) => s.id === series.source_id)!;
  expect(
    screen.getByRole("link", { name: /Original dataset/ }),
  ).toHaveAttribute("href", source.url);
  expect(screen.getByText(/returned endpoints/)).toHaveTextContent(series.unit);
  await user.click(screen.getByText(/Observation table/));
  const table = screen.getByRole("table");
  expect(
    within(table).getByRole("columnheader", { name: "Fetched · UTC" }),
  ).toBeInTheDocument();
  expect(within(table).getAllByRole("row")).toHaveLength(101);
});

it("aborts an old observation range and discards its late response", async () => {
  const fixture = createFixtureApi();
  let resolveOld!: (response: ObservationsResponse) => void;
  let oldSignal!: AbortSignal;
  let call = 0;
  const api: AtlasApi = {
    ...fixture,
    observations: vi.fn(async (query, signal) => {
      if (++call === 1) {
        oldSignal = signal;
        return new Promise<ObservationsResponse>((resolve) => {
          resolveOld = resolve;
        });
      }
      return fixture.observations!(query, signal);
    }),
  };
  delete api.compare;
  mount(<Timeline api={api} data={investigation} />);
  await waitFor(() => expect(resolveOld).toBeDefined());
  const earliest = research.observations
    .find((row) => row.series_id === series.id)!
    .observed_at.slice(0, 10);
  fireEvent.change(screen.getByLabelText("Observed from"), {
    target: { value: earliest },
  });
  fireEvent.change(screen.getByLabelText("Through"), {
    target: { value: earliest },
  });
  await userEvent.click(screen.getByRole("button", { name: "Update period" }));
  await screen.findByText(/Data coverage · historical fixture/);
  expect(oldSignal.aborted).toBe(true);
  const textBefore = screen.getByLabelText("Historical timeline").textContent;
  const old = await fixture.observations!(
    { location_id: series.location_id, metric: series.metric, limit: 2 },
    new AbortController().signal,
  );
  await act(async () => resolveOld(old));
  expect(screen.getByLabelText("Historical timeline").textContent).toBe(
    textBefore,
  );
  expect(screen.queryByText(/Loading observations/)).not.toBeInTheDocument();
});

it.each(["unit", "source_id", "series_id"] as const)(
  "rejects a response with incompatible %s before plotting",
  async (field) => {
    const fixture = createFixtureApi(),
      original = research.observations.find(
        (row) => row.series_id === series.id,
      )!;
    const api: AtlasApi = {
      ...fixture,
      observations: async () =>
        readContract("ObservationsResponse", {
          items: [
            {
              ...original,
              [field]: field === "unit" ? "m" : "different-record",
            },
          ],
          coverage: examples.news.coverage,
          aggregation: "raw",
        }),
    };
    delete api.compare;
    mount(<Timeline api={api} data={investigation} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "outside the requested series, source, units, or period",
    );
    expect(
      screen.getByText(/Showing linked key observations/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry observations" }),
    ).toBeEnabled();
  },
);

it("retains explicit nulls in the observation table and never interpolates them", async () => {
  const original = research.observations.find(
    (row) => row.series_id === series.id,
  )!;
  // Synthetic protocol mutation checks missing-value rendering; no new measurement is asserted.
  const api: AtlasApi = {
    ...createFixtureApi(),
    observations: async () =>
      readContract("ObservationsResponse", {
        items: [{ ...original, value: null }],
        coverage: examples.news.coverage,
        aggregation: "raw",
      }),
  };
  delete api.compare;
  mount(<Timeline api={api} data={investigation} />);
  await screen.findByText(/Data coverage · historical fixture/);
  expect(screen.getByText(/No numeric observations/)).toBeInTheDocument();
  await userEvent.click(screen.getByText(/Observation table/));
  expect(
    within(screen.getByRole("table")).getByText("Missing"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
