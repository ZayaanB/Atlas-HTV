import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClientProvider} from '@tanstack/react-query';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import research from '@atlas/contracts/examples/helene-research.json';
import {App} from '../src/app/App';
import {createWorkspaceStore, useWorkspace} from '../src/app/state';
import {AUDIENCE_STORAGE_KEY, audienceOptions, audienceProfiles, readAudiencePreference} from '../src/app/audience';
import type {AtlasMapProps} from '../src/app/map-interface';
import {createFixtureApi} from '../src/lib/fixture-api';
import {createQueryClient} from '../src/lib/queries';
import {readContract} from '../src/lib/validation';
import {words} from '../src/lib/presentation';

let mapProps: AtlasMapProps;
function MapProbe(props: AtlasMapProps) {mapProps=props; return <div aria-label="Test map" />;}
const investigation = readContract('InvestigationResponse',research.investigations[0]);
const resetVisit = () => useWorkspace.setState({...useWorkspace.getInitialState(),...readAudiencePreference()},true);
function mount(api=createFixtureApi()) {
  const client=createQueryClient();
  client.setDefaultOptions({queries:{retry:false,staleTime:Infinity}});
  return render(<QueryClientProvider client={client}><App api={api} MapComponent={MapProbe} /></QueryClientProvider>);
}
beforeEach(() => {localStorage.clear(); resetVisit();});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it.each(audienceOptions)('offers and locally remembers $label on the first visit',async option => {
  const user=userEvent.setup(); mount();
  const dialog=screen.getByRole('dialog',{name:'How will you use Atlas?'});
  expect(dialog).toHaveAttribute('aria-modal','true');
  expect(screen.getByRole('heading',{name:'How will you use Atlas?'})).toHaveFocus();
  expect(screen.getByLabelText('Atlas geographic news workspace')).toHaveAttribute('inert');
  await user.click(within(dialog).getByRole('button',{name:new RegExp(`^${option.label}`)}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Audience'})).toHaveValue(option.id);
  expect(screen.getByRole('combobox',{name:'Audience'})).toHaveFocus();
  expect(JSON.parse(localStorage.getItem(AUDIENCE_STORAGE_KEY)!)).toEqual({audience:option.id,onboardingComplete:true});
  expect(createWorkspaceStore().getState()).toMatchObject({audience:option.id,onboardingComplete:true});
});

it('skips to general public and enters directly on a returning visit',async()=>{
  const user=userEvent.setup(), view=mount();
  await user.click(screen.getByRole('button',{name:'Skip for now'}));
  expect(useWorkspace.getState()).toMatchObject({audience:'general_public',onboardingComplete:true});
  view.unmount(); resetVisit(); mount();
  expect(screen.queryByRole('dialog',{name:'How will you use Atlas?'})).not.toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'Audience'})).toHaveValue('general_public');
});

it('traps keyboard focus, lets Escape skip, and blocks workspace shortcuts during onboarding',async()=>{
  const user=userEvent.setup(); mount();
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByRole('button',{name:'Skip for now'})).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button',{name:/^General public/})).toHaveFocus();
  await user.keyboard('{Control>}k{/Control}');
  expect(useWorkspace.getState().panel).toBeNull();
  await user.keyboard('{Escape}');
  expect(useWorkspace.getState().onboardingComplete).toBe(true);
  expect(screen.getByRole('combobox',{name:'Audience'})).toHaveFocus();
});

it.each(['{bad json','{}','{"audience":"administrator","onboardingComplete":true}','{"audience":"journalist","onboardingComplete":false}'])('recovers from invalid stored preferences: %s',raw=>{
  localStorage.setItem(AUDIENCE_STORAGE_KEY,raw); resetVisit(); mount();
  expect(screen.getByRole('dialog',{name:'How will you use Atlas?'})).toBeInTheDocument();
  expect(useWorkspace.getState().audience).toBe('general_public');
});

it('keeps the session usable when storage reads or writes throw',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('quota');}});
  resetVisit(); const user=userEvent.setup(); mount();
  await user.click(screen.getByRole('button',{name:'Skip for now'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Preference kept for this visit only.')).toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox',{name:'Audience'}),'community_organization');
  expect(useWorkspace.getState()).toMatchObject({audience:'community_organization',onboardingComplete:true,audienceStorageAvailable:false});
});

