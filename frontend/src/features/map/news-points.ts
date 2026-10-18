import type { ExpressionSpecification, Map } from "mapbox-gl";

export const STORY_GLOW_ID = "atlas-story-glow";
export const STORY_PULSE_ID = "atlas-story-pulse";

/** Display text only: original location names and article records stay intact. */
export function compactMapLabel(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  };
  const text = value.replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name: string) => entities[name]!)
    .replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  if (characters.length <= 36) return text;
  const prefix = characters.slice(0, 35).join("");
  const lastSpace = prefix.lastIndexOf(" ");
  return (lastSpace >= 22 ? prefix.slice(0, lastSpace) : prefix).trimEnd() + "…";
}

const color: ExpressionSpecification = [
  "case", ["boolean", ["get", "selected"], false], "#dcefff",
  ["boolean", ["get", "provisional"], false], "#ffbd69", "#74b9ff",
];
const clusterRadius: ExpressionSpecification = ["step", ["get", "point_count"], 15, 10, 19, 30, 23];
function pulseRadius(spread: number): ExpressionSpecification {
  const at = (point: number): ExpressionSpecification => [
    "case", ["has", "point_count"], ["+", clusterRadius, spread],
    ["+", point, spread, ["case", ["boolean", ["get", "selected"], false], 2, 0]],
  ];
  return ["interpolate", ["linear"], ["zoom"], 1, at(6), 8, at(9), 14, at(12)];
}

/** Native Mapbox circles stay attached to their sourced coordinates on the globe. */
export function installStoryGlow(map: Map, source: string) {
  if (!map.getLayer(STORY_GLOW_ID)) map.addLayer({
    id: STORY_GLOW_ID, type: "circle", source,
    paint: {
      "circle-color": color,
      "circle-radius": ["case", ["has", "point_count"], ["+", clusterRadius, 12],
        ["case", ["boolean", ["get", "selected"], false], 25, 19]],
      "circle-opacity": 0.5,
      "circle-blur": 1,
      "circle-pitch-scale": "viewport",
    },
  });
  if (!map.getLayer(STORY_PULSE_ID)) map.addLayer({
    id: STORY_PULSE_ID, type: "circle", source,
    paint: {
      "circle-radius": pulseRadius(0),
      "circle-radius-transition": { duration: 0 },
      "circle-color": color,
      "circle-opacity": 0,
      "circle-stroke-color": color,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0,
      "circle-stroke-opacity-transition": { duration: 0 },
      "circle-blur": 0.2,
      "circle-pitch-scale": "viewport",
    },
  });
}

/** One slow pulse every 2.4 s; pause in background/reduced motion and dispose on unmount. */
export function startStoryPulse(map: Pick<Map, "getLayer" | "setPaintProperty">, ready: () => boolean = () => true): () => void {
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let frame: number | undefined, lastPaint = -Infinity, stopped = false;
  const paint = (time: number) => {
    if (stopped) return;
    if (time - lastPaint >= 50 && ready() && map.getLayer(STORY_PULSE_ID)) {
      lastPaint = time;
      const phase = (time % 2400) / 2400;
      map.setPaintProperty(STORY_PULSE_ID, "circle-radius", pulseRadius(phase * 13));
      map.setPaintProperty(STORY_PULSE_ID, "circle-stroke-opacity", 0.65 * (1 - phase) ** 2);
    }
    frame = window.requestAnimationFrame(paint);
  };
  const sync = () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    if (stopped) return;
    if (document.hidden || motion?.matches) {
      if (ready() && map.getLayer(STORY_PULSE_ID)) map.setPaintProperty(STORY_PULSE_ID, "circle-stroke-opacity", 0);
    } else {
      lastPaint = -Infinity;
      frame = window.requestAnimationFrame(paint);
    }
  };
  document.addEventListener("visibilitychange", sync);
  motion?.addEventListener("change", sync);
  sync();
  return () => {
    stopped = true;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", sync);
    motion?.removeEventListener("change", sync);
  };
}
