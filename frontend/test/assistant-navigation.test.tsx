import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it } from "vitest";
import research from "@atlas/contracts/examples/helene-research.json";
import type { AssistantRequestV2, ObservationsQuery } from "@atlas/contracts";
import { App } from "../src/app/App";
import { useWorkspace } from "../src/app/state";
import { createFixtureApi } from "../src/lib/fixture-api";
import { createQueryClient } from "../src/lib/queries";
import { readContract } from "../src/lib/validation";
import type { AtlasApi } from "../src/lib/api";
const data = readContract("InvestigationResponse", research.investigations[0]);
const first = data.observation_series[0]!,
  second = data.observation_series[1]!;
const target = {
  investigation_id: data.investigation.id,
  series_id: first.id,
  observed_from: "2024-09-27T04:00:00.000Z",
  observed_to: "2024-09-28T03:59:59.999Z",
};
function status(
  request: AssistantRequestV2,
  changes: Record<string, unknown> = {},
) {
  return readContract("AssistantResponseV2", {
    protocol_version: 2,
    request_id: request.request_id,
    answer: "Opened historical timeline.",
    kind: "action_summary",
    mode: "fixture",
    coverage: { mode: "fixture", live: false },
    citations: [],
    result_ids: [],
    actions: [{ type: "open_timeline", ...target }],
    search: null,
    resolved_range: null,
    timeline: null,
    errors: [],
    ...changes,
  });
}
function mount(api: AtlasApi) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={client}>
      <App api={api} MapComponent={() => <div aria-label="Test map" />} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true);
  useWorkspace.getState().openPanel({ view: "assistant" });
});
async function send(message: string) {
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: message },
  });
  await userEvent.click(screen.getByRole("button", { name: /Send question/ }));
}
it("explicit actions preserve filters/chat, clear an inactive aircraft highlight, and reopen the investigation with a fresh series/range", async () => {
  useWorkspace.getState().applyFilters({ themes: ["flooding"] });
  useWorkspace.getState().selectAircraft("aircraft-independent");
  const fixture = createFixtureApi(),
    requests: AssistantRequestV2[] = [],
    queries: ObservationsQuery[] = [];
  const next = {
    ...target,
    series_id: second.id,
    observed_from: "2024-09-28T00:30:00.000Z",
    observed_to: "2024-09-28T12:30:00.000Z",
  };
  mount({
    ...fixture,
    assistant: async (request) => {
      requests.push(request);
      return status(request, {
        actions: [
          { type: "open_timeline", ...(requests.length === 1 ? target : next) },
        ],
      });
    },
    observations: async (q, s) => {
      queries.push(q);
      return fixture.observations!(q, s);
    },
  });
  await send("Open the timeline");
  await screen.findByRole("region", { name: "Historical timeline" });
  const firstId = useWorkspace.getState().timelineIntent!.id;
  expect(useWorkspace.getState().filters.themes).toEqual(["flooding"]);
  expect(useWorkspace.getState().selectedAircraftId).toBeNull();
  expect(useWorkspace.getState().cameraCommand).toBeNull();
  expect(screen.getByText(/Active range/)).toHaveTextContent(
    target.observed_from,
  );
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText("Opened historical timeline.");
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: "Draft survives closing" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
  act(() => useWorkspace.getState().openPanel({ view: "assistant" }));
  expect(screen.getByLabelText("Your question")).toHaveValue(
    "Draft survives closing",
  );
  await send("Open another series");
  await screen.findByRole("region", { name: "Historical timeline" });
  expect(useWorkspace.getState().timelineIntent!.id).not.toBe(firstId);
  expect(useWorkspace.getState().timelineIntent!.target).toEqual(next);
  expect(screen.getByLabelText("Observation series")).toHaveValue(second.id);
  expect(screen.getByText(/Active range/)).toHaveTextContent(
    next.observed_from,
  );
  expect(requests[1]!.history).toEqual([
    { role: "user", content: "Open the timeline" },
    { role: "assistant", content: "Opened historical timeline." },
  ]);
  expect(requests[1]).not.toHaveProperty("selected_series_id");
  await waitFor(() =>
    expect(
      queries.some(
        (q) =>
          q.metric === second.metric &&
          q.observed_from === next.observed_from &&
          q.observed_to === next.observed_to,
      ),
    ).toBe(true),
  );
});
it("chart failure follows valid navigation without rolling back the accepted action batch", async () => {
  mount({
    ...createFixtureApi(),
    assistant: async (r) =>
      status(r, {
        actions: [
          { type: "set_filters", filters: { keyword: "Helene" } },
          { type: "open_timeline", ...target },
        ],
      }),
    observations: async () => {
      throw new Error("Chart data failed");
    },
  });
  await send("Show Helene and open the timeline");
  await screen.findByText("Chart data failed");
  expect(useWorkspace.getState().filters.keyword).toBe("Helene");
  expect(useWorkspace.getState().panel?.view).toBe("investigation");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("Opened historical timeline.")).toBeInTheDocument();
});
it("keeps oversized answers fully visible while omitting that exchange from subsequent history and clearing only conversation state", async () => {
  const requests: AssistantRequestV2[] = [],
    answer = "Long stored synthetic answer ".repeat(200) + "[1]";
  const source = data.sources[0]!;
  mount({
    ...createFixtureApi(),
    assistant: async (r) => {
      requests.push(r);
      return status(r, {
        kind: "answer",
        answer,
        actions: [],
        citations: [
          {
            number: 1,
            record_id: "new-record",
            source_id: source.id,
            title: source.title,
            url: source.url,
            published_at: null,
            published_date: null,
            observed_at: null,
            observed_from: null,
            observed_to: null,
            period_start: null,
            period_end: null,
          },
        ],
      });
    },
  });
  await send("First question");
  await screen.findByText(/Long stored synthetic answer/);
  expect(document.querySelector(".answer-text")!.textContent).toBe(answer);
  act(() =>
    useWorkspace
      .getState()
      .select({ articleId: null, locationId: data.locations[0]!.id }),
  );
  await send("Second question");
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.history).toEqual([]);
  expect(
    screen.getByText(/Earlier conversation was omitted/),
  ).toBeInTheDocument();
  const snapshot = useWorkspace.getState();
  await userEvent.click(
    screen.getByRole("button", { name: "New conversation" }),
  );
  expect(screen.queryByText("First question")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Your question")).toHaveValue("");
  expect(useWorkspace.getState().selection).toEqual(snapshot.selection);
  expect(useWorkspace.getState().filters).toEqual(snapshot.filters);
});