it('preserves filters, camera, investigation, conversation and draft while switching audience; maps community API requests explicitly',async()=>{
  const user=userEvent.setup(), api=createFixtureApi();
  const assistant=vi.spyOn(api,'assistant'), news=vi.spyOn(api,'news');
  const store=useWorkspace.getState();
  store.setAudience('general_public'); store.applyFilters({themes:['flooding']});
  store.selectInvestigation(investigation.investigation.id);
  store.setViewport({bounds:[-83,35,-82,36],center:[-82.5,35.5],zoom:8,userInitiated:true});
  store.requestCamera({type:'focus_point',coordinates:[-82.5,35.5]});
  store.openPanel({view:'assistant'});
  mount(api);
  await waitFor(()=>expect(mapProps.articles.length).toBeGreaterThan(0));
  await user.type(screen.getByLabelText('Your question'),'What do the sources show?');
  await user.click(screen.getByRole('button',{name:/Send question/}));
  const answer=await screen.findByText(/Assistant explanation unavailable in historical fixture mode/);
  await user.type(screen.getByLabelText('Your question'),'Keep this draft');
  const before=useWorkspace.getState(), articleIds=mapProps.articles.map(a=>a.id), reads=news.mock.calls.length;
  await user.selectOptions(screen.getByRole('combobox',{name:'Audience'}),'community_organization');
  const after=useWorkspace.getState();
  for(const key of ['filters','viewport','selection','selectedInvestigationId','cameraCommand','contextRevision','panel'] as const) expect(after[key]).toEqual(before[key]);
  expect(mapProps.articles.map(a=>a.id)).toEqual(articleIds);
  expect(news).toHaveBeenCalledTimes(reads);
  expect(answer).toBeInTheDocument();
  expect(screen.getByText('What do the sources show?')).toBeInTheDocument();
  expect(screen.getByLabelText('Your question')).toHaveValue('Keep this draft');
  expect(screen.getByRole('combobox',{name:'Perspective'})).toHaveValue('community_organization');
  await user.click(screen.getByText('Suggested questions'));
  expect(screen.getByRole('button',{name:audienceProfiles.community_organization.questions[0]!})).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:/Send question/}));
  await waitFor(()=>expect(assistant).toHaveBeenCalledTimes(2));
  expect(assistant.mock.calls[1]![0]).toMatchObject({audience:'general_public',message:'Keep this draft',filters:before.filters,selected_investigation_id:before.selectedInvestigationId});
});

it('personalizes prompts and investigation section order without changing supplied facts, sources or access',async()=>{
  const user=userEvent.setup();
  useWorkspace.getState().setAudience('general_public');
  useWorkspace.getState().selectInvestigation(investigation.investigation.id);
  mount();
  act(()=>useWorkspace.getState().openPanel({view:'investigation'}));
  const region=await screen.findByRole('region',{name:'Investigation'});
  for(const option of audienceOptions) {
    await user.selectOptions(screen.getByRole('combobox',{name:'Audience'}),option.id);
    expect(within(region).getAllByRole('heading',{level:3}).map(h=>h.textContent)).toEqual(audienceProfiles[option.id].sections.map(words));
    for(const item of investigation.investigation.items) expect(within(region).getByText(item.text)).toBeInTheDocument();
    expect(within(region).getByRole('button',{name:'Sources'})).toBeEnabled();
    expect(within(region).getByRole('button',{name:'Timeline'})).toBeEnabled();
    expect(within(region).getByRole('button',{name:'Evidence'})).toBeEnabled();
  }
  act(()=>useWorkspace.getState().openPanel({view:'assistant'}));
  for(const option of audienceOptions) {
    await user.selectOptions(screen.getByRole('combobox',{name:'Audience'}),option.id);
    for(const question of audienceProfiles[option.id].questions) expect(screen.getByRole('button',{name:question})).toBeInTheDocument();
  }
});

it('keeps an audience control available in fullscreen News and preserves the current panel',async()=>{
  const user=userEvent.setup(); useWorkspace.getState().setAudience('general_public'); mount();
  await user.click(screen.getByRole('button',{name:'Open news'}));
  await user.click(screen.getByRole('button',{name:'Fullscreen news'}));
  const dialog=screen.getByRole('dialog',{name:'News'});
  await user.selectOptions(within(dialog).getByRole('combobox',{name:'Audience'}),'journalist');
  expect(useWorkspace.getState().audience).toBe('journalist');
  expect(dialog).toHaveClass('is-fullscreen');
});

it('uses one audience store without mutating any other workspace state',()=>{
  const store=createWorkspaceStore();
  store.getState().setAudience('journalist');
  const before=store.getState();
  store.getState().setAudience('investor');
  const after=store.getState();
  for(const key of Object.keys(before) as (keyof typeof before)[]) {
    if(!['audience','onboardingComplete','audienceStorageAvailable'].includes(key)) expect(after[key]).toBe(before[key]);
  }
});
