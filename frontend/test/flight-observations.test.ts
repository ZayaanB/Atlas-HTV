import { expect, it } from 'vitest';
import { canonicalFlightArea, distanceNm, FlightHistory, globalFlightGeometry, observationsConnect, splitDateline, viewportFlightArea } from '../src/lib/flight-observations';
import { aircraft, globalAircraft, INITIAL_TIME, viewport } from './flight-samples';

it('sizes geographic areas with wrapped coordinates, date lines, poles and globe-spanning bounds', () => {
  expect(viewportFlightArea(viewport)).toEqual({ query: { latitude: 43.7, longitude: -79.4, radius_nm: 8 }, oversized: false });
  expect(canonicalFlightArea({ latitude: 43.71, longitude: -79.41, radius_nm: 97 })).toEqual({ latitude: 43.7, longitude: -79.4, radius_nm: 100 });
  expect(canonicalFlightArea({ latitude: -0.04, longitude: 179.99, radius_nm: 1 }).longitude).toBe(-180);
  for (const bounds of [[-180,-90,180,90], [0,-90,360,90], [180,-90,-180,90]] as [number,number,number,number][]) {
    const result = viewportFlightArea({ ...viewport, bounds, center: [540, 0] });
    expect(result?.query).toEqual({ latitude: 0, longitude: -180, radius_nm: 100 });
    expect(result?.oversized).toBe(true);
  }
  expect(viewportFlightArea({ ...viewport, center: [180, 90], bounds: [179,89,-179,90] })?.query.radius_nm).toBeLessThanOrEqual(100);
  expect(viewportFlightArea({ ...viewport, center: [NaN, 0] })).toBeNull();
});
it('bounds session memory, prunes old data and never appends duplicates or older observations', () => {
  const history = new FlightHistory();
  for (let i = 0; i < 65; i++) history.ingest([aircraft('abc123', i * 1000)], INITIAL_TIME + 65_000);
  history.ingest([aircraft('abc123', 1000), aircraft('abc123', 64_000)], INITIAL_TIME + 65_000);
  expect(history.records.get('adsb.lol:abc123')).toHaveLength(60);
  expect(history.records.get('adsb.lol:abc123')?.[0]?.observed_at).toBe(aircraft('abc123', 5000).observed_at);
  history.ingest(Array.from({ length: 1001 }, (_, i) => aircraft(`id-${i}`, i + 70_000)), INITIAL_TIME + 80_000);
  expect(history.records.size).toBe(1000); expect(history.records.has('adsb.lol:abc123')).toBe(false);
  history.prune(INITIAL_TIME + 31 * 60_000); expect(history.records.size).toBe(1000);
  history.prune(INITIAL_TIME + 32 * 60_000); expect(history.records.size).toBe(0);
});
it('only connects real observations across safe intervals, identities and implied speeds', () => {
  const first = aircraft(), next = aircraft('abc123', 60_000, { coordinates: [-79.39,43.7] });
  expect(observationsConnect(first,next)).toBe(true);
  expect(observationsConnect(first,{...next,callsign:'DIFFERENT'})).toBe(false);
  expect(observationsConnect(first,aircraft('abc123', 120_001))).toBe(false);
  expect(observationsConnect(first,{...next,coordinates:[-60,40]})).toBe(false);
  const history = new FlightHistory();
  history.ingest([first,next,aircraft('abc123', 90_000, { callsign: 'NEW' }),aircraft('abc123', 150_000, { callsign: 'NEW', coordinates: [-79.39,43.7] })], INITIAL_TIME + 150_000);
  expect(history.trails([next])).toHaveLength(2);
});
it('splits date-line trails without globe-spanning edges or invented history samples', () => {
  expect(splitDateline([[179,1],[-179,3]])).toEqual([[[179,1],[180,2]],[[-180,2],[-179,3]]]);
  expect(splitDateline([[-179,1],[179,3]])).toEqual([[[-179,1],[-180,2]],[[180,2],[179,3]]]);
  const boundary = splitDateline([[180,0],[-180,1],[-179,2]]);
  expect(boundary).toEqual([[[180,0],[180,1]],[[-180,1],[-179,2]]]);
  const history = new FlightHistory();
  const first = aircraft('abc123',0,{coordinates:[179.99,0]}), last = aircraft('abc123',60_000,{coordinates:[-179.99,0]});
  history.ingest([first,last], INITIAL_TIME + 60_000);
  expect(history.trails([last])).toHaveLength(2); expect(history.records.get('adsb.lol:abc123')).toHaveLength(2);
});
it('prioritizes current aircraft within the authoritative circle and expires retained positions', () => {
  const history = new FlightHistory(), area = { id:'test', latitude:43.7,longitude:-79.4,radius_nm:100 };
  const old = Array.from({length:500},(_,i)=>aircraft(`old-${i}`));
  const current = Array.from({length:10},(_,i)=>aircraft(`current-${i}`,60_000));
  history.ingest([...old,...current,aircraft('outside',0,{coordinates:[0,0]})],INITIAL_TIME+60_000);
  const displayed = history.displayed(current,area,INITIAL_TIME+60_000);
  expect(displayed).toHaveLength(500); expect(displayed.slice(0,10).map(a=>a.id)).toEqual(current.map(a=>a.id));
  expect(displayed.some(a=>a.id==='outside')).toBe(false);
  expect(history.displayed([],area,INITIAL_TIME+300_001)).toHaveLength(10);
  expect(history.displayed([],area,INITIAL_TIME+360_001)).toHaveLength(0);
  expect(distanceNm([0,0],[1,0])).toBeCloseTo(60,0);
});
it('uses global eleven-minute continuity, flight identity and speed checks without changing regional rules', () => {
  const first = globalAircraft(), next = globalAircraft('abc123',300_000,{coordinates:[-79,43.7]});
  expect(observationsConnect(first,next,'global')).toBe(true);
  expect(observationsConnect(first,next,'area')).toBe(false);
  expect(observationsConnect(first,{...next,callsign:'CHANGED'},'global')).toBe(false);
  expect(observationsConnect(first,{...next,flight_iata:'OTHER'},'global')).toBe(false);
  expect(observationsConnect(first,globalAircraft('abc123',660_000),'global')).toBe(true);
  expect(observationsConnect(first,globalAircraft('abc123',660_001),'global')).toBe(false);
  expect(observationsConnect(first,{...next,coordinates:[0,0]},'global')).toBe(false);
});
it('prunes shared points to thirty minutes, breaks invalid segments and never restores missing markers', () => {
  const item = globalAircraft('abc123',0,{coordinates:[-179.99,0]});
  const point = (offset:number,extra:Partial<ReturnType<typeof globalAircraft>>={}) => {
    const a = globalAircraft('abc123',offset,{coordinates:[179.99,0],...extra});
    return {coordinates:a.coordinates,observed_at:a.observed_at,callsign:a.callsign,flight_iata:a.flight_iata??null};
  };
  const points = [point(-1_800_001),point(-1_800_000),point(-1_500_000),point(-600_000,{callsign:'NEW'}),point(-300_000),point(0,{coordinates:item.coordinates})];
  const geometry = globalFlightGeometry([item],[{aircraft_id:item.id,points},{aircraft_id:'missing',points}],INITIAL_TIME);
  expect(geometry.aircraft).toEqual([item]); expect(geometry.trails).toHaveLength(3);
  expect(geometry.trails[0]?.observedFrom).toBe(point(-1_800_000).observed_at);
  expect(geometry.trails.every(s=>s.aircraftId===item.id)).toBe(true);
  expect(globalFlightGeometry([item],[],INITIAL_TIME+600_001).aircraft).toEqual([]);
});
it.each([7500,25000])('preserves %i current global aircraft and all drawable eight-point histories', size => {
  const items=Array.from({length:size},(_,i)=>globalAircraft(i.toString(16).padStart(6,'0')));
  const trails=items.map(a=>({aircraft_id:a.id,points:Array.from({length:8},(_,i)=>({coordinates:a.coordinates,observed_at:new Date(INITIAL_TIME-(7-i)*240_000).toISOString(),callsign:a.callsign,flight_iata:a.flight_iata??null}))}));
  const geometry=globalFlightGeometry(items,trails,INITIAL_TIME);
  expect(geometry.aircraft).toHaveLength(size);expect(geometry.trails).toHaveLength(size);
  expect(geometry.trails.every(t=>t.coordinates.length===8)).toBe(true);
});
