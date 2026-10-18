import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { type GeoJSONSourceSpecification } from "mapbox-gl";
import type { Article, Location } from "@atlas/contracts";
import type {
  AtlasMapProps,
  CameraCommand,
  Coordinates,
} from "../../app/map-interface";
import "mapbox-gl/dist/mapbox-gl.css";
import "./AtlasMap.css";
import { updateEvidence } from "./EvidenceLayer";
import { updateFlights, FLIGHT_LAYERS } from "./FlightLayer";
import { GLOBE_CENTER, homeZoom, homePadding } from "./style";
import { compactMapLabel, installStoryGlow, startStoryPulse, STORY_GLOW_ID } from "./news-points";

const TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const EXTENT_SOURCE_ID = "atlas-extent-data";
const POINT_SOURCE_ID = "atlas-point-data";
const FILL_ID = "atlas-location-extents";
const LINE_ID = "atlas-location-outline";
const CLUSTER_ID = "atlas-location-clusters";
const CLUSTER_COUNT_ID = "atlas-location-cluster-count";
const POINT_ID = "atlas-location-points";
const EXTENT_LABEL_ID = "atlas-extent-labels";
const POINT_LABEL_ID = "atlas-point-labels";
const SATELLITE_ZOOM = 8;

type LocationProperties = {
  locationId: string;
  name: string;
  label: string;
  precision: Location["precision"];
  articleIds: string[];
  selected: boolean;
  provisional: boolean;
};

type LocationGeometry =
  | { type: "Point"; coordinates: Coordinates }
  | { type: "Polygon"; coordinates: Coordinates[][] }
  | { type: "MultiPolygon"; coordinates: Coordinates[][][] };
type LocationFeature = {
  type: "Feature";
  id: string;
  properties: LocationProperties;
  geometry: LocationGeometry;
};
type LocationCollection = {
  type: "FeatureCollection";
  features: LocationFeature[];
};

export function makeLocations(
  articles: readonly Article[],
  locations: readonly Location[],
  selectedArticleId: string | null,
  selectedLocationId: string | null,
): LocationCollection {
  const selectedArticle = articles.find(
    (article) => article.id === selectedArticleId,
  );
  const selectedLocations = new Set(selectedArticle?.location_ids ?? []);
  if (selectedLocationId) selectedLocations.add(selectedLocationId);

  const features: LocationFeature[] = [];
  for (const location of locations) {
    const articleIds = articles
      .filter((article) => article.location_ids.includes(location.id))
      .map((article) => article.id);
    const properties: LocationProperties = {
      locationId: location.id,
      name: location.name,
      label: compactMapLabel(location.name),
      precision: location.precision,
      articleIds,
      selected: selectedLocations.has(location.id),
      provisional: location.verification_status === "unreviewed",
    };

    // Unreviewed provider locations (e.g. a GDACS event point with its alert box) are drawn at the point the
    // provider published, styled as provisional. Their box is a display extent, not an affected area, so it is
    // never filled as if it were the event footprint.
    if (location.verification_status === "unreviewed" && location.coordinates) {
      features.push({
        type: "Feature",
        id: location.id,
        properties,
        geometry: { type: "Point", coordinates: location.coordinates },
      });
      continue;
    }

    // Broad records use only their sourced extent; their optional coordinates are not pins.
    if (location.precision === "city" || location.precision === "region") {
      const bounds = location.bounds;
      if (!bounds || bounds[0] === bounds[2] || bounds[1] >= bounds[3])
        continue;
      const ring = (west: number, east: number): Coordinates[] => [
        [west, bounds[1]],
        [east, bounds[1]],
        [east, bounds[3]],
        [west, bounds[3]],
        [west, bounds[1]],
      ];
      const geometry: LocationGeometry =
        bounds[0] < bounds[2]
          ? { type: "Polygon", coordinates: [ring(bounds[0], bounds[2])] }
          : {
              type: "MultiPolygon",
              coordinates: [[ring(bounds[0], 180)], [ring(-180, bounds[2])]],
            };
      features.push({
        type: "Feature",
        id: location.id,
        properties,
        geometry,
      });
      continue;
    }

    // Precise records can be shown as points only when their source supplied coordinates.
    if (!location.coordinates) continue;
    features.push({
      type: "Feature",
      id: location.id,
      properties,
      geometry: { type: "Point", coordinates: location.coordinates },
    });
  }

  return { type: "FeatureCollection", features };
}

