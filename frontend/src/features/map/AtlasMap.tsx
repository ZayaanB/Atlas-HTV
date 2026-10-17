import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl, { type GeoJSONSourceSpecification } from 'mapbox-gl';
import type { Article, Location } from '@atlas/contracts';
import type { AtlasMapProps, CameraCommand, Coordinates } from '../../app/map-interface';
import 'mapbox-gl/dist/mapbox-gl.css';
import './AtlasMap.css';

const TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim();
const EXTENT_SOURCE_ID = 'atlas-extent-data';
const POINT_SOURCE_ID = 'atlas-point-data';
const FILL_ID = 'atlas-location-extents';
const LINE_ID = 'atlas-location-outline';
const CLUSTER_ID = 'atlas-location-clusters';
const CLUSTER_COUNT_ID = 'atlas-location-cluster-count';
const POINT_ID = 'atlas-location-points';
const EXTENT_LABEL_ID = 'atlas-extent-labels';
const POINT_LABEL_ID = 'atlas-point-labels';
const SATELLITE_ZOOM = 8;
const GLOBE_CENTER: Coordinates = [0, 16];

type LocationProperties = {
  locationId: string;
  name: string;
  precision: Location['precision'];
  articleIds: string[];
  selected: boolean;
};

type LocationGeometry =
  | { type: 'Point'; coordinates: Coordinates }
  | { type: 'Polygon'; coordinates: Coordinates[][] }
  | { type: 'MultiPolygon'; coordinates: Coordinates[][][] };
type LocationFeature = { type: 'Feature'; id: string; properties: LocationProperties; geometry: LocationGeometry };
type LocationCollection = { type: 'FeatureCollection'; features: LocationFeature[] };

function makeLocations(
  articles: readonly Article[],
  locations: readonly Location[],
  selectedArticleId: string | null,
  selectedLocationId: string | null
): LocationCollection {
  const selectedArticle = articles.find(article => article.id === selectedArticleId);
  const selectedLocations = new Set(selectedArticle?.location_ids ?? []);
  if (selectedLocationId) selectedLocations.add(selectedLocationId);

  const features: LocationFeature[] = [];
  for (const location of locations) {
    const articleIds = articles
      .filter(article => article.location_ids.includes(location.id))
      .map(article => article.id);
    const properties: LocationProperties = {
      locationId: location.id,
      name: location.name,
      precision: location.precision,
      articleIds,
      selected: selectedLocations.has(location.id)
    };

    // Broad records use only their sourced extent; their optional coordinates are not pins.
    if (location.precision === 'city' || location.precision === 'region') {
      const bounds = location.bounds;
      if (!bounds || bounds[0] === bounds[2] || bounds[1] >= bounds[3]) continue;
      const ring = (west: number, east: number): Coordinates[] => [
        [west, bounds[1]], [east, bounds[1]], [east, bounds[3]], [west, bounds[3]], [west, bounds[1]]
      ];
      const geometry: LocationGeometry = bounds[0] < bounds[2]
        ? { type: 'Polygon', coordinates: [ring(bounds[0], bounds[2])] }
        : { type: 'MultiPolygon', coordinates: [[ring(bounds[0], 180)], [ring(-180, bounds[2])]] };
      features.push({
        type: 'Feature',
        id: location.id,
        properties,
        geometry
      });
      continue;
    }

    // Precise records can be shown as points only when their source supplied coordinates.
    if (!location.coordinates) continue;
    features.push({
      type: 'Feature',
      id: location.id,
      properties,
      geometry: { type: 'Point', coordinates: location.coordinates }
    });
  }

  return { type: 'FeatureCollection', features };
}

function styleFor(preference: AtlasMapProps['basemap'], zoom: number): 'map' | 'satellite' {
  if (preference === 'satellite') return 'satellite';
  if (preference === 'map') return 'map';
  return zoom >= SATELLITE_ZOOM ? 'satellite' : 'map';
}

function styleUrl(style: 'map' | 'satellite') {
  return style === 'satellite'
    ? 'mapbox://styles/mapbox/satellite-streets-v12'
    : 'mapbox://styles/mapbox/dark-v11';
}

