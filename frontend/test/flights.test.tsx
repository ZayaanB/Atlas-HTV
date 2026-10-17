import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlightsResponse } from "@atlas/contracts";
import { useFlights } from "../src/lib/flights";
import { createFixtureApi } from "../src/lib/fixture-api";
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
it("does not poll while disabled/hidden and removes expired positions", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  const now = Date.now(),
    time = new Date(now).toISOString();
  // Synthetic protocol sample; never used in production fixtures or provider access.
  const sample: FlightsResponse = {
    items: [
      {
        id: "abc123",
        provider: "adsb.lol",
        callsign: null,
        coordinates: [-82, 35],
        altitude: null,
        altitude_unit: "ft",
        altitude_reference: "barometric",
        speed: null,
        speed_unit: "kn",
        heading: null,
        observed_at: time,
        fetched_at: time,
        source_url: "https://example.invalid/synthetic-aircraft",
        license: "ODbL-1.0",
      },
    ],
    region_id: "synthetic-region",
    fetched_at: time,
    stale: false,
    mode: "live",
    replay: false,
    attribution: "Synthetic protocol test",
    retry_at: new Date(now + 600000).toISOString(),
    error: null,
  };
  const fetchFlights = vi.fn(async () => sample),
    api = { ...createFixtureApi(), flights: fetchFlights },
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      },
    });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ enabled }) => useFlights(api, "synthetic-region", enabled),
    { wrapper, initialProps: { enabled: false } },
  );
  expect(fetchFlights).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(fetchFlights).toHaveBeenCalledTimes(1);
  expect(hook.result.current.aircraft).toHaveLength(1);
  act(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(360000);
  });
  expect(fetchFlights).toHaveBeenCalledTimes(1);
  expect(hook.result.current.aircraft).toHaveLength(0);
  hook.rerender({ enabled: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600000);
  });
  expect(fetchFlights).toHaveBeenCalledTimes(1);
  hook.unmount();
  client.clear();
});