function styleFor(
  preference: AtlasMapProps["basemap"],
  zoom: number,
): "map" | "satellite" {
  if (preference === "satellite") return "satellite";
  if (preference === "map") return "map";
  return zoom >= SATELLITE_ZOOM ? "satellite" : "map";
}

function styleUrl(style: "map" | "satellite") {
  return style === "satellite"
    ? "mapbox://styles/mapbox/satellite-streets-v12"
    : "mapbox://styles/mapbox/dark-v11";
}

function installLocationLayers(map: mapboxgl.Map, data: LocationCollection) {
  const extentData: LocationCollection = {
    type: "FeatureCollection",
    features: data.features.filter(
      (feature) => feature.geometry.type !== "Point",
    ),
  };
  const pointData: LocationCollection = {
    type: "FeatureCollection",
    features: data.features.filter(
      (feature) => feature.geometry.type === "Point",
    ),
  };
  const upsertSource = (
    id: string,
    sourceData: LocationCollection,
    cluster = false,
  ) => {
    if (map.getSource(id)) {
      (map.getSource(id) as mapboxgl.GeoJSONSource).setData(
        sourceData as GeoJSONSourceSpecification["data"],
      );
    } else {
      map.addSource(id, {
        type: "geojson",
        data: sourceData as GeoJSONSourceSpecification["data"],
        ...(cluster
          ? { cluster: true, clusterRadius: 42, clusterMaxZoom: 9 }
          : {}),
      });
    }
  };
  upsertSource(EXTENT_SOURCE_ID, extentData);
  upsertSource(POINT_SOURCE_ID, pointData, true);

  if (!map.getLayer(FILL_ID)) {
    map.addLayer({
      id: FILL_ID,
      type: "fill",
      source: EXTENT_SOURCE_ID,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#9bd0ff",
          "#74b9ff",
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["get", "selected"], false],
          0.22,
          0.11,
        ],
      },
    });
  }
  if (!map.getLayer(LINE_ID)) {
    map.addLayer({
      id: LINE_ID,
      type: "line",
      source: EXTENT_SOURCE_ID,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#b5ddff",
          "#74b9ff",
        ],
        "line-width": [
          "case",
          ["boolean", ["get", "selected"], false],
          2.5,
          1.4,
        ],
        "line-dasharray": [2, 1.5],
      },
    });
  }
  if (!map.getLayer(POINT_ID)) {
    installStoryGlow(map, POINT_SOURCE_ID);
    map.addLayer({
      id: CLUSTER_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#74b9ff",
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 23],
        "circle-stroke-color": "#bbdfff",
        "circle-stroke-width": 1.5,
      },
    });
    map.addLayer({
      id: CLUSTER_COUNT_ID,
      type: "symbol",
      source: POINT_SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 11,
      },
      paint: { "text-color": "#172b31" },
    });
    map.addLayer({
      id: POINT_ID,
      type: "circle",
      source: POINT_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        // Preserve provider review status: amber rings versus solid reviewed blue.
        "circle-color": [
          "case",
          ["boolean", ["get", "selected"], false],
          "#dcefff",
          ["boolean", ["get", "provisional"], false],
          "#ffbd69",
          "#74b9ff",
        ],
        "circle-opacity": [
          "case",
          ["boolean", ["get", "provisional"], false],
          0.55,
          1,
        ],
        "circle-stroke-opacity": 1,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          5,
          8,
          7,
          14,
          10,
        ],
        "circle-stroke-color": [
          "case",
          ["boolean", ["get", "provisional"], false],
          "#ffcf91",
          "#b5ddff",
        ],
        "circle-stroke-width": 1.8,
      },
    });
  }
  if (map.getStyle().glyphs && !map.getLayer(EXTENT_LABEL_ID)) {
    map.addLayer({
      id: EXTENT_LABEL_ID,
      type: "symbol",
      source: EXTENT_SOURCE_ID,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 11,
        "text-max-width": 11,
        "text-line-height": 1.2,
        "text-padding": 6,
        "text-offset": [0, 1.15],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#edf1e8",
        "text-halo-color": "#14232d",
        "text-halo-width": 1.5,
      },
    });
  }
  if (map.getStyle().glyphs && !map.getLayer(POINT_LABEL_ID)) {
    map.addLayer({
      id: POINT_LABEL_ID,
      type: "symbol",
      source: POINT_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": 11,
        "text-max-width": 11,
        "text-line-height": 1.2,
        "text-padding": 6,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#edf1e8",
        "text-halo-color": "#14232d",
        "text-halo-width": 1.5,
      },
    });
  }
}

