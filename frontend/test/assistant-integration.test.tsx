import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import examples from "@atlas/contracts/examples/helene-api.json";
import research from "@atlas/contracts/examples/helene-research.json";
import type {
  Article,
  AssistantRequestV2,
  AssistantResponseV2,
  InvestigationResponse,
  LocationsResponse,
  AssistantStreamEvent,
} from "@atlas/contracts";
import { AssistantPanel } from "../src/features/ai/AssistantPanel";
import { useAssistantSession } from "../src/features/ai/session";
import { useWorkspace } from "../src/app/state";
import { ApiFailure, createHttpApi, type AtlasApi } from "../src/lib/api";
import { createFixtureApi } from "../src/lib/fixture-api";
import { createQueryClient } from "../src/lib/queries";
import { readContract } from "../src/lib/validation";
const investigation = readContract(
  "InvestigationResponse",
  research.investigations[0],
);
const place = examples.locations.items[0]!;
const series = investigation.observation_series[0]!;
function response(
  requestId: string,
  changes: Record<string, unknown> = {},
): AssistantResponseV2 {
  return readContract("AssistantResponseV2", rawResponse(requestId, changes));
}
function rawResponse(requestId: string, changes: Record<string, unknown> = {}) {
  const observation = investigation.observations[0]!,
    source = investigation.sources.find((s) => s.id === observation.source_id)!;
  return {
    protocol_version: 2,
    kind: "answer",
    request_id: requestId,
    answer: "Synthetic integration answer [1].",
    citations: [
      {
        number: 1,
        record_id: observation.id,
        source_id: source.id,
        title: source.title,
        url: source.url,
        published_at: null,
        published_date: "2024-09-27",
        observed_at: observation.observed_at,
        observed_from: null,
        observed_to: null,
        period_start: null,
        period_end: null,
      },
    ],
    result_ids: [observation.id],
    actions: [],
    coverage: examples.news.coverage,
    mode: "fixture",
    errors: [],
    search: null,
    resolved_range: null,
    timeline: null,
    ...changes,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function streamingApi() {
  let controller!: ReadableStreamDefaultController<Uint8Array>, request!: AssistantRequestV2;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init!.headers).get('accept')).toBe('text/event-stream');
    request = readContract('AssistantRequestV2', JSON.parse(String(init!.body)));
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  return {
    api: createHttpApi(fetcher), fetcher,
    get request() { return request; },
    event(value: Record<string, unknown>) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ request_id: request.request_id, ...value })}\n\n`)); },
    close() { controller.close(); },
  };
}
function Harness({
  api,
  articles = [],
  data,
}: {
  api: AtlasApi;
  articles?: Article[];
  data?: InvestigationResponse;
}) {
  const session = useAssistantSession(api, articles, data);
  return (
    <AssistantPanel
      session={session}
      fixture={api.mode === "fixture"}
      connected={!!api.assistant}
    />
  );
}
function mount(
  api = createFixtureApi(),
  data?: InvestigationResponse,
  articles?: Article[],
) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...render(
      <Harness
        api={api}
        {...(data ? { data } : {})}
        {...(articles ? { articles } : {})}
      />,
      { wrapper },
    ),
    client,
  };
}
beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true);
  useWorkspace.getState().openPanel({ view: "assistant" });
});
async function send(message = "Explain source limitations") {
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: message },
  });
  await user.click(screen.getByRole("button", { name: /Send question/ }));
  return user;
}
it("posts v2 intent with current IDs before records load, chosen bounds only, and no catalog dependency", async () => {
  useWorkspace
    .getState()
    .applyFilters({ themes: ["flooding"], bounds: [-83, 35, -82, 36] });
  useWorkspace
    .getState()
    .select({ articleId: "art-loading", locationId: "loc-loading" });
  useWorkspace.getState().selectInvestigation("inv-loading");
  const requests: AssistantRequestV2[] = [];
  const api = createHttpApi(
    vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("/api/assistant");
      const request = readContract(
        "AssistantRequestV2",
        JSON.parse(init!.body as string),
      );
      requests.push(request);
      return json(rawResponse(request.request_id));
    }),
  );
  mount(api);
  await send();
  await screen.findByText(/Synthetic integration answer/);
  expect(requests[0]).toMatchObject({
    protocol_version: 2,
    interaction_mode: "intent",
    selected_article_id: "art-loading",
    selected_location_id: "loc-loading",
    selected_investigation_id: "inv-loading",
    selected_bounds: [-83, 35, -82, 36],
    history: [],
  });
  expect(requests[0]).not.toHaveProperty("allow_ui_actions");
  act(() => {
    useWorkspace.getState().applyFilters({});
    useWorkspace
      .getState()
      .setViewport({ bounds: [-83, 35, -82, 36], center: [-82, 35], zoom: 8 });
  });
  await send("Follow up");
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).not.toHaveProperty("selected_bounds");
  expect(requests[1]!.history).toEqual([
    { role: "user", content: "Explain source limitations" },
    { role: "assistant", content: "Synthetic integration answer [1]." },
  ]);
});
it.each([
  ["request ID", { request_id: "obsolete-request" }, "mismatched request"],
  [
    "fallback actions",
    { mode: "fallback", actions: [{ type: "set_filters", filters: {} }] },
    "shared validation",
  ],
  [
    "arbitrary coordinates",
    { actions: [{ type: "focus_location", coordinates: [0, 0] }] },
    "shared validation",
  ],
  [
    "unsafe URL",
    {
      citations: [
        { ...rawResponse("r").citations[0], url: "javascript:alert(1)" },
      ],
    },
    "shared validation",
  ],
  [
    "clarification actions",
    { kind: "clarification", actions: [{ type: "set_filters", filters: {} }] },
    "shared validation",
  ],
] as const)(
  "rejects %s before changing state",
  async (_name, changes, error) => {
    mount(
      createHttpApi(async (_url, init) =>
        json(rawResponse(JSON.parse(init!.body as string).request_id, changes)),
      ),
    );
    await send();
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(useWorkspace.getState().filters).toEqual({ limit: 50, offset: 0 });
    expect(useWorkspace.getState().cameraCommand).toBeNull();
  },
);

it.each([
  { answer: 'Uncited answer\n\nNo paragraph citation requirement.', citations: [] },
  { answer: 'Unresolved [9].' },
  { answer: 'Available [2], missing [1].', citations: [{ ...rawResponse('r').citations[0], number: 2 }] },
])('accepts optional references without replacing the answer: $answer', async changes => {
  mount(createHttpApi(async (_url, init) => json(rawResponse(JSON.parse(init!.body as string).request_id, changes))));
  await send();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Response ready.'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('.message.assistant .answer-text')).toHaveTextContent(changes.answer.replace(/\n+/g, ' '));
  if (changes.answer.includes('[2]')) {
    expect(screen.getAllByRole('link', { name: /^Source 2:/ })[0]).toHaveAttribute('href', rawResponse('r').citations[0]!.url);
  }
});
it("applies one atomic filter/focus transaction, keeps its answer, updates here, and supports filter-only Undo", async () => {
  const requests: AssistantRequestV2[] = [];
  const api = {
    ...createFixtureApi(),
    assistant: async (request: AssistantRequestV2) => {
      requests.push(request);
      return response(request.request_id, {
        actions: [
          { type: "set_filters", filters: { keyword: "Helene" } },
          { type: "focus_location", location_id: place.id },
        ],
      });
    },
  };
  const changes: number[] = [];
  const unsubscribe = useWorkspace.subscribe((s) =>
    changes.push(s.contextRevision),
  );
  mount(api);
  const user = await send("Show Helene and zoom here");
  await screen.findByText(/Synthetic integration answer/);
  unsubscribe();
  expect(changes).toHaveLength(1);
  expect(useWorkspace.getState().selection.locationId).toBe(place.id);
  const camera = useWorkspace.getState().cameraCommand;
  await user.click(screen.getByRole("button", { name: "Undo filters" }));
  expect(useWorkspace.getState().filters).toEqual({ limit: 50, offset: 0 });
  expect(useWorkspace.getState().cameraCommand).toEqual(camera);
  expect(useWorkspace.getState().selection.locationId).toBe(place.id);
  await send("What happened here?");
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.selected_location_id).toBe(place.id);
});
it("invalidates Undo on later manual filters and clears only incompatible selections on focus", async () => {
  const article = investigation.articles.find((a) =>
    a.location_ids.includes(place.id),
  )!;
  useWorkspace.getState().select({ articleId: article.id, locationId: null });
  useWorkspace.getState().selectInvestigation(investigation.investigation.id);
  mount(
    {
      ...createFixtureApi(),
      assistant: async (r) =>
        response(r.request_id, {
          actions: [
            { type: "focus_location", location_id: place.id },
            { type: "set_filters", filters: { themes: ["flooding"] } },
          ],
        }),
    },
    investigation,
    [article],
  );
  await send();
  await screen.findByText(/Synthetic integration answer/);
  expect(useWorkspace.getState().selection.articleId).toBe(article.id);
  expect(useWorkspace.getState().selectedInvestigationId).toBe(
    investigation.investigation.id,
  );
  act(() => useWorkspace.getState().applyFilters({ keyword: "manual" }));
  expect(screen.queryByText("Undo filters")).not.toBeInTheDocument();
});
it("an unavailable second target prevents the entire batch from applying", async () => {
  mount({
    ...createFixtureApi(),
    assistant: async (r) =>
      response(r.request_id, {
        actions: [
          { type: "set_filters", filters: { keyword: "must-not-apply" } },
          { type: "focus_location", location_id: "loc-unavailable" },
        ],
      }),
  });
  await send();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "unavailable location",
  );
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
});
it.each([
  "audience",
  "filters",
  "selection",
  "close",
  "new conversation",
] as const)(
  "discards a late fetch after %s changes even when abort is ignored",
  async (change) => {
    let resolve!: (r: AssistantResponseV2) => void,
      signal!: AbortSignal,
      id = "";
    mount({
      ...createFixtureApi(),
      assistant: (r, s) => {
        id = r.request_id;
        signal = s;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const user = await send();
    if (change === "audience")
      await user.selectOptions(
        screen.getByLabelText("Perspective"),
        "investor",
      );
    else if (change === "filters")
      act(() => useWorkspace.getState().applyFilters({ keyword: "manual" }));
    else if (change === "selection")
      act(() =>
        useWorkspace
          .getState()
          .select({ articleId: null, locationId: place.id }),
      );
    else if (change === "close")
      act(() => useWorkspace.getState().closePanel());
    else await user.click(screen.getByText("New conversation"));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve(
        response(id, {
          actions: [{ type: "set_filters", filters: { keyword: "stale" } }],
        }),
      ),
    );
    expect(
      screen.queryByText(/Synthetic integration answer/),
    ).not.toBeInTheDocument();
    expect(useWorkspace.getState().filters.keyword).not.toBe("stale");
  },
);
it("cancels during target resolution and never applies late targets", async () => {
  let resolve!: (r: LocationsResponse) => void, signal!: AbortSignal;
  const api: AtlasApi = {
    ...createFixtureApi(),
    locations: (_q, s) => {
      signal = s;
      return new Promise((done) => {
        resolve = done;
      });
    },
    assistant: async (r) =>
      response(r.request_id, {
        actions: [{ type: "focus_location", location_id: place.id }],
      }),
  };
  mount(api);
  await send();
  await waitFor(() => expect(resolve).toBeDefined());
  act(() =>
    useWorkspace
      .getState()
      .select({ articleId: "art-other", locationId: null }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve(readContract("LocationsResponse", examples.locations)),
  );
  expect(useWorkspace.getState().cameraCommand).toBeNull();
  expect(
    screen.queryByText(/Synthetic integration answer/),
  ).not.toBeInTheDocument();
});
it("retries the same failed user turn with a fresh request ID and preserves structured failure information", async () => {
  const requests: AssistantRequestV2[] = [];
  mount({
    ...createFixtureApi(),
    assistant: async (r) => {
      requests.push(r);
      if (requests.length === 1)
        throw new ApiFailure(
          "Try again shortly",
          "ASSISTANT_BUSY",
          429,
          true,
          "server-id",
        );
      return response(r.request_id);
    },
  });
  const user = await send();
  expect(await screen.findByRole("alert")).toHaveTextContent("ASSISTANT_BUSY");
  await user.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText(/Synthetic integration answer/);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.request_id).not.toBe(requests[1]!.request_id);
  expect(screen.getAllByText("Explain source limitations")).toHaveLength(1);
});
it("missing v2 contracts show setup/manual search without a catalog request or downgrade", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json(
      {
        error: {
          code: "CONTRACTS_UNAVAILABLE",
          message: "Build contracts first",
          retryable: true,
          request_id: "r",
        },
      },
      503,
    ),
  );
  mount(createHttpApi(fetcher));
  await send();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "v2 contracts build and a restart",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Manual search" })).toBeEnabled();
});
it("renders escaped plain text, original citation links, date-only metadata, and progressive sources", async () => {
  const base = rawResponse("r").citations[0]!;
  const citations = Array.from({ length: 5 }, (_, i) => ({
    ...base,
    number: i + 1,
    source_id: `src-extra-${i}`,
    record_id: `art-extra-${i}`,
    title: `Source ${i + 1}`,
  }));
  mount({
    ...createFixtureApi(),
    assistant: async (r) =>
      response(r.request_id, {
        answer: "<img src=x onerror=alert(1)> [1] [2] [3] [4] [5]",
        citations,
      }),
  });
  const user = await send();
  await screen.findByText(/<img src=x/);
  expect(document.querySelector(".answer-text img")).toBeNull();
  const links = screen.getAllByRole("link", { name: /Source 1: Source 1/ });
  expect(links[0]).toHaveAttribute("href", base.url);
  expect(links[0]).toHaveAttribute("target", "_blank");
  expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  const sources = screen.getByText('Sources', { selector: 'summary' });
  expect(sources.closest('details')).not.toHaveAttribute('open');
  await user.click(sources);
  expect(screen.getAllByText("2024-09-27")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Show all 5 sources" }));
  expect(screen.getAllByText("2024-09-27")).toHaveLength(5);
});
it("clarification and empty/status responses use server text/counts and only actions change filters", async () => {
  let count = 0;
  mount({
    ...createFixtureApi(),
    assistant: async (r) =>
      response(r.request_id, {
        kind: ++count === 1 ? "clarification" : "empty",
        answer: count === 1 ? "Which place?" : "No reporting returned.",
        citations: [],
        result_ids: ["art-server-page"],
        search: {
          filters: { keyword: "read-only" },
          returned_count: 0,
          limit: 10,
          offset: 0,
        },
        actions:
          count === 1
            ? []
            : [{ type: "set_filters", filters: { keyword: "explicit" } }],
      }),
  });
  await send("What about Toronto?");
  await screen.findByText("Which place?");
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  await send("Show explicit");
  await screen.findByText("No reporting returned.");
  expect(screen.getAllByText(/0 articles returned on this page/)).toHaveLength(
    2,
  );
  expect(useWorkspace.getState().filters.keyword).toBe("explicit");
});
it("keeps comparison suggestions in chat and validates timeline links without a camera flight", async () => {
  const target = {
    investigation_id: investigation.investigation.id,
    series_id: series.id,
    observed_from: "2024-09-27T04:00:00.000Z",
    observed_to: "2024-09-28T03:59:59.999Z",
  };
  mount({
    ...createFixtureApi(),
    assistant: async (r) => response(r.request_id, { timeline: target }),
  });
  const user = await send();
  await screen.findByText(/Synthetic integration answer/);
  expect(useWorkspace.getState().panel?.view).toBe("assistant");
  await user.click(screen.getByRole("button", { name: "Open timeline" }));
  await waitFor(() =>
    expect(useWorkspace.getState().panel?.view).toBe("investigation"),
  );
  expect(useWorkspace.getState().timelineIntent?.target).toEqual(target);
  expect(useWorkspace.getState().cameraCommand).toBeNull();
  expect(useWorkspace.getState().panelHistory.at(-1)?.view).toBe("assistant");
  act(() => useWorkspace.getState().backPanel());
  expect(screen.getByText(/Synthetic integration answer/)).toBeInTheDocument();
});
it("fixture fallback is v2, uncited, labeled, and never simulates an explanation", async () => {
  mount();
  await send();
  await screen.findByText(/No provider request was made/);
  expect(screen.getByText(/Atlas · fallback/)).toBeInTheDocument();
  expect(
    screen.getByText(/no AI explanation has been generated/),
  ).toBeInTheDocument();
});

it("validates outgoing requests before fetch and preserves HTTP code, retryability and request ID", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json(
      {
        error: {
          code: "ASSISTANT_BUSY",
          message: "Try later",
          retryable: true,
          request_id: "server-id",
        },
      },
      429,
    ),
  );
  const api = createHttpApi(fetcher),
    request = {
      protocol_version: 2 as const,
      request_id: "client-id",
      message: "Explain",
      timezone: "UTC",
      interaction_mode: "intent" as const,
    };
  await expect(
    api.assistant!(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "ASSISTANT_BUSY",
    retryable: true,
    requestId: "server-id",
    status: 429,
  });
  expect(() =>
    api.assistant!({ ...request, message: " " }, new AbortController().signal),
  ).toThrow("AssistantRequestV2");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("focus clears selections unsupported by stored place relationships while preserving aircraft", async () => {
  const other = readContract("Location", {
    ...place,
    id: "loc-synthetic-other",
    name: "Synthetic other location",
  });
  useWorkspace
    .getState()
    .select({ articleId: investigation.articles[0]!.id, locationId: place.id });
  useWorkspace.getState().selectInvestigation(investigation.investigation.id);
  useWorkspace.getState().selectAircraft("air-independent");
  mount(
    {
      ...createFixtureApi(),
      locations: async () => ({
        items: [other],
        coverage: { mode: "fixture", live: false },
      }),
      assistant: async (r) =>
        response(r.request_id, {
          actions: [{ type: "focus_location", location_id: other.id }],
        }),
    },
    investigation,
  );
  await send();
  await screen.findByText(/Synthetic integration answer/);
  expect(useWorkspace.getState().selection).toEqual({
    locationId: other.id,
    articleId: null,
  });
  expect(useWorkspace.getState().selectedInvestigationId).toBeNull();
  expect(useWorkspace.getState().selectedAircraftId).toBe("air-independent");
});
it("an unlinked timeline series rejects the preceding valid filter action", async () => {
  mount({
    ...createFixtureApi(),
    assistant: async (r) =>
      response(r.request_id, {
        actions: [
          { type: "set_filters", filters: { keyword: "must-not-apply" } },
          {
            type: "open_timeline",
            investigation_id: investigation.investigation.id,
            series_id: "series-unlinked",
          },
        ],
      }),
  });
  await send();
  expect(await screen.findByRole("alert")).toHaveTextContent("not linked");
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  expect(useWorkspace.getState().panel?.view).toBe("assistant");
});
it("retries a retryable fallback without duplicating its user message or sending fallback history", async () => {
  const requests: AssistantRequestV2[] = [];
  mount({
    ...createFixtureApi(),
    assistant: async (r) => {
      requests.push(r);
      return requests.length === 1
        ? response(r.request_id, {
            mode: "fallback",
            answer: "Generation temporarily unavailable.",
            citations: [],
            result_ids: [],
            errors: [
              {
                code: "GEMINI_UNAVAILABLE",
                message: "Try later.",
                retryable: true,
              },
            ],
          })
        : response(r.request_id);
    },
  });
  const user = await send();
  await screen.findByText("Generation temporarily unavailable.");
  await user.click(screen.getByRole("button", { name: "Retry question" }));
  await screen.findByText(/Synthetic integration answer/);
  expect(screen.getAllByText("Explain source limitations")).toHaveLength(1);
  expect(requests[1]!.history).toEqual([]);
  expect(requests[1]!.request_id).not.toBe(requests[0]!.request_id);
});

it('shows streamed plain text before completion, then links checked citations and commits actions once', async () => {
  const stream = streamingApi(); mount(stream.api); await send();
  act(() => {
    stream.event({ type: 'status', phase: 'writing' });
    stream.event({ type: 'answer_delta', text: 'Synthetic <script> preview [1].' });
  });
  expect(await screen.findByLabelText('Atlas response in progress')).toHaveTextContent('Synthetic <script> preview [1].');
  expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByRole('link', { name: /Source 1/ })).toBeNull();
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  act(() => {
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, {
      answer: 'Synthetic <script> preview [1].', actions: [{ type: 'set_filters', filters: { keyword: 'streamed' } }],
    }) });
    stream.close();
  });
  await screen.findAllByRole('link', { name: /Source 1/ });
  expect(screen.queryByLabelText('Atlas response in progress')).toBeNull();
  expect(useWorkspace.getState().filters.keyword).toBe('streamed');
  expect(screen.getByText('Updated reporting filters')).toBeInTheDocument();
  expect(stream.fetcher).toHaveBeenCalledTimes(1);
});

it('replaces an abandoned research preview when the server starts its final partial answer', async () => {
  const stream = streamingApi(); mount(stream.api); await send();
  act(() => { stream.event({ type: 'answer_delta', text: 'Abandoned research preview' }); });
  expect(await screen.findByLabelText('Atlas response in progress')).toHaveTextContent('Abandoned research preview');
  act(() => {
    stream.event({ type: 'status', phase: 'researching' });
    stream.event({ type: 'answer_delta', text: 'Supported final answer [1].' });
  });
  await waitFor(() => {
    expect(screen.getByLabelText('Atlas response in progress')).toHaveTextContent('Supported final answer [1].');
    expect(screen.getByLabelText('Atlas response in progress')).not.toHaveTextContent('Abandoned');
  });
  act(() => {
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, {
      answer: 'Supported final answer [1].',
      errors: [{ code: 'RESEARCH_LIMIT_REACHED', message: 'Partial answer within the research budget.', retryable: false }],
    }) }); stream.close();
  });
  expect(await screen.findByText('Partial answer within the research budget. (RESEARCH_LIMIT_REACHED)')).toBeVisible();
  expect(screen.queryByText('Abandoned research preview')).not.toBeInTheDocument();
});

it.each(['answer', 'empty'])('shows the semantic keyword-fallback notice on a completed %s response', async kind => {
  const stream = streamingApi(); mount(stream.api); await send('Find reporting about river flooding');
  const message = 'Semantic search was unavailable; literal keyword matching was used and may miss relevant reporting.';
  act(() => {
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, {
      kind, answer: kind === 'empty' ? 'No stored news matches this literal query.' : 'Matching stored reporting.',
      citations: [], result_ids: [],
      search: { filters: { semantic_query: 'river flooding' }, returned_count: kind === 'empty' ? 0 : 1, limit: 3, offset: 0 },
      errors: [{ code: 'SEMANTIC_SEARCH_UNAVAILABLE', message, retryable: false }],
    }) }); stream.close();
  });
  expect(await screen.findByText(`${message} (SEMANTIC_SEARCH_UNAVAILABLE)`)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Retry question' })).not.toBeInTheDocument();
});

it.each(['interrupted', 'mismatched', 'invalid event'])('discards provisional text and all actions after a %s stream', async problem => {
  const stream = streamingApi(); mount(stream.api); await send();
  act(() => { stream.event({ type: 'answer_delta', text: 'Provisional answer [1].' }); });
  await screen.findByText('Provisional answer [1].');
  act(() => {
    if (problem === 'invalid event') stream.event({ type: 'answer_delta', text: 'Unsafe', actions: [] });
    else if (problem !== 'interrupted') stream.event({ type: 'complete', response: rawResponse(
      problem === 'mismatched' ? 'other-request' : stream.request.request_id,
      { answer: 'Completed [1].', actions: [{ type: 'set_filters', filters: { keyword: 'unsafe' } }] },
    ) });
    stream.close();
  });
  await screen.findByRole('alert');
  expect(screen.queryByText('Provisional answer [1].')).toBeNull();
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Retry question' })).toBeEnabled();
});

it('keeps the streamed answer and valid actions when references are missing', async () => {
  const stream = streamingApi(); mount(stream.api); await send();
  const answer = 'A streamed answer [9].\n\nA paragraph without an inline source.';
  act(() => { stream.event({ type: 'answer_delta', text: answer }); });
  expect(await screen.findByLabelText('Atlas response in progress')).toHaveTextContent('A streamed answer [9].');
  act(() => {
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, {
      answer, citations: [], actions: [{ type: 'set_filters', filters: { keyword: 'accepted' } }],
    }) }); stream.close();
  });
  await waitFor(() => expect(useWorkspace.getState().filters.keyword).toBe('accepted'));
  expect(screen.getByText(/A streamed answer \[9\]./)).toHaveTextContent('A paragraph without an inline source.');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('replaces rejected provisional text with the labeled fallback and permits manual retry', async () => {
  const stream = streamingApi(); mount(stream.api); await send();
  act(() => {
    stream.event({ type: 'answer_delta', text: 'Provisional statement [1].' });
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, {
      mode: 'fallback', answer: 'The generated references could not be checked.', citations: [], result_ids: [],
      errors: [{ code: 'INVALID_CITATION', message: 'Use a narrower question or retry.', retryable: true }],
    }) }); stream.close();
  });
  await screen.findByText('The generated references could not be checked.');
  expect(screen.queryByText('Provisional statement [1].')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry question' })).toBeEnabled();
});

it('ignores late streaming callbacks and completion after cancellation, including adapters that ignore abort', async () => {
  let publish!: (event: AssistantStreamEvent) => void, finish!: (value: AssistantResponseV2) => void, requestId = '';
  mount({ ...createFixtureApi(), assistantStream: async (request, _signal, update) => {
    publish = update; requestId = request.request_id;
    return new Promise(resolve => { finish = resolve; });
  } });
  const user = await send();
  act(() => publish({ type: 'answer_delta', request_id: requestId, text: 'Before cancel' }));
  await screen.findByText('Before cancel');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => {
    publish({ type: 'answer_delta', request_id: requestId, text: 'Late text' });
    finish(response(requestId, { actions: [{ type: 'set_filters', filters: { keyword: 'late' } }] }));
  });
  expect(screen.queryByText(/Before cancel|Late text/)).toBeNull();
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  expect(screen.getByText(/Question cancelled. You can ask it again/)).toBeInTheDocument();
});

it('decodes SSE across byte, CRLF, escaped text and Unicode boundaries without waiting for a final response', async () => {
  const request: AssistantRequestV2 = { protocol_version: 2, interaction_mode: 'intent', request_id: 'unicode-stream', message: 'Explain', timezone: 'UTC' };
  const events = [
    { type: 'answer_delta', request_id: request.request_id, text: 'Quoted "evidence" 🚀\n[1].' },
    { type: 'complete', request_id: request.request_id, response: rawResponse(request.request_id) },
  ];
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  const seen: AssistantStreamEvent[] = [];
  const api = createHttpApi(vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } })));
  const result = await api.assistantStream!(request, new AbortController().signal, event => seen.push(event));
  expect(seen).toEqual([events[0]]); expect(result.request_id).toBe(request.request_id);
});

it('accepts headings without treating them as unsupported factual paragraphs', async () => {
  mount({ ...createFixtureApi(), assistant: async request => response(request.request_id, {
    answer: '## Historical evidence\n\nSynthetic sourced explanation [1].\n\nEvidence limits:\n\nA documented limitation [1].',
  }) });
  await send(); await screen.findAllByRole('link', { name: /Source 1/ });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Response ready.');
});

it('follows streaming while at the bottom and preserves the reading position after scrolling up', async () => {
  const stream = streamingApi(), client = createQueryClient();
  const view = render(<QueryClientProvider client={client}><div className="panel-body"><Harness api={stream.api} /></div></QueryClientProvider>);
  await send();
  const body = screen.getByRole('region', { name: 'Conversation' });
  expect(body).not.toContainElement(screen.getByLabelText('Your question'));
  Object.defineProperty(body, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
  body.scrollTop = 100; fireEvent.scroll(body);
  act(() => stream.event({ type: 'answer_delta', text: 'First words ' }));
  await screen.findByText('First words'); expect(body.scrollTop).toBe(100);
  body.scrollTop = 800; fireEvent.scroll(body);
  act(() => stream.event({ type: 'answer_delta', text: 'continue [1].' }));
  await screen.findByText('First words continue [1].'); expect(body.scrollTop).toBe(1000);
  act(() => {
    stream.event({ type: 'complete', response: rawResponse(stream.request.request_id, { answer: 'First words continue [1].' }) }); stream.close();
  });
  await screen.findAllByRole('link', { name: /Source 1/ });
});

it('sends with Enter, keeps Shift+Enter for new lines, and focuses suggested questions in the pinned composer', async () => {
  const assistant = vi.fn(async (request: AssistantRequestV2) => response(request.request_id));
  mount({ ...createFixtureApi(), assistant });
  const user = userEvent.setup(), input = screen.getByLabelText('Your question');
  await user.click(screen.getByText('Suggested questions'));
  await user.click(screen.getByRole('button', { name: /What local events/ }));
  expect(input).toHaveFocus();
  await user.clear(input);
  await user.type(input, 'First line{Shift>}{Enter}{/Shift}Second line');
  expect(input).toHaveValue('First line\nSecond line');
  expect(assistant).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  await screen.findByText(/Synthetic integration answer/);
  expect(assistant).toHaveBeenCalledTimes(1);
  expect(assistant.mock.calls[0]![0].message).toBe('First line\nSecond line');
  const sources = screen.getByText('Sources', { selector: 'summary' });
  expect(sources.closest('details')).not.toHaveAttribute('open');
  await user.click(screen.getByText('Suggested questions'));
  await user.click(screen.getByRole('button', { name: /What local events/ }));
  expect(input).toHaveFocus();
  expect(screen.getByText('Suggested questions').closest('details')).not.toHaveAttribute('open');
});
