import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FlightAreaQuery } from '@atlas/contracts';
import { App } from '../src/app/App';
import type { AtlasMapProps } from '../src/app/map-interface';
import { createWorkspaceStore, useWorkspace } from '../src/app/state';
import { createFixtureApi } from '../src/lib/fixture-api';
import { createQueryClient } from '../src/lib/queries';
import { aircraft, globalAircraft, globalSample, sample, viewport } from './flight-samples';
import { aircraftSearchIndex, findAircraftMatches } from '../src/features/flights/AircraftSearch';

let mapProps: AtlasMapProps;
const MapProbe=(props:AtlasMapProps)=>{mapProps=props;return <div aria-label="Synthetic map" />;};
beforeEach(()=>useWorkspace.setState(useWorkspace.getInitialState(),true));
function mount(areas: boolean | null = true, items = [aircraft('abc123',0,{callsign:null,registration:'C-TEST',heading:0}),aircraft('def456')], truncated = false) {
  const fixture=createFixtureApi(), now=new Date().toISOString();
  const flightArea=vi.fn(async (query:FlightAreaQuery)=>sample(items.map(a=>({...a,observed_at:now,fetched_at:now})),{truncated,fetched_at:now,retry_at:new Date(Date.now()+60_000).toISOString(),area:{...query,id:'synthetic-area'}}));
  const api={...fixture,flightArea,workspace:async(signal:AbortSignal)=>{const data=await fixture.workspace!(signal);return {...data,capabilities:{...data.capabilities,flights:true,...(areas===null?{}:{flight_areas:areas})},flight_regions:areas===null?[{...sample().area,id:'legacy'}]:[]};},flights:vi.fn(async()=>({items:[],region_id:'legacy',fetched_at:now,stale:false,mode:'live' as const,replay:false as const,attribution:'Synthetic legacy',retry_at:now,error:null}))};
  const client=createQueryClient();
  act(()=>useWorkspace.getState().setViewport(viewport));
  const result=render(<QueryClientProvider client={client}><App api={api} MapComponent={MapProbe}/></QueryClientProvider>);
  return {...result,api,client};
}
it('keeps one flight route, preserves research/camera, clears highlight on Back, and restores research when disabled',()=>{
  const store=createWorkspaceStore();const s=()=>store.getState();
  s().select({articleId:'article-test',locationId:'loc-test'});s().selectInvestigation('inv-test');s().openPanel({view:'investigation',id:'inv-test'});
  s().openPanel({view:'aircraft',id:'abc123'});s().openPanel({view:'aircraft',id:'def456'});
  expect(s().panelHistory).toEqual([{view:'investigation',id:'inv-test'}]);expect(s().selectedAircraftId).toBe('def456');
  expect(s().selection.articleId).toBe('article-test');expect(s().selectedInvestigationId).toBe('inv-test');expect(s().cameraCommand).toBeNull();
  s().backPanel();expect(s().panel?.view).toBe('investigation');expect(s().selectedAircraftId).toBeNull();
  s().openPanel({view:'aircraft',id:'abc123'});s().clearFlights();expect(s().panel?.view).toBe('investigation');
  expect(s().panelHistory.some(p=>p.view==='aircraft')).toBe(false);
  s().openPanel({view:'aircraft',id:'abc123'});s().closePanel();expect(s().selectedAircraftId).toBeNull();
});
it('shows a disabled Flights toggle when unavailable and legacy region controls only for old servers',async()=>{
  const user=userEvent.setup(),h=mount(false);
  await user.click(screen.getByRole('button',{name:'Map layers'}));
  expect(await screen.findByText('Flight coverage is not connected.')).toBeVisible();expect(screen.getByRole('checkbox',{name:'Flights'})).toBeDisabled();
  expect(h.api.flightArea).not.toHaveBeenCalled();h.unmount();h.client.clear();
  const legacy=mount(null);await user.click(screen.getByRole('button',{name:'Map layers'}));
  const region=await screen.findByRole('combobox',{name:'Reviewed region'});await user.selectOptions(region,'legacy');
  await user.click(screen.getByRole('checkbox',{name:'Flights'}));await waitFor(()=>expect(legacy.api.flights).toHaveBeenCalledTimes(1));
  expect(legacy.api.flightArea).not.toHaveBeenCalled();legacy.unmount();legacy.client.clear();
});
it('uses native aircraft selection and the same map selection action without replacing news/evidence or moving camera',async()=>{
  const user=userEvent.setup(),h=mount();
  await user.click(screen.getByRole('button',{name:'Open news'}));
  await user.click(screen.getByRole('button',{name:'Map layers'}));
  const toggle=screen.getByRole('checkbox',{name:'Flights'});expect(toggle).not.toBeChecked();
  await waitFor(()=>expect(toggle).toBeEnabled());await user.click(toggle);
  await waitFor(()=>expect(mapProps.aircraft).toHaveLength(2));
  expect(mapProps.articles.length).toBeGreaterThan(0);expect(mapProps.flightCoverage?.id).toBe('synthetic-area');
  await user.selectOptions(screen.getByRole('combobox',{name:'Select aircraft'}),'abc123');
  const details=await screen.findByRole('region',{name:'Selected aircraft'});
  expect(within(details).getByRole('heading',{name:'C-TEST'})).toBeVisible();expect(details).toHaveTextContent('Ground track');expect(details).toHaveTextContent('0°');
  expect(details).toHaveTextContent('OperatorUnknown');expect(details).not.toHaveTextContent('Heading');
  act(()=>mapProps.onSelectAircraft?.('def456'));expect(useWorkspace.getState().panelHistory).toEqual([{view:'news'}]);
  expect(mapProps.cameraCommand).toBeNull();await user.click(screen.getByRole('button',{name:'Back'}));
  expect(useWorkspace.getState().panel?.view).toBe('news');expect(mapProps.selectedAircraftId).toBeNull();
  act(()=>mapProps.onSelectAircraft?.('abc123'));await user.click(screen.getByRole('button',{name:'Map layers'}));
  await user.click(screen.getByRole('checkbox',{name:'Flights'}));
  expect(useWorkspace.getState().panel?.view).toBe('news');expect(mapProps.aircraft).toEqual([]);expect(mapProps.flightCoverage).toBeNull();
  expect(useWorkspace.getState().panelHistory.some(p=>p.view==='aircraft')).toBe(false);
  h.unmount();h.client.clear();
});
it('uses honest empty and truncated sample text',async()=>{
  const user=userEvent.setup(),h=mount(true,[],true);
  await user.click(screen.getByRole('button',{name:'Map layers'}));const toggle=screen.getByRole('checkbox',{name:'Flights'});
  await waitFor(()=>expect(toggle).toBeEnabled());await user.click(toggle);
  expect((await screen.findAllByText('No aircraft received in this sample.')).length).toBeGreaterThan(0);
  expect(screen.getByText('Limited sample · some aircraft were omitted.')).toBeVisible();
  expect(screen.queryByText('No flights')).not.toBeInTheDocument();h.unmount();h.client.clear();
});
function mountGlobal(items=[globalAircraft()], paused=false) {
  const fixture=createFixtureApi(),now=new Date().toISOString();
  const api={...fixture,flightGlobal:vi.fn(async()=>globalSample(items.map(a=>({...a,observed_at:now,fetched_at:now})),{
    fetched_at:now,truncated:true,retry_at:paused?null:new Date(Date.now()+300_000).toISOString(),pause_reason:paused?'quota':null,
  })),workspace:async(signal:AbortSignal)=>{const data=await fixture.workspace!(signal);return{...data,capabilities:{...data.capabilities,flights:false,flight_areas:false,flight_global:true}};}};
  const client=createQueryClient();
  const result=render(<QueryClientProvider client={client}><App api={api} MapComponent={MapProbe}/></QueryClientProvider>);
  return {...result,api,client};
}
it('enables global-only capability and supports local keyboard search, provider details and unchanged camera',async()=>{
  const user=userEvent.setup(),h=mountGlobal([globalAircraft('abc123',0,{registration:'C-TEST',heading:0}),globalAircraft('def456',0,{callsign:'SECOND'})]);
  await user.click(screen.getByRole('button',{name:'Open news'}));
  await user.click(screen.getByRole('button',{name:'Map layers'}));
  expect(await screen.findByRole('heading',{name:'Global airline traffic'})).toBeVisible();
  const toggle=screen.getByRole('checkbox',{name:'Flights'});expect(toggle).not.toBeChecked();await user.click(toggle);
  await waitFor(()=>expect(mapProps.aircraft).toHaveLength(2));
  expect(mapProps.flightMode).toBe('global');expect(mapProps.flightCoverage).toBeNull();expect(mapProps.lastKnownAircraftIds).toEqual([]);
  expect(screen.queryByText('Zoom in for aircraft coverage.')).not.toBeInTheDocument();expect(screen.queryByRole('combobox',{name:'Select aircraft'})).not.toBeInTheDocument();
  const search=screen.getByRole('searchbox',{name:'Find aircraft'});
  await user.type(search,'a');expect(within(screen.getByRole('list',{name:'Aircraft matches'})).queryAllByRole('button')).toHaveLength(0);
  await user.clear(search);await user.type(search,'C-TEST');await user.tab();await user.keyboard('{Enter}');
  const details=await screen.findByRole('region',{name:'Selected aircraft'});
  expect(details).toHaveTextContent('Direction0°');expect(details).toHaveTextContent('10,000 m · reference unknown');expect(details).toHaveTextContent('GroundspeedUnavailable');
  expect(details).toHaveTextContent('Airline code (ICAO)ABC');expect(details).toHaveTextContent('Reported departure (IATA)YYZ');
  expect(within(details).getByRole('link',{name:'AirLabs · Original source ↗'})).toHaveAttribute('href','https://airlabs.co/');
  expect(mapProps.cameraCommand).toBeNull();expect(mapProps.articles.length).toBeGreaterThan(0);expect(h.api.flightGlobal).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button',{name:'Back'}));expect(useWorkspace.getState().panel?.view).toBe('news');expect(mapProps.selectedAircraftId).toBeNull();
  h.unmount();h.client.clear();
});
it('caps global search at fifty local matches and searches flight IDs, callsigns, registration and hex case-insensitively',()=>{
  const index=aircraftSearchIndex(Array.from({length:100},(_,i)=>globalAircraft(`hex-${i}`,0,{callsign:`CALL${i}`,registration:`REG${i}`,flight_iata:`AB${i}`})));
  expect(findAircraftMatches(index,'a').matches).toEqual([]);
  expect(findAircraftMatches(index,'ab')).toMatchObject({more:true,matches:expect.any(Array)});
  expect(findAircraftMatches(index,'ab').matches).toHaveLength(50);
  for(const term of ['ab99','call99','reg99','HEX-99']) expect(findAircraftMatches(index,term).matches.map(a=>a.id)).toEqual(['hex-99']);
});
it('shows paused global coverage, a one-request retry and explicit limited-sample text',async()=>{
  const user=userEvent.setup(),h=mountGlobal([],true);
  await user.click(screen.getByRole('button',{name:'Map layers'}));
  const toggle=screen.getByRole('checkbox',{name:'Flights'});await waitFor(()=>expect(toggle).toBeEnabled());await user.click(toggle);
  expect((await screen.findAllByText('Flight updates paused: quota.')).length).toBeGreaterThan(0);
  expect(screen.getByText('Limited sample · some aircraft were omitted.')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Check again'}));await waitFor(()=>expect(h.api.flightGlobal).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Check again asks Atlas once. Provider pauses and the demo quota still apply.')).toBeVisible();
  h.unmount();h.client.clear();
});
