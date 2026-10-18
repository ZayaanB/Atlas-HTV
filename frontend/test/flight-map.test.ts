import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type mapboxgl from 'mapbox-gl';
import { coverageCircle, interpolatedPosition, interpolatedTrack, updateFlights, removeFlights, cancelFlightAnimation, FLIGHT_LAYERS, FLIGHT_DECORATION_LAYERS } from '../src/features/map/FlightLayer';
import type { AtlasMapProps } from '../src/app/map-interface';
import { distanceNm, globalFlightGeometry } from '../src/lib/flight-observations';
import { aircraft, globalAircraft, INITIAL_TIME, sample, stamp } from './flight-samples';

let frames: Map<number, FrameRequestCallback>, clock = 0, sequence = 0, reduced = false;
beforeEach(() => {
  frames = new Map(); clock = 0; sequence = 0; reduced = false;
  vi.spyOn(performance,'now').mockImplementation(()=>clock);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});
  vi.stubGlobal('cancelAnimationFrame',(frame:number)=>frames.delete(frame));
  vi.stubGlobal('matchMedia',()=>({matches:reduced}));
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({beginPath(){},moveTo(){},lineTo(){},stroke(){},getImageData(){return {width:48,height:48,data:new Uint8ClampedArray(48*48*4)};}} as unknown as CanvasRenderingContext2D);
});
afterEach(()=>vi.unstubAllGlobals());
function mockMap() {
  const sources = new Map<string,{data:unknown;setData:(data:unknown)=>void}>(), layers = new Map<string,mapboxgl.LayerSpecification>(), images = new Set<string>();
  const map = {
    getSource:(id:string)=>sources.get(id),
    addSource:(id:string,options:{data:unknown})=>{sources.set(id,{data:options.data,setData(data){this.data=data;}});},
    removeSource:(id:string)=>sources.delete(id),
    getLayer:(id:string)=>layers.get(id), addLayer:(layer:mapboxgl.LayerSpecification)=>layers.set(layer.id,layer), removeLayer:(id:string)=>layers.delete(id),
    hasImage:(id:string)=>images.has(id),addImage:(id:string)=>images.add(id),removeImage:(id:string)=>images.delete(id),
  } as unknown as mapboxgl.Map;
  return {map,sources,layers,images};
}
const props = (extra:Partial<AtlasMapProps>={}):AtlasMapProps=>({
  flightsEnabled:true, aircraft:[aircraft()],flightCoverage:sample().area,
  flightTrails:[{aircraftId:'abc123',coordinates:[[-79.41,43.7],[-79.4,43.7]],observedFrom:'2026-10-17T11:59:00Z',observedTo:'2026-10-17T12:00:00Z'}],
  articles:[],locations:[],status:{state:'ready',refreshing:false,error:null,coverage:null,missingLocationIds:[]},selection:{articleId:null,locationId:null},basemap:'map',cameraCommand:null,
  onSelect(){},onInspectCoordinates(){},onViewportChange(){},onCameraCommandHandled(){},...extra,
});
function position(sources:ReturnType<typeof mockMap>['sources']) {
  return (sources.get('atlas-aircraft-data')!.data as {features:{geometry:{coordinates:number[]};properties:{heading:number}}[]}).features[0]!;
}
function tick(time:number){clock=time;const entries=[...frames];frames.clear();for(const [,callback] of entries) callback(time);}
it('draws a spherical coverage boundary with no filled disk, including poles and date lines',()=>{
  for(const area of [sample().area,{...sample().area,latitude:0,longitude:179.8,radius_nm:100},{...sample().area,latitude:90}]) {
    const parts=coverageCircle(area);expect(parts.length).toBeGreaterThan(0);
    for(const part of parts) for(let i=0;i<part.length;i++){
      const point=part[i]!;expect(point.every(Number.isFinite)).toBe(true);
      expect(Math.abs(point[0])).toBeLessThanOrEqual(180);expect(Math.abs(point[1])).toBeLessThanOrEqual(90);
      if(i) expect(Math.abs(point[0]-part[i-1]![0])).toBeLessThanOrEqual(180);
    }
    expect(distanceNm(parts[0]![0]!,[area.longitude,area.latitude])).toBeCloseTo(area.radius_nm,4);
  }
});
it('installs dashed yellow trails below selected aircraft, restores sources after style changes, and clears on disable',()=>{
  const {map,sources,layers,images}=mockMap();const p=props({selectedAircraftId:'abc123'});updateFlights(map,p);
  const trail=layers.get('atlas-flight-trails') as mapboxgl.LineLayerSpecification;
  expect(trail.paint).toMatchObject({'line-color':'#F5D547','line-dasharray':[2,3],'line-width':['case',['get','selected'],2.5,1],'line-opacity':['case',['get','selected'],0.9,0.3]});
  expect((layers.get(FLIGHT_LAYERS[0]!) as mapboxgl.SymbolLayerSpecification).layout?.['icon-size']).toEqual(['case',['get','selected'],1.3,1]);
  expect([...layers.keys()].indexOf('atlas-flight-trails')).toBeLessThan([...layers.keys()].indexOf(FLIGHT_LAYERS[0]!));
  expect([...layers.values()].some(layer=>layer.type==='fill')).toBe(false);
  expect(FLIGHT_LAYERS.some(id=>FLIGHT_DECORATION_LAYERS.includes(id))).toBe(false);
  sources.clear();layers.clear();images.clear();updateFlights(map,p);
  expect(sources.size).toBe(3);expect(layers.size).toBe(5);expect(images.has('atlas-plane')).toBe(true);
  updateFlights(map,{...p,flightsEnabled:false});expect(sources.size).toBe(0);expect(layers.size).toBe(0);expect(frames.size).toBe(0);
});
it('interpolates short longitude/track paths and interrupts from the current drawing without changing observations',()=>{
  const {map,sources}=mockMap();const first=aircraft('abc123',0,{coordinates:[179.99,0],heading:350});
  updateFlights(map,props({aircraft:[first]}));
  const next=aircraft('abc123',60_000,{coordinates:[-179.99,0],heading:10});updateFlights(map,props({aircraft:[next]}));
  tick(500);expect(Math.abs(position(sources).geometry.coordinates[0]!)).toBeCloseTo(180,4);expect(position(sources).properties.heading).toBeCloseTo(0,4);
  const third=aircraft('abc123',120_000,{coordinates:[-179.97,0],heading:30});updateFlights(map,props({aircraft:[third]}));
  expect(Math.abs(position(sources).geometry.coordinates[0]!)).toBeCloseTo(180,4);
  tick(1000);expect(position(sources).geometry.coordinates[0]).toBeCloseTo(-179.985,4);
  expect(next.coordinates).toEqual([-179.99,0]);expect(third.coordinates).toEqual([-179.97,0]);
  removeFlights(map);expect(frames.size).toBe(0);
  expect(interpolatedPosition([179,0],[-179,2],0.5)).toEqual([-180,1]);expect(interpolatedTrack(350,10,0.5)).toBe(0);
});
it('snaps across broken segments and for reduced motion, and cancels frames before style replacement/unmount',()=>{
  const {map,sources}=mockMap();updateFlights(map,props());
  updateFlights(map,props({aircraft:[aircraft('abc123',60_000,{coordinates:[-79.39,43.7]})]}));expect(frames.size).toBe(1);
  cancelFlightAnimation(map);expect(frames.size).toBe(0);
  updateFlights(map,props({aircraft:[aircraft('abc123',120_000,{coordinates:[-79.38,43.7],callsign:'CHANGED'})]}));
  expect(frames.size).toBe(0);expect(position(sources).geometry.coordinates).toEqual([-79.38,43.7]);
  reduced=true;updateFlights(map,props({aircraft:[aircraft('abc123',180_000,{coordinates:[-79.37,43.7],callsign:'CHANGED'})]}));
  expect(frames.size).toBe(0);expect(position(sources).geometry.coordinates).toEqual([-79.37,43.7]);
});
it('never installs global coverage, connects five-minute observations and snaps on changed flight identity',()=>{
  const {map,sources,layers,images}=mockMap();
  const first=globalAircraft();const p=props({flightMode:'global',flightCoverage:null,aircraft:[first],selectedAircraftId:first.id});
  updateFlights(map,p);expect(sources.has('atlas-flight-coverage-data')).toBe(false);expect(layers.has('atlas-flight-coverage')).toBe(false);
  const next=globalAircraft(first.id,300_000,{coordinates:[-79.3,43.7]});updateFlights(map,{...p,aircraft:[next]});
  expect(frames.size).toBe(1);tick(500);expect(position(sources).geometry.coordinates[0]).toBeCloseTo(-79.35);
  updateFlights(map,{...p,aircraft:[globalAircraft(first.id,600_000,{flight_iata:'NEW',coordinates:[-79.2,43.7]})]});
  expect(frames.size).toBe(0);expect(position(sources).geometry.coordinates).toEqual([-79.2,43.7]);
  sources.clear();layers.clear();images.clear();updateFlights(map,p);
  expect(sources.size).toBe(2);expect(layers.size).toBe(4);expect(position(sources).properties).toMatchObject({selected:true});
  expect(sources.has('atlas-flight-coverage-data')).toBe(false);
  removeFlights(map);
});
it('limits animation source writes to thirty per second and does no idle source or frame work',()=>{
  const {map,sources}=mockMap();const p=props({flightMode:'global',aircraft:[globalAircraft()]});updateFlights(map,p);
  const markerWrites=vi.spyOn(sources.get('atlas-aircraft-data')!,'setData');
  const trailWrites=vi.spyOn(sources.get('atlas-flight-trails-data')!,'setData');
  updateFlights(map,{...p,flightAttribution:'Only copy changed'});
  expect(markerWrites).not.toHaveBeenCalled();expect(trailWrites).not.toHaveBeenCalled();expect(frames.size).toBe(0);
  const next={...p,aircraft:[globalAircraft('abc123',300_000,{coordinates:[-79.3,43.7]})]};updateFlights(map,next);
  markerWrites.mockClear();
  for(let time=10;time<=1000;time+=10) tick(time);
  expect(markerWrites.mock.calls.length).toBeLessThanOrEqual(30);expect(frames.size).toBe(0);expect(trailWrites).not.toHaveBeenCalled();
  markerWrites.mockClear();updateFlights(map,next);tick(2000);
  expect(markerWrites).not.toHaveBeenCalled();expect(frames.size).toBe(0);
});
it.each([7500,25000])('keeps all %i global markers and eight-point trails through selection and style restoration',size=>{
  const {map,sources,layers,images}=mockMap();
  const items=Array.from({length:size},(_,i)=>globalAircraft(i.toString(16).padStart(6,'0')));
  const trails=items.map(a=>({aircraft_id:a.id,points:Array.from({length:8},(_,i)=>({coordinates:a.coordinates,observed_at:stamp(-(7-i)*240_000),callsign:a.callsign,flight_iata:a.flight_iata??null}))}));
  const geometry=globalFlightGeometry(items,trails,INITIAL_TIME);
  const p=props({flightMode:'global',flightCoverage:null,aircraft:geometry.aircraft,flightTrails:geometry.trails,selectedAircraftId:items.at(-1)!.id});
  const counts=()=>[...sources.values()].map(source=>(source.data as {features:unknown[]}).features.length);
  updateFlights(map,p);expect(counts()).toEqual([size,size]);expect(frames.size).toBe(0);
  const writes=[...sources.values()].map(source=>vi.spyOn(source,'setData'));
  updateFlights(map,{...p,flightAttribution:'Age text only'});expect(writes.every(spy=>spy.mock.calls.length===0)).toBe(true);
  sources.clear();layers.clear();images.clear();updateFlights(map,p);expect(counts()).toEqual([size,size]);
  expect(frames.size).toBe(0);removeFlights(map);expect(sources.size).toBe(0);
});
