import type { Map } from "mapbox-gl";
import type { BasemapPreference } from "../../app/map-interface";
import { MATERIAL_IMAGES } from "./materials";

export type BasemapStyle = "map" | "satellite";
const SATELLITE_ZOOM = 8;
export const BUILDINGS_ZOOM = 15;
export const BUILDINGS_LAYER_ID = "atlas-3d-buildings";

export function styleFor(preference: BasemapPreference, zoom: number): BasemapStyle {
  if (preference === "satellite") return "satellite";
  if (preference === "map") return "map";
  return zoom >= SATELLITE_ZOOM ? "satellite" : "map";
}

export function localMapPitch(style: BasemapStyle, zoom: number): number {
  return style === "map" ? Math.max(0, Math.min(50, (zoom - 14) * 25)) : 0;
}

/** Wait until Mapbox has finished gesture/inertia cleanup before starting a new ease. */
export function startLocalMapPerspective(map: Map, preference: () => BasemapPreference): () => void {
  let frame: number | null = null;
  let pending = false;
  const schedule = () => {
    if (!pending || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      // Inertia or another zoom may have started after zoomend. Its moveend retries.
      if (map.isMoving()) return;
      pending = false;
      const zoom = map.getZoom();
      const pitch = localMapPitch(styleFor(preference(), zoom), zoom);
      if (Math.abs(map.getPitch() - pitch) < 0.1) return;
      map.easeTo({
        pitch,
        duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 300,
        essential: false,
      });
    });
  };
  const request = () => {
    pending = true;
    schedule();
  };
  map.on("zoomend", request);
  map.on("style.load", request);
  map.on("moveend", schedule);
  return () => {
    map.off("zoomend", request);
    map.off("style.load", request);
    map.off("moveend", schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

/** Reinstalled on style.load, using only the basemap's existing building data. */
export function installBuildings(map: Map, style: BasemapStyle): void {
  if (style !== "map" || map.getLayer(BUILDINGS_LAYER_ID)) return;
  const layers = map.getStyle()?.layers ?? [];
  const buildings = layers.find(
    (layer) => "source-layer" in layer && layer["source-layer"] === "building" &&
      "source" in layer && typeof layer.source === "string",
  );
  if (!buildings || !("source" in buildings) || typeof buildings.source !== "string" ||
    !map.getSource(buildings.source)) return;
  const labels = layers.find(
    (layer) => layer.type === "symbol" && layer.layout?.["text-field"],
  );
  map.addLayer({
    id: BUILDINGS_LAYER_ID,
    type: "fill-extrusion",
    source: buildings.source,
    "source-layer": "building",
    filter: ["==", "extrude", "true"],
    minzoom: BUILDINGS_ZOOM,
    paint: {
      "fill-extrusion-color": "#687b92",
      ...(map.hasImage(MATERIAL_IMAGES.masonry)
        ? { "fill-extrusion-pattern": MATERIAL_IMAGES.masonry } : {}),
      "fill-extrusion-height": [
        "interpolate", ["linear"], ["zoom"],
        BUILDINGS_ZOOM, 0,
        BUILDINGS_ZOOM + 0.5, ["coalesce", ["get", "height"], 0],
      ],
      "fill-extrusion-base": [
        "interpolate", ["linear"], ["zoom"],
        BUILDINGS_ZOOM, 0,
        BUILDINGS_ZOOM + 0.5, ["coalesce", ["get", "min_height"], 0],
      ],
      "fill-extrusion-opacity": 0.85,
    },
  }, labels?.id);
}