function installLocationLayers(map: mapboxgl.Map, data: LocationCollection) {
  const extentData: LocationCollection = { type: 'FeatureCollection', features: data.features.filter(feature => feature.geometry.type !== 'Point') };
  const pointData: LocationCollection = { type: 'FeatureCollection', features: data.features.filter(feature => feature.geometry.type === 'Point') };
  const upsertSource = (id: string, sourceData: LocationCollection, cluster = false) => {
    if (map.getSource(id)) {
      (map.getSource(id) as mapboxgl.GeoJSONSource).setData(sourceData as GeoJSONSourceSpecification['data']);
    } else {
      map.addSource(id, {
        type: 'geojson', data: sourceData as GeoJSONSourceSpecification['data'],
        ...(cluster ? { cluster: true, clusterRadius: 42, clusterMaxZoom: 9 } : {})
      });
    }
  };
  upsertSource(EXTENT_SOURCE_ID, extentData);
  upsertSource(POINT_SOURCE_ID, pointData, true);

  if (!map.getLayer(FILL_ID)) {
    map.addLayer({
      id: FILL_ID, type: 'fill', source: EXTENT_SOURCE_ID,
      paint: {
        'fill-color': ['case', ['boolean', ['get', 'selected'], false], '#e9c77e', '#a4c6b1'],
        'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.22, 0.11]
      }
    });
  }
  if (!map.getLayer(LINE_ID)) {
    map.addLayer({
      id: LINE_ID, type: 'line', source: EXTENT_SOURCE_ID,
      paint: {
        'line-color': ['case', ['boolean', ['get', 'selected'], false], '#f1cf86', '#a4c6b1'],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 2.5, 1.4],
        'line-dasharray': [2, 1.5]
      }
    });
  }
  if (!map.getLayer(POINT_ID)) {
    map.addLayer({
      id: CLUSTER_ID, type: 'circle', source: POINT_SOURCE_ID, filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#b9d0b1',
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 30, 23],
        'circle-stroke-color': '#14242d', 'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: CLUSTER_COUNT_ID, type: 'symbol', source: POINT_SOURCE_ID, filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 },
      paint: { 'text-color': '#172b31' }
    });
    map.addLayer({
      id: POINT_ID, type: 'circle', source: POINT_SOURCE_ID, filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#f1cf86', '#c8ddb8'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4, 8, 7, 14, 10],
        'circle-stroke-color': '#14242d',
        'circle-stroke-width': 2.5
      }
    });
  }
  if (!map.getLayer(EXTENT_LABEL_ID)) {
    map.addLayer({
      id: EXTENT_LABEL_ID, type: 'symbol', source: EXTENT_SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 12, 'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-allow-overlap': false
      },
      paint: { 'text-color': '#edf1e8', 'text-halo-color': '#14232d', 'text-halo-width': 1.5 }
    });
  }
  if (!map.getLayer(POINT_LABEL_ID)) {
    map.addLayer({
      id: POINT_LABEL_ID, type: 'symbol', source: POINT_SOURCE_ID, filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 12, 'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-allow-overlap': false
      },
      paint: { 'text-color': '#edf1e8', 'text-halo-color': '#14232d', 'text-halo-width': 1.5 }
    });
  }
}

function cameraZoom(command: Extract<CameraCommand, { type: 'focus_point' }>, locations: readonly Location[]) {
  const matching = locations.find(location =>
    location.coordinates?.[0] === command.coordinates[0] && location.coordinates?.[1] === command.coordinates[1]
  );
  if (matching?.precision === 'address' || matching?.precision === 'facility') return 13;
  if (matching?.precision === 'city') return 7;
  if (matching?.precision === 'region') return 5.5;
  return 10;
}

function articleForLocation(locationId: string, props: AtlasMapProps): string | null {
  if (props.selection.articleId && props.articles.some(article =>
    article.id === props.selection.articleId && article.location_ids.includes(locationId)
  )) return props.selection.articleId;
  return props.articles.find(article => article.location_ids.includes(locationId))?.id ?? null;
}

function coverageLabel(coverage: AtlasMapProps['status']['coverage']) {
  if (!coverage) return null;
  if (coverage.mode === 'fixture') return 'Historical fixture coverage · not live';
  if (coverage.mode === 'stored') return 'Stored corpus coverage · not a filtered result count';
  return 'Coverage metadata unavailable';
}

