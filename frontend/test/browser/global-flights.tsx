// Browser-only verification entry. Never imported by the production application.
// Run Vite with VITE_MAPBOX_ACCESS_TOKEN=synthetic-local-only; block external HTTP.
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import type { AircraftState, FlightGlobalResponse } from '@atlas/contracts';
import { App } from '../../src/app/App';
import { createFixtureApi } from '../../src/lib/fixture-api';
import { createHttpApi } from '../../src/lib/api';
import { createQueryClient } from '../../src/lib/queries';
import { readContract } from '../../src/lib/validation';
import { useWorkspace } from '../../src/app/state';
import '../../src/styles/global.css';

type Collection = { features: unknown[] };
const data = new Map<string, Collection>(), writes = new Map<string, number>();
let map: mapboxgl.Map;
mapboxgl.baseApiUrl = `${location.origin}/test/browser/mapbox-api`;
const localStyle = (): mapboxgl.StyleSpecification => ({
  version: 8, glyphs: `${location.origin}/test/browser/empty-glyphs/{fontstack}/{range}.pbf`, sources: {},
  layers: [{ id: 'local-background', type: 'background', paint: { 'background-color': '#101c26' } }],
});
// Exercise the real AtlasMap lifecycle with a local, credential-free style.
const OriginalMap = mapboxgl.Map;
mapboxgl.Map = class extends OriginalMap {
  constructor(options: mapboxgl.MapOptions) {
    super({ ...options, style: localStyle(), accessToken: '', localFontFamily: 'Arial', testMode: true, performanceMetricsCollection: false });
    map = this;
  }
  override setStyle(..._args: Parameters<mapboxgl.Map['setStyle']>) { return super.setStyle(localStyle(), {
    diff: false, localFontFamily: 'Arial', localIdeographFontFamily: undefined,
  }); }
  override addSource(...args: Parameters<mapboxgl.Map['addSource']>) {
    const result = super.addSource(...args), [id, spec] = args;
    if (spec.type === 'geojson') {
      data.set(id, spec.data as Collection);
      const source = this.getSource(id) as mapboxgl.GeoJSONSource;
      const setData = source.setData.bind(source);
      source.setData = (...values) => { data.set(id, values[0] as Collection); writes.set(id, (writes.get(id) ?? 0) + 1); return setData(...values); };
    }
    return result;
  }
  override removeSource(...args: Parameters<mapboxgl.Map['removeSource']>) { data.delete(args[0]); return super.removeSource(...args); }
};
let fetches = 0;
const baseTime = Date.now();
export function makeSnapshot(size: number, elapsed = 0): FlightGlobalResponse {
  const now = baseTime + elapsed, time = new Date(now).toISOString();
  const items: AircraftState[] = Array.from({ length: size }, (_, i) => ({
    id: i.toString(16).padStart(6, '0'), provider: 'airlabs', callsign: `SYN${String(i).padStart(5,'0')}`, flight_iata: `ZZ${i}`,
    registration: `TEST-${i}`, aircraft_type: null, operator: null, on_ground: false,
    airline_icao: 'ZZZ', airline_iata: 'ZZ', departure_iata: 'YYZ', arrival_iata: 'YVR',
    coordinates: i === 0 ? [-82.553 + elapsed / 300000 * 0.05, 35.595] : [-179 + (i * 137.508) % 358 + elapsed / 300000 * 0.05, -60 + (i * 17.13) % 120],
    altitude: 10000, altitude_unit: 'm', altitude_reference: 'unknown', speed: null, speed_unit: 'kn',
    heading: i % 10 === 1 ? null : i % 360, direction_kind: 'direction', observed_at: time, fetched_at: time,
    source_url: 'https://airlabs.co/', license: 'AirLabs-terms',
  }));
  return {
    snapshot_id: `airlabs-${now}`, items,
    trails: items.map(a => ({ aircraft_id: a.id, points: Array.from({ length: 8 }, (_, i) => ({
      coordinates: [a.coordinates[0] - (7-i)*0.01, a.coordinates[1]], observed_at: new Date(now - (7-i)*240000).toISOString(), callsign: a.callsign, flight_iata: a.flight_iata ?? null,
    })) })),
    fetched_at: time, status: 'ready', stale: false, truncated: size === 25000, mode: 'live', replay: false,
    attribution: 'Synthetic AirLabs protocol data · no provider contacted · incomplete coverage',
    retry_at: new Date(now+3600000).toISOString(), pause_reason: null, error: null,
  };
}
let response = makeSnapshot(7500);
const fixture = createFixtureApi(), http = createHttpApi(async (_url, options) => {
  fetches++;
  if (options?.signal?.aborted) throw new DOMException('Aborted','AbortError');
  return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
});
const api = { ...fixture, flightGlobal: http.flightGlobal!, workspace: async (signal: AbortSignal) => {
  const workspace = await fixture.workspace!(signal);
  return { ...workspace, capabilities: { ...workspace.capabilities, flights: false, flight_areas: false, flight_global: true } };
} };
const client = createQueryClient();
localStorage.setItem('atlas.audience.v1', JSON.stringify({ audience:'general_public', onboardingComplete:true }));
useWorkspace.getState().setAudience('general_public');
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App api={api}/></QueryClientProvider>);
const delay = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
const counts = () => Object.fromEntries([...data].map(([id,collection])=>[id,collection.features.length]));
const sourceWrites = () => Object.fromEntries(writes);
async function settled(size:number) {
  const start=performance.now();
  while (performance.now()-start<15000) {
    if (data.get('atlas-aircraft-data')?.features.length===size && map?.getSource('atlas-aircraft-data') && map?.getSource('atlas-flight-trails-data') && map.isSourceLoaded('atlas-aircraft-data') && map.isSourceLoaded('atlas-flight-trails-data') && !map.isMoving()) return;
    await delay(25);
  }
  throw new Error(`Sources did not settle: ${JSON.stringify(counts())}`);
}
async function load(size:number,elapsed=0) {
  const start=performance.now(); response=makeSnapshot(size,elapsed);
  const generated=performance.now(); readContract('FlightGlobalResponse',response);
  const validated=performance.now();
  client.setQueryData(['fixture','flight-global'],response);
  client.setQueryData(['fixture','flight-global','snapshot'],response);
  await settled(size); await delay(elapsed ? 1200 : 100);
  return {size,generateMs:generated-start,validationMs:validated-generated,settleMs:performance.now()-start,counts:counts(),writes:sourceWrites(),fetches};
}
declare global { interface Window { flightHarness: {
  load:typeof load; settled:typeof settled; map:()=>mapboxgl.Map; counts:typeof counts; writes:typeof sourceWrites;
  fetches:()=>number; snapshot:()=>FlightGlobalResponse; select:(id:string)=>void;
} } }
window.flightHarness={load,settled,map:()=>map,counts,writes:sourceWrites,fetches:()=>fetches,snapshot:()=>response,
  select:id=>useWorkspace.getState().openPanel({view:'aircraft',id}),
};
