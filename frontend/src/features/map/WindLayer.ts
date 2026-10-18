import type { GeoJSONSource, Map } from "mapbox-gl";
import type { WindSample } from "@atlas/contracts";

const SOURCE = "atlas-wind-data";
export const WIND_LAYERS = ["atlas-wind-arrows", "atlas-wind-calm", "atlas-wind-speeds"];
const COLORS = [[167, 213, 255], [112, 223, 197], [245, 189, 111]] as const;
function arrowImage(color: readonly number[]) {
  const data = new Uint8Array(48 * 48 * 4);
  const lines = [[24, 39, 24, 8], [14, 18, 24, 8], [34, 18, 24, 8]];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const distance = Math.min(...lines.map(([ax, ay, bx, by]) => {
      const dx = bx! - ax!, dy = by! - ay!;
      const t = Math.max(0, Math.min(1, ((x - ax!) * dx + (y - ay!) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - ax! - t * dx, y - ay! - t * dy);
    }));
    const offset = (y * 48 + x) * 4, interior = distance <= 2;
    for (let c = 0; c < 3; c++) data[offset + c] = interior ? color[c]! : 10;
    data[offset + 3] = Math.round(Math.max(0, Math.min(1, 3.5 - distance)) * 255);
  }
  return { width: 48, height: 48, data };
}

export function windFeatures(samples: readonly WindSample[]) {
  return {
    type: "FeatureCollection" as const,
    features: samples.map(sample => ({
      type: "Feature" as const, id: sample.id,
      geometry: { type: "Point" as const, coordinates: sample.coordinates },
      properties: { speed_kmh: sample.speed_kmh, flow_heading: sample.direction_from_degrees === null ? null : (sample.direction_from_degrees + 180) % 360 },
    })),
  };
}
export function updateWind(map: Map, samples: readonly WindSample[] = []) {
  if (!samples.length) {
    for (const layer of WIND_LAYERS) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    return;
  }
  const data = windFeatures(samples);
  if (map.getSource(SOURCE)) (map.getSource(SOURCE) as GeoJSONSource).setData(data);
  else map.addSource(SOURCE, { type: "geojson", data });
  for (let i = 0; i < COLORS.length; i++) {
    const id = `atlas-wind-${i}`;
    if (!map.hasImage(id)) map.addImage(id, arrowImage(COLORS[i]!), { pixelRatio: 2 });
  }
  if (!map.getLayer(WIND_LAYERS[0]!)) map.addLayer({
    id: WIND_LAYERS[0]!, type: "symbol", source: SOURCE,
    filter: ["all", [">=", ["get", "speed_kmh"], 1], ["!=", ["get", "flow_heading"], null]],
    layout: {
      "icon-image": ["step", ["get", "speed_kmh"], "atlas-wind-0", 20, "atlas-wind-1", 40, "atlas-wind-2"],
      "icon-rotate": ["get", "flow_heading"], "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "viewport", "icon-allow-overlap": true, "icon-size": 1.3,
    },
  });
  if (!map.getLayer(WIND_LAYERS[1]!)) map.addLayer({
    id: WIND_LAYERS[1]!, type: "circle", source: SOURCE,
    filter: ["any", ["<", ["get", "speed_kmh"], 1], ["==", ["get", "flow_heading"], null]],
    paint: { "circle-radius": 4, "circle-color": "#a7d5ff", "circle-stroke-color": "#07090d", "circle-stroke-width": 2 },
  });
  if (!map.getLayer(WIND_LAYERS[2]!)) map.addLayer({
    id: WIND_LAYERS[2]!, type: "symbol", source: SOURCE,
    layout: {
      "text-field": ["concat", ["to-string", ["round", ["get", "speed_kmh"]]], " km/h"],
      "text-size": 12, "text-offset": [0, 1.8], "text-anchor": "top", "text-allow-overlap": true,
    },
    paint: { "text-color": "#e1edf5", "text-halo-color": "#07090d", "text-halo-width": 2 },
  });
}
