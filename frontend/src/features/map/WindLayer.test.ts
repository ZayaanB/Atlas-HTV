import { createRequire } from "node:module";
import type { Map as MapboxMap, LayerSpecification } from "mapbox-gl";
import type { WindSample } from "@atlas/contracts";
import { expect, it } from "vitest";
import { updateWind, windFeatures } from "./WindLayer";
const { validate } = createRequire(import.meta.url)("mapbox-gl/dist/style-spec/index.cjs");
const sample: WindSample = { id: "test-wind", coordinates: [0, 0], model_coordinates: [0.1, 0.1], speed_kmh: 12,
  direction_from_degrees: 0, valid_at: "2026-10-18T12:00:00.000Z" };

it("converts meteorological from-direction into flow arrows, keeping missing direction unknown", () => {
  const data = windFeatures([0, 90, 180, 270, null].map(direction_from_degrees => ({ ...sample, direction_from_degrees })));
  expect(data.features.map(feature => feature.properties.flow_heading)).toEqual([180, 270, 0, 90, null]);
});
it("creates nothing while off, validates active layers, removes them when off, and restores after reload", () => {
  const layers: LayerSpecification[] = [], sources: Record<string, unknown> = {}, images = new Set<string>();
  const map = {
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    addLayer: (layer: LayerSpecification) => layers.push(layer),
    removeLayer: (id: string) => layers.splice(layers.findIndex(layer => layer.id === id), 1),
    getSource: (id: string) => sources[id],
    addSource: (id: string, source: unknown) => { sources[id] = source; },
    removeSource: (id: string) => { delete sources[id]; },
    hasImage: (id: string) => images.has(id), addImage: (id: string) => images.add(id),
  } as unknown as MapboxMap;
  updateWind(map, []);
  expect(layers).toHaveLength(0);
  expect(images.size).toBe(0);
  updateWind(map, [sample]);
  expect(validate({ version: 8, glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf", sources, layers })).toEqual([]);
  expect(layers).toHaveLength(3);
  updateWind(map, []);
  expect(layers).toHaveLength(0);
  expect(Object.keys(sources)).toHaveLength(0);
  images.clear();
  updateWind(map, [sample]);
  expect(layers).toHaveLength(3);
  expect(images.size).toBe(3);
});
