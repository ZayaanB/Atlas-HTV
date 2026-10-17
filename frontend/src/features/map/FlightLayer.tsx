import type mapboxgl from "mapbox-gl";
import type { AtlasMapProps } from "../../app/map-interface";
const SOURCE = "atlas-aircraft-data";
export const FLIGHT_LAYERS = [
  "atlas-aircraft-heading",
  "atlas-aircraft-unknown",
];
export function updateFlights(map: mapboxgl.Map, props: AtlasMapProps) {
  const data = {
    type: "FeatureCollection" as const,
    features: (props.aircraft ?? []).map((a) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: a.coordinates },
      properties: {
        id: a.id,
        heading: a.heading,
        selected: a.id === props.selectedAircraftId,
      },
    })),
  };
  if (map.getSource(SOURCE))
    (map.getSource(SOURCE) as mapboxgl.GeoJSONSource).setData(data);
  else map.addSource(SOURCE, { type: "geojson", data });
  if (!map.hasImage("atlas-plane")) {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = "#a9d5ff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(24, 5);
      ctx.lineTo(24, 40);
      ctx.moveTo(8, 28);
      ctx.lineTo(24, 16);
      ctx.lineTo(40, 28);
      ctx.moveTo(17, 41);
      ctx.lineTo(24, 35);
      ctx.lineTo(31, 41);
      ctx.stroke();
      map.addImage("atlas-plane", ctx.getImageData(0, 0, 48, 48), {
        pixelRatio: 2,
      });
    }
  }
  if (!map.getLayer(FLIGHT_LAYERS[0]!) && map.hasImage("atlas-plane"))
    map.addLayer({
      id: FLIGHT_LAYERS[0]!,
      type: "symbol",
      source: SOURCE,
      filter: ["!=", ["get", "heading"], null],
      layout: {
        "icon-image": "atlas-plane",
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-size": ["case", ["get", "selected"], 1.3, 1],
      },
    });
  if (!map.getLayer(FLIGHT_LAYERS[1]!))
    map.addLayer({
      id: FLIGHT_LAYERS[1]!,
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "heading"], null],
      paint: {
        "circle-radius": ["case", ["get", "selected"], 7, 4],
        "circle-color": "#a9d5ff",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#07090d",
      },
    });
}
