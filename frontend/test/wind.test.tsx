import type { ReactNode } from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindResponse } from "@atlas/contracts";
import { useWind, windBounds } from "../src/lib/wind";
import { createFixtureApi } from "../src/lib/fixture-api";
import { createHttpApi } from "../src/lib/api";
import { App } from "../src/app/App";
import type { AtlasMapProps, ViewportSnapshot } from "../src/app/map-interface";
import { useWorkspace } from "../src/app/state";

const viewport: ViewportSnapshot = { bounds: [-80, 43, -79, 44], center: [-79.5, 43.5], zoom: 8 };
function response(): WindResponse {
  const time = new Date(Date.now()).toISOString();
  return {
    items: [{ id: "test-wind", coordinates: [-79.5, 43.5], model_coordinates: [-79.49, 43.51], speed_kmh: 12,
      direction_from_degrees: 270, valid_at: time }],
    bounds: viewport.bounds, requested_points: 9, height_m: 10, kind: "model_estimate", provider: "open-meteo",
    fetched_at: time, next_refresh_at: new Date(Date.now() + 15 * 60000).toISOString(), stale: false, warning: null,
    attribution: "Synthetic protocol test", source_url: "https://open-meteo.com/en/docs", license: "CC-BY-4.0",
  };
}
beforeEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true));
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

it("offers an unchecked Wind toggle, makes no initial call, and clears the map on disable", async () => {
  const user = userEvent.setup(), wind = vi.fn(async () => response());
  const api = { ...createFixtureApi(), wind };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function MapProbe(props: AtlasMapProps) { return <output aria-label="Wind sample count">{props.windSamples?.length ?? 0}</output>; }
  useWorkspace.getState().setViewport(viewport);
  const app = render(<QueryClientProvider client={client}><App api={api} MapComponent={MapProbe} /></QueryClientProvider>);
  await user.click(screen.getByRole("button", { name: "Map layers" }));
  const toggle = screen.getByRole("checkbox", { name: "Show wind" });
  expect(toggle).not.toBeChecked();
  expect(wind).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Wind sample count")).toHaveTextContent("0");
  await user.click(toggle);
  await waitFor(() => expect(screen.getByLabelText("Wind sample count")).toHaveTextContent("1"));
  expect(screen.getByRole("region", { name: "Wind data" })).toHaveTextContent("Model time:");
  await user.click(toggle);
  expect(screen.getByLabelText("Wind sample count")).toHaveTextContent("0");
  expect(screen.queryByRole("region", { name: "Wind data" })).not.toBeInTheDocument();
  app.unmount();
  client.clear();
});

it("does not poll while off or hidden", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const wind = vi.fn(async () => response()), api = { ...createFixtureApi(), wind };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ enabled }) => useWind(api, viewport, enabled), { wrapper, initialProps: { enabled: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(wind).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(wind).toHaveBeenCalledTimes(1);
  expect(hook.result.current.samples).toHaveLength(1);
  act(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(61 * 60000); });
  expect(wind).toHaveBeenCalledTimes(1);
  expect(hook.result.current.samples).toHaveLength(0);
  hook.rerender({ enabled: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60000); });
  expect(wind).toHaveBeenCalledTimes(1);
  hook.unmount(); client.clear();
});

it("removes expired estimates during repeated API failures", async () => {
  vi.useFakeTimers();
  const data = response(), wind = vi.fn(async () => data), api = { ...createFixtureApi(), wind };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useWind(api, viewport, true), { wrapper });
  await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(hook.result.current.samples).toHaveLength(1);
  wind.mockRejectedValue(new Error("Offline"));
  await act(async () => { await vi.advanceTimersByTimeAsync(61 * 60000); });
  expect(hook.result.current.expired).toBe(true);
  expect(hook.result.current.samples).toHaveLength(0);
  hook.unmount(); client.clear();
});

it("cancels an in-flight browser request when disabled and rejects invalid API units", async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  const wind = vi.fn((_query, signal: AbortSignal): Promise<WindResponse> => {
    requestSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const api = { ...createFixtureApi(), wind };
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ enabled }) => useWind(api, viewport, enabled), { wrapper, initialProps: { enabled: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  hook.rerender({ enabled: false });
  expect(requestSignal?.aborted).toBe(true);
  expect(hook.result.current.samples).toHaveLength(0);
  hook.unmount(); client.clear();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...response(), height_m: 100 })));
  await expect(createHttpApi(fetcher).wind!({ bounds: viewport.bounds }, new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

it("normalizes wrapped and world viewports without dropping antimeridian coverage", () => {
  expect(windBounds({ ...viewport, bounds: [170, -10, 190, 10] })).toEqual([170, -10, -170, 10]);
  expect(windBounds({ ...viewport, bounds: [-250, -100, 250, 100] })).toEqual([-180, -90, 180, 90]);
  expect(windBounds(null)).toBeNull();
});