function cameraZoom(
  command: Extract<CameraCommand, { type: "focus_point" }>,
  locations: readonly Location[],
) {
  const matching = locations.find(
    (location) =>
      location.coordinates?.[0] === command.coordinates[0] &&
      location.coordinates?.[1] === command.coordinates[1],
  );
  if (matching?.precision === "address" || matching?.precision === "facility")
    return 13;
  if (matching?.precision === "city") return 7;
  if (matching?.precision === "region") return 5.5;
  return 10;
}

function articleForLocation(
  locationId: string,
  props: AtlasMapProps,
): string | null {
  const matches = props.articles.filter((article) =>
    article.location_ids.includes(locationId),
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function AtlasMap(props: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const propsRef = useRef(props);
  const dataRef = useRef<LocationCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const currentStyleRef = useRef<"map" | "satellite">("map");
  const styleReadyRef = useRef(false);
  const handledCommandsRef = useRef(new Set<string>());
  const programmaticMotionRef = useRef(false);
  const homeRef = useRef(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  propsRef.current = props;
  const locationData = useMemo(
    () =>
      makeLocations(
        props.articles,
        props.locations,
        props.selection.articleId,
        props.selection.locationId,
      ),
    [
      props.articles,
      props.locations,
      props.selection.articleId,
      props.selection.locationId,
    ],
  );
  dataRef.current = locationData;

  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;

    if (TOKEN) mapboxgl.accessToken = TOKEN;
    const startingZoom = homeZoom(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight,
      propsRef.current.overlayInsets,
    );
    const startingStyle = styleFor(propsRef.current.basemap, startingZoom);
    currentStyleRef.current = startingStyle;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: styleUrl(startingStyle),
        center: GLOBE_CENTER,
        zoom: startingZoom,
        minZoom: -1,
        maxZoom: 18,
        projection: { name: "globe" },
        attributionControl: true,
        cooperativeGestures: false,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      setMapError(
        "This browser could not start the globe. Source-linked reporting remains available.",
      );
      return;
    }
    mapRef.current = map;

    let firstStyleLoad = true;
    const installStyle = () => {
      styleReadyRef.current = true;
      map.setProjection({ name: "globe" });
      map.setFog({
        color: "#131b2a",
        "high-color": "#172a46",
        "space-color": "#07090d",
        "horizon-blend": 0.06,
        "star-intensity": 0.12,
      });
      installLocationLayers(map, dataRef.current);
      updateEvidence(map, propsRef.current.evidenceOverlay);
      updateFlights(map, propsRef.current);
      setMapError(null);
      if (firstStyleLoad) {
        firstStyleLoad = false;
        setMapReady(true);
      }
      // Reconcile a preference changed while the replacement style was loading.
      synchronizeStyle();
    };
    let userNavigation = false;
    const publishViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      propsRef.current.onViewportChange({
        userInitiated: userNavigation,
        bounds: [
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ],
        center: map.getCenter().toArray() as Coordinates,
        zoom: map.getZoom(),
      });
    };
    const synchronizeStyle = () => {
      if (!TOKEN || !styleReadyRef.current) return;
      const nextStyle = styleFor(propsRef.current.basemap, map.getZoom());
      if (nextStyle === currentStyleRef.current) return;
      currentStyleRef.current = nextStyle;
      styleReadyRef.current = false;
      map.setStyle(styleUrl(nextStyle));
    };
    const moveEnd = () => {
      programmaticMotionRef.current = false;
      synchronizeStyle();
      publishViewport();
      userNavigation = false;
    };
    const click = (event: mapboxgl.MapMouseEvent) => {
      const rendered = map.queryRenderedFeatures(event.point, {
        layers: [
          FILL_ID,
          CLUSTER_ID,
          POINT_ID,
          STORY_GLOW_ID,
          EXTENT_LABEL_ID,
          POINT_LABEL_ID,
          ...FLIGHT_LAYERS,
        ].filter((id) => !!map.getLayer(id)),
      }) as unknown as Array<{
        geometry: { type: string; coordinates?: unknown };
        properties: Record<string, unknown> | null;
      }>;
      const aircraftId = rendered.find(
        (feature) =>
          typeof feature.properties?.id === "string" &&
          (propsRef.current.aircraft ?? []).some(
            (a) => a.id === feature.properties?.id,
          ),
      )?.properties?.id;
      if (typeof aircraftId === "string") {
        propsRef.current.onSelectAircraft?.(aircraftId);
        return;
      }
      const cluster = rendered.find(
        (feature) => typeof feature.properties?.cluster_id === "number",
      );
      if (
        cluster?.geometry.type === "Point" &&
        Array.isArray(cluster.geometry.coordinates)
      ) {
        const source = map.getSource(POINT_SOURCE_ID) as mapboxgl.GeoJSONSource;
        const clusterId = cluster.properties?.cluster_id;
        if (typeof clusterId !== "number") return;
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error || typeof zoom !== "number") return;
          map.easeTo({
            center: cluster.geometry.coordinates as Coordinates,
            zoom,
          });
        });
        return;
      }
      const locationId = rendered.find(
        (feature) => typeof feature.properties?.locationId === "string",
      )?.properties?.locationId;
      if (typeof locationId === "string") {
        const current = propsRef.current;
        current.onSelect({
          articleId: articleForLocation(locationId, current),
          locationId,
        });
        return;
      }
      propsRef.current.onInspectCoordinates(
        event.lngLat.toArray() as Coordinates,
      );
    };
    const mapErrorHandler = () => {
      // Mapbox error objects may contain request URLs with the public token; never surface or log them.
      setMapError(
        "Mapbox could not load the map style. Check the public token and network connection.",
      );
    };
    const stopProgrammaticMotion = () => {
      if (!programmaticMotionRef.current) return;
      homeRef.current = false;
      map.stop();
      programmaticMotionRef.current = false;
      publishViewport();
    };

    const resize = () => {
      map.resize();
      if (homeRef.current)
        map.jumpTo({
          center: GLOBE_CENTER,
          zoom: homeZoom(
            containerRef.current?.clientWidth ?? window.innerWidth,
            containerRef.current?.clientHeight ?? window.innerHeight,
            propsRef.current.overlayInsets,
          ),
          padding: homePadding(
            containerRef.current?.clientWidth ?? window.innerWidth,
            propsRef.current.overlayInsets,
          ),
        });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);
    map.on("style.load", installStyle);
    const navigation = (event: mapboxgl.MapEvent) => {
      if ("originalEvent" in event && event.originalEvent) {
        userNavigation = true;
        homeRef.current = false;
      }
    };
    map.on("movestart", navigation);
    map.on("moveend", moveEnd);
    map.on("click", click);
    map.on("error", mapErrorHandler);
    const stopStoryPulse = startStoryPulse(map, () => styleReadyRef.current);
    const canvasContainer = map.getCanvasContainer();
    canvasContainer.addEventListener("pointerdown", stopProgrammaticMotion, {
      passive: true,
    });
    canvasContainer.addEventListener("wheel", stopProgrammaticMotion, {
      passive: true,
    });
    canvasContainer.addEventListener("keydown", stopProgrammaticMotion);

    return () => {
      stopStoryPulse();
      canvasContainer.removeEventListener(
        "pointerdown",
        stopProgrammaticMotion,
      );
      canvasContainer.removeEventListener("wheel", stopProgrammaticMotion);
      canvasContainer.removeEventListener("keydown", stopProgrammaticMotion);
      map.off("style.load", installStyle);
      map.off("movestart", navigation);
      map.off("moveend", moveEnd);
      map.off("click", click);
      map.off("error", mapErrorHandler);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
      programmaticMotionRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    // A paint animation / pending tiles can make isStyleLoaded false even
    // though our sources exist. Do not lose an incoming news page in that gap.
    // A replacement style installs the latest dataRef in its style.load hook.
    if (!map || !map.getSource(POINT_SOURCE_ID)) return;
    installLocationLayers(map, locationData);
  }, [locationData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!TOKEN || !map || !styleReadyRef.current) return;
    const nextStyle = styleFor(props.basemap, map.getZoom());
    if (nextStyle === currentStyleRef.current) return;
    currentStyleRef.current = nextStyle;
    styleReadyRef.current = false;
    map.setStyle(styleUrl(nextStyle));
  }, [props.basemap, mapReady]);

  useEffect(() => {
    const command = props.cameraCommand;
    const map = mapRef.current;
    if (
      !command ||
      !map ||
      !mapReady ||
      handledCommandsRef.current.has(command.id)
    )
      return;

    handledCommandsRef.current.add(command.id);
    if (handledCommandsRef.current.size > 128) {
      const oldest = handledCommandsRef.current.values().next().value;
      if (oldest) handledCommandsRef.current.delete(oldest);
    }
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 0 : 1100;
    const insets = props.overlayInsets ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const padding = {
      top: insets.top + 60,
      right: insets.right + 40,
      bottom: Math.min(
        insets.bottom + 90,
        (containerRef.current?.clientHeight ?? window.innerHeight) * 0.7,
      ),
      left: insets.left + 40,
    };
    if (command.type === "zoom") {
      homeRef.current = false;
      map.zoomTo(Math.max(-1, Math.min(18, map.getZoom() + command.delta)), {
        duration: reducedMotion ? 0 : 250,
      });
    } else if (command.type === "fit_bounds") {
      homeRef.current = false;
      programmaticMotionRef.current = true;
      map.fitBounds(command.bounds, { padding, maxZoom: 9, duration });
    } else if (command.type === "focus_point") {
      homeRef.current = false;
      programmaticMotionRef.current = true;
      map.flyTo({
        center: command.coordinates,
        zoom: cameraZoom(command, props.locations),
        padding,
        duration,
        essential: false,
      });
    } else {
      homeRef.current = true;
      programmaticMotionRef.current = true;
      map.easeTo({
        center: GLOBE_CENTER,
        zoom: homeZoom(
          containerRef.current?.clientWidth ?? window.innerWidth,
          containerRef.current?.clientHeight ?? window.innerHeight,
          insets,
        ),
        padding: homePadding(
          containerRef.current?.clientWidth ?? window.innerWidth,
          insets,
        ),
        bearing: 0,
        pitch: 0,
        duration,
        essential: false,
      });
    }
    props.onCameraCommandHandled(command.id);
  }, [
    mapReady,
    props.cameraCommand,
    props.locations,
    props.onCameraCommandHandled,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReadyRef.current) updateEvidence(map, props.evidenceOverlay);
  }, [mapReady, props.evidenceOverlay]);
  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReadyRef.current) updateFlights(map, props);
  }, [mapReady, props.aircraft, props.selectedAircraftId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (homeRef.current) {
      map.easeTo({
        center: GLOBE_CENTER,
        zoom: homeZoom(
          containerRef.current?.clientWidth ?? window.innerWidth,
          containerRef.current?.clientHeight ?? window.innerHeight,
          props.overlayInsets,
        ),
        padding: homePadding(
          containerRef.current?.clientWidth ?? window.innerWidth,
          props.overlayInsets,
        ),
        duration: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? 0
          : 220,
      });
    } else {
      const inset = props.overlayInsets ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
      map.easeTo({
        padding: {
          top: inset.top + 40,
          right: inset.right + 40,
          bottom: Math.min(
            inset.bottom + 90,
            (containerRef.current?.clientHeight ?? window.innerHeight) * 0.7,
          ),
          left: inset.left + 40,
        },
        duration: 0,
      });
    }
  }, [mapReady, props.overlayInsets]);
  const mappedLocations = props.locations.filter((location) =>
    location.precision === "city" || location.precision === "region"
      ? Boolean(
          location.bounds &&
            location.bounds[0] !== location.bounds[2] &&
            location.bounds[1] < location.bounds[3],
        )
      : Boolean(location.coordinates),
  );

  return (
    <section className="atlas-map" aria-label="Geographic context map">
      <div
        className="atlas-map__canvas"
        ref={containerRef}
        role="region"
        aria-label="Mapbox map of sourced news locations"
      />
      {!TOKEN && (
        <div className="atlas-map__notice" role="status">
          <strong>Globe unavailable</strong>
          <span>
            Map access is not configured. Explore the source-linked reporting
            and research while the basemap is unavailable.
          </span>
        </div>
      )}
      {mapError && (
        <div className="atlas-map__notice" role="alert">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
        </div>
      )}
      {TOKEN &&
        props.status.state === "loading" &&
        mappedLocations.length === 0 && (
          <div className="atlas-map__loading" role="status">
            Loading sourced locations…
          </div>
        )}
      {props.evidenceOverlay?.evidence.imagery && (
        <p className="atlas-map__evidence-attribution">
          {props.evidenceOverlay.evidence.observed_from?.slice(0, 10)} ·{" "}
          {props.evidenceOverlay.evidence.imagery.attribution}
        </p>
      )}
      {props.status.state === "empty" && (
        <p className="atlas-map__message" role="status">
          No mapped reporting on this page. Open Search to broaden the filters.
        </p>
      )}
      {props.status.state === "ready" && mappedLocations.length === 0 && (
        <p className="atlas-map__message" role="status">
          Reporting is available, but no sourced geometry is linked to this
          page.
        </p>
      )}
    </section>
  );
}
