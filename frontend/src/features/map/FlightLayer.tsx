import type mapboxgl from 'mapbox-gl';
import type { AircraftState, FlightRegion } from '@atlas/contracts';
import type { AtlasMapProps, Coordinates } from '../../app/map-interface';
import { normalizeLongitude, observationsConnect, splitDateline } from '../../lib/flight-observations';

const SOURCE = 'atlas-aircraft-data', TRAILS = 'atlas-flight-trails-data', COVERAGE = 'atlas-flight-coverage-data';
export const FLIGHT_LAYERS = ['atlas-aircraft-heading', 'atlas-aircraft-unknown'];
export const FLIGHT_DECORATION_LAYERS = ['atlas-flight-coverage', 'atlas-flight-trails', 'atlas-aircraft-selection'];
const YELLOW = '#F5D547';
interface Transition { from: Coordinates; track: number | null; start: number; }
interface Drawn { aircraft: AircraftState; coordinates: Coordinates; track: number | null; transition?: Transition; }
interface LayerState { drawn: Map<string, Drawn>; props: AtlasMapProps; frame: number | null; lastPaint: number; }
const states = new WeakMap<mapboxgl.Map, LayerState>();

/** Great-circle boundary, split at the date line; no filled disk. */
export function coverageCircle(area: FlightRegion): Coordinates[][] {
  const rad = Math.PI / 180, latitude = area.latitude * rad, longitude = area.longitude * rad, distance = area.radius_nm / 3440.065;
  const points: Coordinates[] = [];
  for (let i = 0; i <= 128; i++) {
    const bearing = i / 128 * 2 * Math.PI;
    const lat = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing));
    const lon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude), Math.cos(distance) - Math.sin(latitude) * Math.sin(lat));
    points.push([normalizeLongitude(lon / rad), lat / rad]);
  }
  return splitDateline(points);
}
export function interpolatedPosition(from: Coordinates, to: Coordinates, progress: number): Coordinates {
  return [normalizeLongitude(from[0] + normalizeLongitude(to[0] - from[0]) * progress), from[1] + (to[1] - from[1]) * progress];
}
export function interpolatedTrack(from: number, to: number, progress: number): number {
  return ((from + normalizeLongitude(to - from) * progress) % 360 + 360) % 360;
}
function advance(state: LayerState, time: number, reduced = false) {
  let moving = false;
  for (const item of state.drawn.values()) {
    const transition = item.transition;
    if (!transition) continue;
    const progress = reduced ? 1 : Math.min(1, Math.max(0, (time - transition.start) / 1000));
    item.coordinates = interpolatedPosition(transition.from, item.aircraft.coordinates, progress);
    item.track = transition.track == null || item.aircraft.heading == null ? item.aircraft.heading : interpolatedTrack(transition.track, item.aircraft.heading, progress);
    if (progress === 1) delete item.transition; else moving = true;
  }
  return moving;
}
function paint(map: mapboxgl.Map, state: LayerState) {
  const retained = new Set(state.props.lastKnownAircraftIds);
  (map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection', features: [...state.drawn.values()].map(item => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: item.coordinates },
      properties: { id: item.aircraft.id, heading: item.track, selected: item.aircraft.id === state.props.selectedAircraftId, lastKnown: retained.has(item.aircraft.id) },
    })),
  });
}
export function cancelFlightAnimation(map: mapboxgl.Map) {
  const state = states.get(map);
  if (state?.frame != null) cancelAnimationFrame(state.frame);
  if (state) state.frame = null;
}
export function removeFlights(map: mapboxgl.Map) {
  cancelFlightAnimation(map);
  states.delete(map);
  for (const id of [...FLIGHT_LAYERS, ...FLIGHT_DECORATION_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SOURCE, TRAILS, COVERAGE]) if (map.getSource(id)) map.removeSource(id);
  if (map.hasImage('atlas-plane')) map.removeImage('atlas-plane');
}
export function updateFlights(map: mapboxgl.Map, props: AtlasMapProps) {
  if (!props.flightsEnabled) { removeFlights(map); return; }
  const restored = !map.getSource(SOURCE);
  const state = states.get(map) ?? { drawn: new Map<string, Drawn>(), props, frame: null, lastPaint: -Infinity };
  const previousProps = state.props;
  const aircraftChanged = restored || previousProps.aircraft !== props.aircraft || previousProps.flightMode !== props.flightMode;
  const selectedChanged = previousProps.selectedAircraftId !== props.selectedAircraftId;
  const retainedChanged = previousProps.lastKnownAircraftIds !== props.lastKnownAircraftIds;
  const trailsChanged = restored || previousProps.flightTrails !== props.flightTrails || selectedChanged;
  const coverageChanged = restored || previousProps.flightCoverage !== props.flightCoverage || previousProps.flightMode !== props.flightMode;
  states.set(map, state);
  state.props = props;
  if (!aircraftChanged && !selectedChanged && !retainedChanged && !trailsChanged && !coverageChanged) return;
  const time = performance.now();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (aircraftChanged) {
    cancelFlightAnimation(map);
    advance(state, time, reduced);
    const incoming = new Set((props.aircraft ?? []).map(a => a.id));
    for (const id of state.drawn.keys()) if (!incoming.has(id)) state.drawn.delete(id);
    for (const aircraft of props.aircraft ?? []) {
      const previous = state.drawn.get(aircraft.id);
      if (!restored && previous?.aircraft === aircraft) continue;
      // Metadata-only refreshes must not interrupt an existing transition.
      if (!restored && previous && previous.aircraft.observed_at === aircraft.observed_at &&
        previous.aircraft.callsign === aircraft.callsign && previous.aircraft.flight_iata === aircraft.flight_iata &&
        previous.aircraft.coordinates[0] === aircraft.coordinates[0] && previous.aircraft.coordinates[1] === aircraft.coordinates[1] &&
        previous.aircraft.heading === aircraft.heading) { previous.aircraft = aircraft; continue; }
      const continuous = previous && !restored && !reduced && observationsConnect(previous.aircraft, aircraft, props.flightMode);
      state.drawn.set(aircraft.id, {
        aircraft,
        coordinates: continuous ? previous.coordinates : aircraft.coordinates,
        track: continuous ? previous.track : aircraft.heading,
        ...(continuous ? { transition: { from: previous.coordinates, track: previous.track, start: time } } : {}),
      });
    }
  }
  const upsert = (id: string, data: Exclude<mapboxgl.GeoJSONSourceSpecification['data'], string | undefined>) => {
    const source = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(data); else map.addSource(id, { type: 'geojson', data });
  };
  if (props.flightMode === 'global') {
    if (map.getLayer('atlas-flight-coverage')) map.removeLayer('atlas-flight-coverage');
    if (map.getSource(COVERAGE)) map.removeSource(COVERAGE);
  } else if (coverageChanged) upsert(COVERAGE, { type: 'FeatureCollection', features: props.flightCoverage ? coverageCircle(props.flightCoverage).map(coordinates => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {},
  })) : [] });
  if (trailsChanged) upsert(TRAILS, { type: 'FeatureCollection', features: (props.flightTrails ?? []).map(segment => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: segment.coordinates.map(c => [...c]) },
    properties: { id: segment.aircraftId, selected: segment.aircraftId === props.selectedAircraftId, observedFrom: segment.observedFrom, observedTo: segment.observedTo },
  })) });
  if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (props.flightMode !== 'global' && !map.getLayer('atlas-flight-coverage')) map.addLayer({
    id: 'atlas-flight-coverage', type: 'line', source: COVERAGE,
    paint: { 'line-color': YELLOW, 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [2, 3] },
  });
  if (!map.getLayer('atlas-flight-trails')) map.addLayer({
    id: 'atlas-flight-trails', type: 'line', source: TRAILS,
    paint: { 'line-color': YELLOW, 'line-width': ['case', ['get', 'selected'], 2.5, 1], 'line-opacity': ['case', ['get', 'selected'], 0.9, 0.3], 'line-dasharray': [2, 3] },
  });
  if (!map.getLayer('atlas-aircraft-selection')) map.addLayer({
    id: 'atlas-aircraft-selection', type: 'circle', source: SOURCE, filter: ['==', ['get', 'selected'], true],
    paint: { 'circle-radius': 13, 'circle-color': '#07090d', 'circle-opacity': 0.7, 'circle-stroke-width': 1.5, 'circle-stroke-color': YELLOW },
  });
  if (!map.hasImage('atlas-plane')) {
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(24, 5); ctx.lineTo(24, 40); ctx.moveTo(8, 28); ctx.lineTo(24, 16); ctx.lineTo(40, 28); ctx.moveTo(17, 41); ctx.lineTo(24, 35); ctx.lineTo(31, 41);
      ctx.strokeStyle = '#07090d'; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = YELLOW; ctx.lineWidth = 3; ctx.stroke();
      map.addImage('atlas-plane', ctx.getImageData(0, 0, 48, 48), { pixelRatio: 2 });
    }
  }
  if (!map.getLayer(FLIGHT_LAYERS[0]!) && map.hasImage('atlas-plane')) map.addLayer({
    id: FLIGHT_LAYERS[0]!, type: 'symbol', source: SOURCE, filter: ['!=', ['get', 'heading'], null],
    layout: { 'icon-image': 'atlas-plane', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-size': ['case', ['get', 'selected'], 1.3, 1] },
    paint: { 'icon-opacity': ['case', ['get', 'lastKnown'], 0.55, 1] },
  });
  if (!map.getLayer(FLIGHT_LAYERS[1]!)) map.addLayer({
    id: FLIGHT_LAYERS[1]!, type: 'circle', source: SOURCE, filter: ['==', ['get', 'heading'], null],
    paint: { 'circle-radius': ['case', ['get', 'selected'], 5.2, 4], 'circle-color': ['case', ['get', 'selected'], YELLOW, '#c2c7cf'], 'circle-opacity': ['case', ['get', 'lastKnown'], 0.55, 1], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#07090d' },
  });
  if (aircraftChanged || selectedChanged || retainedChanged) { paint(map, state); state.lastPaint = time; }
  const tick = (frameTime: number) => {
    state.frame = null;
    if (!map.getSource(SOURCE)) return;
    if (frameTime - state.lastPaint < 1000 / 30) { state.frame = requestAnimationFrame(tick); return; }
    const moving = advance(state, frameTime, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    paint(map, state);
    state.lastPaint = frameTime;
    if (moving) state.frame = requestAnimationFrame(tick);
  };
  if (state.frame === null && [...state.drawn.values()].some(item => item.transition)) state.frame = requestAnimationFrame(tick);
}
