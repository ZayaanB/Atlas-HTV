import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import examples from "@atlas/contracts/examples/helene-api.json";
import research from "@atlas/contracts/examples/helene-research.json";
import type { AssistantRequest, AssistantResponse } from "@atlas/contracts";
import { AssistantPanel } from "../src/features/ai/AssistantPanel";
import { useWorkspace } from "../src/app/state";
import { createHttpApi } from "../src/lib/api";
import { createFixtureApi } from "../src/lib/fixture-api";
import { readContract } from "../src/lib/validation";

const news = readContract("NewsResponse", examples.news);
const investigation = readContract(
  "InvestigationResponse",
  research.investigations[0],
);
function response(requestId: string, changes: Record<string, unknown> = {}) {
  const observation = investigation.observations[0]!,
    source = investigation.sources.find((s) => s.id === observation.source_id)!;
  return {
    request_id: requestId,
    answer: "Synthetic integration answer.",
    citations: [
      {
        record_id: observation.id,
        source_id: source.id,
        title: source.title,
        url: source.url,
      },
    ],
    result_ids: [observation.id],
    actions: [],
    coverage: news.coverage,
    mode: "fixture",
    errors: [],
    ...changes,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true));
async function send(allow = false) {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Your question"),
    "Explain source limitations",
  );
  if (allow)
    await user.click(screen.getByLabelText("Allow map and filter updates"));
  await user.click(screen.getByRole("button", { name: /Send question/ }));
  return user;
}

it("posts bounded audience/context without catalog discovery and accepts backend-resolved new evidence", async () => {
  useWorkspace
    .getState()
    .applyFilters({ themes: ["flooding"], keyword: "Helene" });
  const initial = structuredClone(useWorkspace.getState().filters);
  const requests: AssistantRequest[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("/api/assistant");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const request = readContract(
      "AssistantRequest",
      JSON.parse(init!.body as string),
    );
    requests.push(request);
    return json(response(request.request_id));
  });
  render(
    <AssistantPanel
      api={createHttpApi(fetcher)}
      articles={[]}
      investigation={investigation}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Perspective" }),
    "journalist",
  );
  await send();
  await screen.findByText("Synthetic integration answer.");
  expect(requests[0]).toMatchObject({
    message: "Explain source limitations",
    audience: "journalist",
    selected_investigation_id: investigation.investigation.id,
    filters: initial,
    allow_ui_actions: false,
  });
  expect(Object.keys(requests[0]!)).not.toContain("history");
  expect(useWorkspace.getState().filters).toEqual(initial);
  expect(screen.getByRole("link")).toHaveAttribute(
    "href",
    response("r").citations[0]!.url,
  );
  expect(
    screen.getByText(/Data coverage · historical fixture/),
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Perspective" }),
    "investor",
  );
  await send();
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.audience).toBe("investor");
  expect(requests[1]!.filters).toEqual(initial);
  expect(useWorkspace.getState().filters).toEqual(initial);
});

it.each([
  [
    "consent",
    {
      actions: [{ type: "set_filters", filters: { keyword: "unauthorized" } }],
    },
    "Workspace changes were not enabled",
  ],
  ["request ID", { request_id: "obsolete-request" }, "mismatched request"],
  [
    "fallback actions",
    { mode: "fallback", actions: [{ type: "set_filters", filters: {} }] },
    "Fallback answers cannot change",
  ],
  [
    "arbitrary coordinates",
    { actions: [{ type: "focus_location", coordinates: [0, 0] }] },
    "failed shared validation",
  ],
  [
    "unsafe citation URL",
    {
      citations: [
        {
          source_id: "src-test",
          record_id: "art-test",
          title: "Unsafe",
          url: "javascript:alert(1)",
        },
      ],
    },
    "failed shared validation",
  ],
] as const)(
  "rejects invalid %s before changing workspace state",
  async (_name, changes, error) => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const request = JSON.parse(init!.body as string) as AssistantRequest;
      return json(response(request.request_id, changes));
    });
    render(<AssistantPanel api={createHttpApi(fetcher)} articles={[]} />);
    await send();
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(useWorkspace.getState().filters).toEqual({ limit: 50, offset: 0 });
    expect(useWorkspace.getState().cameraCommand).toBeNull();
    expect(
      screen.queryByText("Synthetic integration answer."),
    ).not.toBeInTheDocument();
  },
);

