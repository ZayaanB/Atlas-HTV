import type { FillLayerSpecification, Map } from "mapbox-gl";
import type { BasemapStyle } from "./basemap";

type Material = "water" | "grass" | "masonry";
export const MATERIAL_IMAGES: Record<Material, string> = {
  water: "atlas-material-water",
  grass: "atlas-material-grass",
  masonry: "atlas-material-masonry",
};
const SIZE = 128;

/** Small, deterministic, seamless material tiles; illustrative, never source imagery. */
function materialImage(material: Material) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const noise = ((Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0) % 17 - 8;
      let color: [number, number, number];
      if (material === "water") {
        const ripple = Math.pow(Math.max(0, Math.cos(
          y * Math.PI / 8 + Math.sin(x * Math.PI / 32) * 0.9,
        )), 7) * 14;
        const swell = Math.sin(x * Math.PI / 64 + y * Math.PI / 32) * 3;
        color = [22 + swell, 48 + ripple + swell, 66 + ripple + swell];
      } else if (material === "grass") {
        const blade = (x + 3 * y) % 11 === 0 ? 7 : 0;
        const patch = Math.sin(x * Math.PI / 32 + Math.sin(y * Math.PI / 64)) * 2 +
          Math.cos(y * Math.PI / 32 + Math.sin(x * Math.PI / 16)) * 1.5;
        color = [44 + noise + patch, 65 + noise + patch + blade, 43 + noise / 2 + patch];
      } else {
        const course = Math.floor(y / 8);
        const joint = y % 8 === 0 || (x + (course % 2) * 8) % 16 === 0;
        const shade = joint ? -13 : noise * 0.45;
        color = [104 + shade, 112 + shade, 122 + shade];
      }
      const offset = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(color[channel]!);
      data[offset + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

// Reuse pixel data across reloads; Mapbox's image registry is recreated per style.
const images = {
  water: materialImage("water"),
  grass: materialImage("grass"),
  masonry: materialImage("masonry"),
};

export function installMaterials(map: Map, style: BasemapStyle): void {
  if (style !== "map") return;
  for (const material of Object.keys(images) as Material[]) {
    const id = MATERIAL_IMAGES[material];
    if (!map.hasImage(id)) map.addImage(id, images[material], { pixelRatio: 2 });
  }

  const layers = map.getStyle()?.layers ?? [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.type !== "fill" || layer.id.startsWith("atlas-") || typeof layer.source !== "string") continue;
    const sourceLayer = layer["source-layer"];
    if (!sourceLayer) continue;
    const material = sourceLayer === "water" ? "water"
      : sourceLayer === "landuse" || sourceLayer === "landcover" ? "grass" : null;
    if (!material || !map.getSource(layer.source)) continue;
    const id = `atlas-material-${layer.id}`;
    if (map.getLayer(id)) continue;
    const filter: FillLayerSpecification["filter"] = material === "grass"
      ? ["all", ...(layer.filter ? [layer.filter] : []),
          ["match", ["get", "class"], ["grass", "park", "wood", "scrub", "pitch"], true, false]]
      : layer.filter;
    map.addLayer({
      id,
      type: "fill",
      source: layer.source,
      "source-layer": sourceLayer,
      ...(filter ? { filter } : {}),
      minzoom: Math.max(15, layer.minzoom ?? 0),
      ...(layer.maxzoom !== undefined ? { maxzoom: layer.maxzoom } : {}),
      ...(layer.layout ? { layout: layer.layout } : {}),
      paint: {
        "fill-pattern": MATERIAL_IMAGES[material],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 0.85],
      },
    }, layers[i + 1]?.id);
  }
}
