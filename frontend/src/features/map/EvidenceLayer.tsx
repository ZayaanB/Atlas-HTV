import type mapboxgl from "mapbox-gl";
import type { AtlasMapProps } from "../../app/map-interface";
const SOURCE = "atlas-evidence",
  LAYER = "atlas-evidence-image";
export function updateEvidence(
  map: mapboxgl.Map,
  overlay: AtlasMapProps["evidenceOverlay"],
) {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  if (!overlay?.evidence.imagery) return;
  const [w, s, e, n] = overlay.evidence.imagery.bounds;
  map.addSource(SOURCE, {
    type: "image",
    url: overlay.url,
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
  });
  map.addLayer(
    {
      id: LAYER,
      type: "raster",
      source: SOURCE,
      paint: { "raster-opacity": overlay.opacity, "raster-fade-duration": 0 },
    },
    map.getLayer("atlas-location-extents")
      ? "atlas-location-extents"
      : undefined,
  );
}