it("applies permitted filters and sourced focus through workspace state, with undo", async () => {
  const place = examples.locations.items.find((location) => location.bounds)!;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).startsWith("/api/locations?"))
      return json(examples.locations);
    const request = JSON.parse(init!.body as string) as AssistantRequest;
    expect(request.allow_ui_actions).toBe(true);
    return json(
      response(request.request_id, {
        actions: [
          {
            type: "set_filters",
            filters: { themes: ["flooding"], location_ids: [place.id] },
          },
          { type: "focus_location", location_id: place.id },
        ],
      }),
    );
  });
  render(<AssistantPanel api={createHttpApi(fetcher)} articles={[]} />);
  const user = await send(true);
  await waitFor(() =>
    expect(useWorkspace.getState().filters.location_ids).toEqual([place.id]),
  );
  expect(useWorkspace.getState().cameraCommand).toMatchObject({
    type: "fit_bounds",
    bounds: place.bounds,
  });
  await user.click(screen.getByRole("button", { name: "Undo filters" }));
  expect(useWorkspace.getState().filters).toEqual({ limit: 50, offset: 0 });
});

it("resolves every action before applying any, preserving HTTP failure information", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).startsWith("/api/locations?"))
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Location unavailable",
            retryable: false,
            request_id: "location-request",
          },
        },
        404,
      );
    const request = JSON.parse(init!.body as string) as AssistantRequest;
    return json(
      response(request.request_id, {
        actions: [
          { type: "set_filters", filters: { keyword: "must-not-apply" } },
          { type: "focus_location", location_id: "loc-unavailable" },
        ],
      }),
    );
  });
  render(<AssistantPanel api={createHttpApi(fetcher)} articles={[]} />);
  await send(true);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Location unavailable",
  );
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
});

it("shows fallback diagnostics and coverage without presenting a generated briefing", async () => {
  render(<AssistantPanel api={createFixtureApi()} articles={[]} />);
  await send();
  expect(
    await screen.findByText(/No provider request was made/),
  ).toHaveTextContent("FIXTURE_MODE");
  expect(screen.getByText(/Atlas · fallback/)).toBeInTheDocument();
  expect(
    screen.getByText(/no AI explanation has been generated/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Data coverage · historical fixture/),
  ).toBeInTheDocument();
});

it("preserves the HTTP error envelope and rejects malformed outgoing requests before fetch", async () => {
  const error = {
    code: "ASSISTANT_BUSY",
    message: "Try again shortly",
    retryable: true,
    request_id: "server-request",
  };
  const fetcher = vi.fn<typeof fetch>(async () => json({ error }, 429));
  const api = createHttpApi(fetcher);
  const request = {
    request_id: "client-request",
    message: "Read only",
    timezone: "UTC",
  };
  await expect(
    api.assistant!(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: error.code,
    message: error.message,
    retryable: true,
    requestId: error.request_id,
    status: 429,
  });
  expect(() =>
    api.assistant!({ ...request, message: " " }, new AbortController().signal),
  ).toThrow(/AssistantRequest/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels obsolete audience/consent requests and discards late responses from an adapter that ignores abort", async () => {
  const pending: {
    request: AssistantRequest;
    signal: AbortSignal;
    resolve: (value: AssistantResponse) => void;
  }[] = [];
  const api = {
    ...createFixtureApi(),
    assistant: (request: AssistantRequest, signal: AbortSignal) =>
      new Promise<AssistantResponse>((resolve) =>
        pending.push({ request, signal, resolve }),
      ),
  };
  render(<AssistantPanel api={api} articles={[]} />);
  const user = await send(true);
  await waitFor(() => expect(pending).toHaveLength(1));
  await user.click(screen.getByLabelText("Allow map and filter updates"));
  expect(pending[0]!.signal.aborted).toBe(true);
  await send();
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[1]!.request.allow_ui_actions).toBe(false);
  await act(async () =>
    pending[0]!.resolve(
      readContract(
        "AssistantResponse",
        response(pending[0]!.request.request_id, {
          answer: "Obsolete answer",
          actions: [{ type: "set_filters", filters: { keyword: "stale" } }],
        }),
      ),
    ),
  );
  expect(screen.queryByText("Obsolete answer")).not.toBeInTheDocument();
  expect(useWorkspace.getState().filters.keyword).toBeUndefined();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Perspective" }),
    "investor",
  );
  expect(pending[1]!.signal.aborted).toBe(true);
  await act(async () =>
    pending[1]!.resolve(
      readContract(
        "AssistantResponse",
        response(pending[1]!.request.request_id),
      ),
    ),
  );
  expect(
    screen.queryByText("Synthetic integration answer."),
  ).not.toBeInTheDocument();
});
