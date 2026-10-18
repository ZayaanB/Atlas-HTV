import { createRequire } from "node:module";
import type { FillLayerSpecification, LayerSpecification, Map as MapboxMap } from "mapbox-gl";
import { describe, expect, it, vi } from "vitest";
import { installMaterials, MATERIAL_IMAGES } from "./materials";
import { installBuildings } from "./basemap";

const { validate } = createRequire(import.meta.url)("mapbox-gl/dist/style-spec/index.cjs");

function basemap() {
  const landFilter: NonNullable<FillLayerSpecification["filter"]> = ["match", ["get", "class"], ["park", "airport", "sand"], true, false];
  const layers: LayerSpecification[] = [
    { id: "landuse", type: "fill", source: "composite", "source-layer": "landuse", filter: structuredClone(landFilter) },
    { id: "water", type: "fill", source: "composite", "source-layer": "water" },
    { id: "roads", type: "line", source: "composite", "source-layer": "road" },
    { id: "buildings", type: "fill", source: "composite", "source-layer": "building" },
  ];
  const original = structuredClone(layers);
  const images = new Set<string>();
  const addImage = vi.fn((id: string) => { images.add(id); });
  const addLayer = vi.fn((layer: LayerSpecification, before?: string) => {
    const index = before ? layers.findIndex((item) => item.id === before) : layers.length;
    layers.splice(index, 0, layer);
  });
  const style = { version: 8, sources: { composite: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" } }, layers };
  const map = {
    getStyle: () => structuredClone(style),
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    getSource: () => ({}),
    hasImage: (id: string) => images.has(id),
    addImage, addLayer,
  } as unknown as MapboxMap;
  return { map, layers, original, images, addImage, addLayer, style, landFilter };
}

describe("street-level material integration", () => {
  it("validates the complete textured style with Mapbox's validator and preserves roads and source filters", () => {
    const b = basemap();
    installMaterials(b.map, "map");
    installBuildings(b.map, "map");
    expect(validate(b.style)).toEqual([]);
    expect(b.layers.map((layer) => layer.id)).toEqual([
      "landuse", "atlas-material-landuse", "water", "atlas-material-water", "roads", "buildings", "atlas-3d-buildings",
    ]);
    const grass = b.layers.find((layer) => layer.id === "atlas-material-landuse")!;
    expect(grass.filter).toEqual(["all", b.landFilter,
      ["match", ["get", "class"], ["grass", "park", "wood", "scrub", "pitch"], true, false]]);
    expect(grass.minzoom).toBe(15);
    expect(b.map.getLayer("atlas-3d-buildings")).toHaveProperty("paint.fill-extrusion-pattern", MATERIAL_IMAGES.masonry);
    expect(b.layers.filter((layer) => !layer.id.startsWith("atlas-"))).toEqual(b.original);
  });

  it("avoids duplicate images/layers, restores them after style reload, and leaves Satellite alone", () => {
    const b = basemap();
    installMaterials(b.map, "satellite");
    expect(b.addImage).not.toHaveBeenCalled();
    expect(b.addLayer).not.toHaveBeenCalled();
    installMaterials(b.map, "map");
    installMaterials(b.map, "map");
    expect(b.addImage).toHaveBeenCalledTimes(3);
    expect(b.addLayer).toHaveBeenCalledTimes(2);
    b.images.clear();
    b.layers.splice(0, b.layers.length, ...b.original);
    installMaterials(b.map, "map");
    expect(b.addImage).toHaveBeenCalledTimes(6);
    expect(b.addLayer).toHaveBeenCalledTimes(4);
  });
});
