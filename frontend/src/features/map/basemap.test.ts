import type { Map as MapboxMap, LayerSpecification } from "mapbox-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILDINGS_LAYER_ID, installBuildings, localMapPitch, startLocalMapPerspective, styleFor } from "./basemap";
import type { BasemapPreference } from "../../app/map-interface";

describe("basemap zoom behavior", () => {
  it("honors manual choices across globe, automatic-switch, and street zoom levels", () => {
    for (const zoom of [-1, 3, 7.9, 8, 14, 15, 18]) {
      expect(styleFor("map", zoom)).toBe("map");
      expect(styleFor("satellite", zoom)).toBe("satellite");
    }
    expect(styleFor("auto", 7.9)).toBe("map");
    expect(styleFor("auto", 8)).toBe("satellite");
    expect(styleFor("auto", 18)).toBe("satellite");
  });

  it("reveals a bounded local perspective and flattens again on zoom-out or satellite", () => {
    expect(localMapPitch("map", 3)).toBe(0);
    expect(localMapPitch("map", 14)).toBe(0);
    expect(localMapPitch("map", 15)).toBe(25);
    expect(localMapPitch("map", 16)).toBe(50);
    expect(localMapPitch("map", 18)).toBe(50);
    expect(localMapPitch("satellite", 18)).toBe(0);
  });
});

describe("perspective after Mapbox gesture cleanup", () => {
  afterEach(() => vi.restoreAllMocks());
  function camera() {
    const events = new Map<string, Set<() => void>>();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    let moving = false;
    let zoom = 18;
    let pitch = 0;
    const easeTo = vi.fn((options: { pitch: number }) => { pitch = options.pitch; });
    const map = {
      on: (name: string, callback: () => void) => {
        if (!events.has(name)) events.set(name, new Set());
        events.get(name)!.add(callback);
      },
      off: (name: string, callback: () => void) => events.get(name)?.delete(callback),
      isMoving: () => moving,
      getZoom: () => zoom,
      getPitch: () => pitch,
      easeTo,
    } as unknown as MapboxMap;
    return {
      map, easeTo,
      emit: (name: string) => events.get(name)?.forEach((callback) => callback()),
      moving: (value: boolean) => { moving = value; },
      zoom: (value: number) => { zoom = value; },
      frame: () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(0));
      },
    };
  }

  it("starts the tilt after zoomend and moveend cleanup, and does not restart it", () => {
    const c = camera();
    const stop = startLocalMapPerspective(c.map, () => "map");
    c.emit("zoomend");
    c.emit("moveend");
    // Starting an ease inside either callback lets Mapbox's gesture cleanup cancel it.
    expect(c.easeTo).not.toHaveBeenCalled();
    c.frame();
    expect(c.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: 50 }));
    c.emit("moveend");
    c.frame();
    expect(c.easeTo).toHaveBeenCalledTimes(1);
    stop();
  });

  it("waits through inertia and uses the latest zoom and preference", () => {
    const c = camera();
    let preference: BasemapPreference = "map";
    const stop = startLocalMapPerspective(c.map, () => preference);
    c.emit("zoomend");
    c.moving(true);
    c.frame();
    expect(c.easeTo).not.toHaveBeenCalled();
    c.zoom(15);
    c.moving(false);
    c.emit("moveend");
    c.frame();
    expect(c.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 25 }));
    preference = "satellite";
    c.emit("style.load");
    c.frame();
    expect(c.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ pitch: 0 }));
    stop();
  });

  it("cancels pending work and listeners when the map is removed", () => {
    const c = camera();
    const stop = startLocalMapPerspective(c.map, () => "map");
    c.emit("zoomend");
    stop();
    c.frame();
    c.emit("style.load");
    c.emit("moveend");
    c.frame();
    expect(c.easeTo).not.toHaveBeenCalled();
  });
});

function basemap() {
  const layers: LayerSpecification[] = [
    { id: "building", type: "fill", source: "composite", "source-layer": "building" },
    { id: "road-label", type: "symbol", source: "composite", layout: { "text-field": "Road" } },
  ];
  const installed = new Set<string>();
  const addLayer = vi.fn((layer: LayerSpecification) => installed.add(layer.id));
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => installed.has(id),
    getSource: vi.fn(() => ({})),
    hasImage: vi.fn(() => true),
    addLayer,
  } as unknown as MapboxMap;
  return { map, layers, installed, addLayer };
}

describe("3D buildings across style reloads", () => {
  it("uses existing sourced heights below labels, avoids duplicates, and restores after reload", () => {
    const { map, installed, addLayer } = basemap();
    installBuildings(map, "map");
    expect(addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: BUILDINGS_LAYER_ID,
      type: "fill-extrusion",
      source: "composite",
      "source-layer": "building",
      minzoom: 15,
    }), "road-label");
    const layer = addLayer.mock.calls[0]![0];
    expect(layer).toHaveProperty("paint.fill-extrusion-height", [
      "interpolate", ["linear"], ["zoom"], 15, 0, 15.5,
      ["coalesce", ["get", "height"], 0],
    ]);
    installBuildings(map, "map");
    expect(addLayer).toHaveBeenCalledTimes(1);
    installed.clear(); // Mapbox removes custom layers when replacing the style.
    installBuildings(map, "satellite");
    expect(addLayer).toHaveBeenCalledTimes(1);
    installBuildings(map, "map");
    expect(addLayer).toHaveBeenCalledTimes(2);
  });

  it("keeps a usable basemap when building data is absent", () => {
    const { map, layers, addLayer } = basemap();
    layers.shift();
    installBuildings(map, "map");
    expect(addLayer).not.toHaveBeenCalled();
  });
});