export function AtlasMap(props: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const propsRef = useRef(props);
  const dataRef = useRef<LocationCollection>({ type: 'FeatureCollection', features: [] });
  const currentStyleRef = useRef<'map' | 'satellite'>('map');
  const handledCommandsRef = useRef(new Set<string>());
  const programmaticMotionRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  propsRef.current = props;
  const locationData = useMemo(
    () => makeLocations(props.articles, props.locations, props.selection.articleId, props.selection.locationId),
    [props.articles, props.locations, props.selection.articleId, props.selection.locationId]
  );
  dataRef.current = locationData;

  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;

    mapboxgl.accessToken = TOKEN;
    const startingStyle = styleFor(propsRef.current.basemap, 1.6);
    currentStyleRef.current = startingStyle;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl(startingStyle),
      center: GLOBE_CENTER,
      zoom: 1.6,
      minZoom: 1,
      maxZoom: 18,
      projection: { name: 'globe' },
      attributionControl: true,
      cooperativeGestures: true,
      failIfMajorPerformanceCaveat: false
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

    let firstStyleLoad = true;
    const installStyle = () => {
      map.setProjection({ name: 'globe' });
      installLocationLayers(map, dataRef.current);
      setMapError(null);
      if (firstStyleLoad) {
        firstStyleLoad = false;
        setMapReady(true);
      }
    };
    const publishViewport = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      propsRef.current.onViewportChange({
        bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        center: map.getCenter().toArray() as Coordinates,
        zoom: map.getZoom()
      });
    };
    const synchronizeStyle = () => {
      if (!map.isStyleLoaded()) return;
      const nextStyle = styleFor(propsRef.current.basemap, map.getZoom());
      if (nextStyle === currentStyleRef.current) return;
      currentStyleRef.current = nextStyle;
      map.setStyle(styleUrl(nextStyle));
    };
    const moveEnd = () => {
      programmaticMotionRef.current = false;
      synchronizeStyle();
      publishViewport();
    };
    const click = (event: mapboxgl.MapMouseEvent) => {
      const rendered = map.queryRenderedFeatures(event.point, {
        layers: [FILL_ID, CLUSTER_ID, POINT_ID, EXTENT_LABEL_ID, POINT_LABEL_ID]
      }) as unknown as Array<{
        geometry: { type: string; coordinates?: unknown };
        properties: Record<string, unknown> | null;
      }>;
      const cluster = rendered.find(feature => typeof feature.properties?.cluster_id === 'number');
      if (cluster?.geometry.type === 'Point' && Array.isArray(cluster.geometry.coordinates)) {
        const source = map.getSource(POINT_SOURCE_ID) as mapboxgl.GeoJSONSource;
        const clusterId = cluster.properties?.cluster_id;
        if (typeof clusterId !== 'number') return;
        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error || typeof zoom !== 'number') return;
          map.easeTo({ center: cluster.geometry.coordinates as Coordinates, zoom });
        });
        return;
      }
      const locationId = rendered.find(feature => typeof feature.properties?.locationId === 'string')?.properties?.locationId;
      if (typeof locationId === 'string') {
        const current = propsRef.current;
        current.onSelect({ articleId: articleForLocation(locationId, current), locationId });
        return;
      }
      propsRef.current.onInspectCoordinates(event.lngLat.toArray() as Coordinates);
    };
    const mapErrorHandler = () => {
      // Mapbox error objects may contain request URLs with the public token; never surface or log them.
      setMapError('Mapbox could not load the map style. Check the public token and network connection.');
    };
    const stopProgrammaticMotion = () => {
      if (!programmaticMotionRef.current) return;
      map.stop();
      programmaticMotionRef.current = false;
      publishViewport();
    };

    map.on('style.load', installStyle);
    map.on('moveend', moveEnd);
    map.on('click', click);
    map.on('error', mapErrorHandler);
    const canvasContainer = map.getCanvasContainer();
    canvasContainer.addEventListener('pointerdown', stopProgrammaticMotion, { passive: true });
    canvasContainer.addEventListener('wheel', stopProgrammaticMotion, { passive: true });
    canvasContainer.addEventListener('keydown', stopProgrammaticMotion);

    return () => {
      canvasContainer.removeEventListener('pointerdown', stopProgrammaticMotion);
      canvasContainer.removeEventListener('wheel', stopProgrammaticMotion);
      canvasContainer.removeEventListener('keydown', stopProgrammaticMotion);
      map.off('style.load', installStyle);
      map.off('moveend', moveEnd);
      map.off('click', click);
      map.off('error', mapErrorHandler);
      map.remove();
      mapRef.current = null;
      programmaticMotionRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    installLocationLayers(map, locationData);
  }, [locationData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const nextStyle = styleFor(props.basemap, map.getZoom());
    if (nextStyle === currentStyleRef.current) return;
    currentStyleRef.current = nextStyle;
    map.setStyle(styleUrl(nextStyle));
  }, [props.basemap, mapReady]);

  useEffect(() => {
    const command = props.cameraCommand;
    const map = mapRef.current;
    if (!command || !map || !mapReady || handledCommandsRef.current.has(command.id)) return;

    handledCommandsRef.current.add(command.id);
    if (handledCommandsRef.current.size > 128) {
      const oldest = handledCommandsRef.current.values().next().value;
      if (oldest) handledCommandsRef.current.delete(oldest);
    }
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : 1400;
    if (command.type === 'fit_bounds') {
      programmaticMotionRef.current = true;
      map.fitBounds(command.bounds, { padding: 72, maxZoom: 9, duration });
    } else if (command.type === 'focus_point') {
      programmaticMotionRef.current = true;
      map.flyTo({ center: command.coordinates, zoom: cameraZoom(command, props.locations), duration, essential: reducedMotion });
    } else {
      programmaticMotionRef.current = true;
      map.easeTo({ center: GLOBE_CENTER, zoom: 1.6, bearing: 0, pitch: 0, duration, essential: reducedMotion });
    }
    props.onCameraCommandHandled(command.id);
  }, [mapReady, props.cameraCommand, props.locations, props.onCameraCommandHandled]);

  const mappedLocations = props.locations.filter(location =>
    (location.precision === 'city' || location.precision === 'region')
      ? Boolean(location.bounds && location.bounds[0] !== location.bounds[2] && location.bounds[1] < location.bounds[3])
      : Boolean(location.coordinates)
  );
  const coverage = coverageLabel(props.status.coverage);

  return <section className="atlas-map" aria-label="Geographic context map">
    <div className="atlas-map__canvas" ref={containerRef} role="region" aria-label="Mapbox map of sourced news locations" />
    {!TOKEN && <div className="atlas-map__notice" role="status">
      <strong>Mapbox token required</strong>
      <span>Set VITE_MAPBOX_ACCESS_TOKEN in the frontend .env.local file and restart Vite.</span>
    </div>}
    {mapError && <div className="atlas-map__notice" role="alert">
      <strong>Map unavailable</strong><span>{mapError}</span>
    </div>}
    {TOKEN && props.status.state === 'loading' && mappedLocations.length === 0 && <div className="atlas-map__loading" role="status">Loading sourced locations…</div>}
    <div className="atlas-map__legend" aria-label="Map legend">
      <span><i className="atlas-map__legend-point" /> Address or facility</span>
      <span><i className="atlas-map__legend-area" /> City or region extent</span>
      {props.status.refreshing && <span role="status">Refreshing locations…</span>}
      {coverage && <span>{coverage}</span>}
      {props.status.missingLocationIds.length > 0 && <span role="status">
        {props.status.missingLocationIds.length} location {props.status.missingLocationIds.length === 1 ? 'record is' : 'records are'} unresolved.
      </span>}
    </div>
    {props.status.state === 'error' && props.status.error && <p className="atlas-map__message" role="alert">{props.status.error}</p>}
    {props.status.state === 'empty' && <p className="atlas-map__message" role="status">No mapped news locations are available for this page.</p>}
    {props.status.state === 'ready' && mappedLocations.length === 0 && <p className="atlas-map__message" role="status">
      Articles loaded, but this page has no locations with usable sourced geometry.
    </p>}
    <details className="atlas-map__location-list">
      <summary>Locations on this page ({props.locations.length})</summary>
      {props.locations.length === 0 ? <p>No locations were returned.</p> : <ul>
        {props.locations.map(location => <li key={location.id}>
          <button type="button" aria-pressed={props.selection.locationId === location.id} disabled={!mappedLocations.includes(location)}
            onClick={() => props.onSelect({ articleId: articleForLocation(location.id, props), locationId: location.id })}>
            {location.name} <small>{location.precision}</small>
          </button>
          {!mappedLocations.includes(location) && <small> No sourced geometry</small>}
        </li>)}
      </ul>}
    </details>
  </section>;
}
