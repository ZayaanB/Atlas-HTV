import { afterEach, expect, it, vi } from "vitest";
import type { Map } from "mapbox-gl";
import { compactMapLabel, startStoryPulse } from "./news-points";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("bounds long provider labels without leaving encoded entities or splitting Unicode characters", () => {
  expect(compactMapLabel("Bosnia &amp; Herzegovina")).toBe("Bosnia & Herzegovina");
  expect(compactMapLabel("  Pakistan\n ·  GDACS  ")).toBe("Pakistan · GDACS");
  const long = "Austria, Bosnia &amp; Herzegovina, Belgium, Belarus, Switzerland · GDACS drought";
  const label = compactMapLabel(long);
  expect(Array.from(label).length).toBeLessThanOrEqual(36);
  expect(label.endsWith("…")).toBe(true);
  expect(label).not.toContain("&amp;");
  expect(compactMapLabel("🌍".repeat(40))).toBe("🌍".repeat(35) + "…");
  expect(long).toContain("Switzerland"); // Presentation does not mutate original records.
});

it("pauses pulse work for reduced motion/background tabs, tolerates style replacement and disposes its loop", () => {
  let id = 0, hidden = false, layerPresent = true, ready = true;
  const frames = new globalThis.Map<number, FrameRequestCallback>();
  const motion = Object.assign(new EventTarget(), { matches: false });
  const request = vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const paint = vi.fn();
  const map = { getLayer: () => layerPresent ? {} : undefined, setPaintProperty: paint } as unknown as Pick<Map, "getLayer" | "setPaintProperty">;
  const tick = (time: number) => {
    const [frame, callback] = [...frames][0]!;
    frames.delete(frame); callback(time);
  };
  const stop = startStoryPulse(map, () => ready);
  expect(frames.size).toBe(1);
  tick(0); expect(paint).toHaveBeenCalledTimes(2);
  tick(16); expect(paint).toHaveBeenCalledTimes(2); // Paint updates are throttled.
  ready = false;
  tick(75); expect(paint).toHaveBeenCalledTimes(2); // No writes into a style still loading.
  ready = true;
  layerPresent = false;
  tick(100); expect(paint).toHaveBeenCalledTimes(2);
  layerPresent = true;
  tick(150); expect(paint).toHaveBeenCalledTimes(4);
  motion.matches = true; motion.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(0);
  expect(paint).toHaveBeenLastCalledWith("atlas-story-pulse", "circle-stroke-opacity", 0);
  motion.matches = false; motion.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(1);
  hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(0);
  hidden = false; document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(1);
  stop(); expect(frames.size).toBe(0);
  const requests = request.mock.calls.length;
  motion.dispatchEvent(new Event("change")); document.dispatchEvent(new Event("visibilitychange"));
  expect(request).toHaveBeenCalledTimes(requests);
});
