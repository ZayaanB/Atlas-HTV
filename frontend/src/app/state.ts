import { create } from "zustand";
import type {
  AssistantResponseV2,
  Location,
  NewsQuery,
  OpenTimelineArgs,
} from "@atlas/contracts";
import { isSearchableBounds, normalizeNewsQuery } from "../lib/api";
import {isAudience, readAudiencePreference, writeAudiencePreference, type Audience} from './audience';
import type {
  BasemapPreference,
  CameraCommand,
  Coordinates,
  MapSelection,
  ViewportSnapshot,
} from "./map-interface";

export type CameraIntent = CameraCommand extends infer Command
  ? Command extends CameraCommand
    ? Omit<Command, "id">
    : never
  : never;
export type PanelView =
  | "search"
  | "news"
  | "article"
  | "assistant"
  | "investigation"
  | "saved"
  | "coverage"
  | "coordinates"
  | "aircraft";
export interface PanelRoute {
  view: PanelView;
  id?: string | undefined;
}
export type InvestigationTab = "brief" | "timeline" | "evidence" | "sources";
export interface TimelineIntent {
  id: string;
  target: OpenTimelineArgs;
  label: AssistantResponseV2["resolved_range"];
}
export interface PreparedWorkspaceActions {
  filters?: NewsQuery;
  selection: MapSelection;
  investigationId: string | null;
  camera?: CameraIntent;
  timeline?: TimelineIntent;
  panel?: PanelRoute;
  aircraftId?: string;
  basemap?: BasemapPreference;
  layers?: { flights?: boolean; wind?: boolean };
}
type WorkspaceUndo = Pick<WorkspaceState, 'filters' | 'selection' | 'selectedInvestigationId' | 'selectedAircraftId' | 'basemap' | 'flightsEnabled' | 'windEnabled' | 'panel' | 'panelHistory' | 'investigationTab' | 'timelineIntent' | 'viewport'>;
export interface WorkspaceState {
  assistantOrigin: PanelRoute | null;
  activeTimeline: OpenTimelineArgs | null;
  setActiveTimeline: (target: OpenTimelineArgs) => void;
  flightsEnabled: boolean;
  windEnabled: boolean;
  setLayer: (layer: 'flights' | 'wind', enabled: boolean) => void;
  workspaceUndo: WorkspaceUndo | null;
  undoWorkspace: () => void;
  audience: Audience;
  onboardingComplete: boolean;
  audienceStorageAvailable: boolean;
  setAudience: (audience: Audience) => void;
  investigationTab: InvestigationTab;
  timelineIntent: TimelineIntent | null;
  filterUndo: NewsQuery | null;
  setInvestigationTab: (tab: InvestigationTab) => void;
  setTimelineIntent: (intent: TimelineIntent) => void;
  commitAssistant: (
    prepared: PreparedWorkspaceActions,
    revision: number,
  ) => boolean;
  undoFilters: () => void;
  panel: PanelRoute | null;
  panelHistory: PanelRoute[];
  sheetExpanded: boolean;
  openPanel: (route: PanelRoute, root?: boolean) => void;
  closePanel: () => void;
  backPanel: () => void;
  setSheetExpanded: (expanded: boolean) => void;
  filters: NewsQuery;
  selection: MapSelection;
  selectedInvestigationId: string | null;
  selectedAircraftId: string | null;
  basemap: BasemapPreference;
  viewport: ViewportSnapshot | null;
  inspectedCoordinates: Coordinates | null;
  cameraCommand: CameraCommand | null;
  contextRevision: number;
  applyFilters: (filters: NewsQuery) => void;
  setPage: (offset: number) => void;
  select: (selection: MapSelection) => void;
  selectAircraft: (id: string | null) => void;
  clearFlights: () => void;
  selectInvestigation: (id: string | null) => void;
  setBasemap: (basemap: BasemapPreference) => void;
  setViewport: (viewport: ViewportSnapshot) => void;
  searchArea: () => void;
  inspectCoordinates: (coordinates: Coordinates) => void;
  focusLocation: (location: Location) => void;
  requestCamera: (intent: CameraIntent) => void;
  acknowledgeCamera: (id: string) => void;
}

/** Factory gives each test/workspace independent state. No server data is persisted. */
export function createWorkspaceStore() {
  return create<WorkspaceState>((set, get) => ({
    assistantOrigin: null,
    activeTimeline: null,
    setActiveTimeline: target => set(s => {
      if (JSON.stringify(s.activeTimeline) === JSON.stringify(target)) return {};
      const requested = s.timelineIntent?.target;
      const fromAssistant = !!requested && requested.investigation_id === target.investigation_id && requested.series_id === target.series_id
        && (!requested.observed_from || requested.observed_from === target.observed_from) && (!requested.observed_to || requested.observed_to === target.observed_to);
      return { activeTimeline: target, ...(fromAssistant ? {} : { contextRevision: s.contextRevision + 1, workspaceUndo: null }) };
    }),
    flightsEnabled: false,
    windEnabled: false,
    workspaceUndo: null,
    setLayer: (layer, enabled) => set(s => ({
      [layer === 'flights' ? 'flightsEnabled' : 'windEnabled']: enabled,
      ...(!enabled && layer === 'flights' ? { selectedAircraftId: null } : {}),
      workspaceUndo: null, contextRevision: s.contextRevision + 1,
    })),
    undoWorkspace: () => {
      const previous = get().workspaceUndo;
      if (!previous) return;
      const { viewport, ...rest } = previous;
      set(s => ({ ...rest, workspaceUndo: null, filterUndo: null,
        cameraCommand: viewport ? { type: 'fit_bounds' as const, bounds: [...viewport.bounds] as typeof viewport.bounds, id: crypto.randomUUID() } : { type: 'return_to_globe' as const, id: crypto.randomUUID() },
        contextRevision: s.contextRevision + 1 }));
    },
    ...readAudiencePreference(),
    setAudience: (audience) => {
      if (!isAudience(audience)) return;
      set({audience,onboardingComplete:true,audienceStorageAvailable:writeAudiencePreference(audience)});
    },
    investigationTab: "brief",
    timelineIntent: null,
    filterUndo: null,
    setInvestigationTab: (investigationTab) => set(s => ({ investigationTab, contextRevision: s.contextRevision + 1, workspaceUndo: null })),
    setTimelineIntent: (timelineIntent) =>
      set((s) => ({ timelineIntent, contextRevision: s.contextRevision + 1 })),
    commitAssistant: (prepared, revision) => {
      if (get().contextRevision !== revision) return false;
      set((s) => ({
        workspaceUndo: Object.fromEntries(['filters', 'selection', 'selectedInvestigationId', 'selectedAircraftId', 'basemap', 'flightsEnabled', 'windEnabled', 'panel', 'panelHistory', 'investigationTab', 'timelineIntent', 'viewport'].map(key => [key, structuredClone(s[key as keyof WorkspaceState])])) as WorkspaceUndo,
        ...(prepared.filters
          ? {
              filters: prepared.filters,
              filterUndo: structuredClone(s.filters),
            }
          : {}),
        selection: prepared.selection,
        selectedInvestigationId: prepared.investigationId,
        ...(prepared.basemap ? { basemap: prepared.basemap } : {}),
        ...(prepared.layers?.flights !== undefined ? { flightsEnabled: prepared.layers.flights } : {}),
        ...(prepared.layers?.wind !== undefined ? { windEnabled: prepared.layers.wind } : {}),
        ...(prepared.aircraftId ? { selectedAircraftId: prepared.aircraftId } : prepared.layers?.flights === false ? { selectedAircraftId: null } : {}),
        ...(prepared.panel ? {
          panel: prepared.panel,
          panelHistory: s.panel ? [...s.panelHistory, s.panel].slice(-16) : s.panelHistory,
        } : {}),
        ...(prepared.camera
          ? { cameraCommand: { ...prepared.camera, id: crypto.randomUUID() } }
          : {}),
        ...(prepared.timeline
          ? {
              timelineIntent: prepared.timeline,
              investigationTab: "timeline" as const,
              panel: {
                view: "investigation" as const,
                id: prepared.timeline.target.investigation_id,
              },
              panelHistory: s.panel
                ? [...s.panelHistory, ...(s.panel.view === 'aircraft' ? [] : [s.panel])].slice(-16)
                : s.panelHistory,
              selectedAircraftId: null,
            }
          : {}),
        contextRevision: s.contextRevision + 1,
      }));
      return true;
    },
    undoFilters: () => {
      const previous = get().filterUndo;
      if (previous)
        set((s) => ({
          filters: previous,
          filterUndo: null,
          contextRevision: s.contextRevision + 1,
        }));
    },
    panel: null,
    panelHistory: [],
    sheetExpanded: false,
    openPanel: (panel, root = false) =>
      set((state) => ({
        panel,
        assistantOrigin: panel.view === 'assistant' ? (state.panel?.view === 'assistant' ? state.assistantOrigin : state.panel) : state.assistantOrigin,
        selectedAircraftId: panel.view === 'aircraft' ? panel.id ?? null : panel.view === 'assistant' ? state.selectedAircraftId : null,
        contextRevision: state.contextRevision + 1,
        workspaceUndo: null,
        panelHistory: root
          ? []
          : state.panel && state.panel.view !== 'aircraft'
            ? [...state.panelHistory, state.panel].slice(-16)
            : state.panelHistory,
      })),
    closePanel: () => set(s => ({ panel: null, selectedAircraftId: null, contextRevision: s.contextRevision + 1, workspaceUndo: null })),
    backPanel: () =>
      set((state) => ({
        panel: state.panelHistory.at(-1) ?? null,
        panelHistory: state.panelHistory.slice(0, -1),
        contextRevision: state.contextRevision + 1,
        workspaceUndo: null,
        selectedAircraftId: state.panelHistory.at(-1)?.view === 'aircraft' ? state.panelHistory.at(-1)?.id ?? null : null,
      })),
    setSheetExpanded: (sheetExpanded) => set({ sheetExpanded }),
    filters: { limit: 50, offset: 0 },
    selection: { articleId: null, locationId: null },
    selectedInvestigationId: null,
    selectedAircraftId: null,
    basemap: "map",
    viewport: null,
    inspectedCoordinates: null,
    cameraCommand: null,
    contextRevision: 0,
    applyFilters: (filters) =>
      set((state) => ({
        filters: normalizeNewsQuery({ ...filters, offset: 0 }),
        filterUndo: null,
        workspaceUndo: null,
        selection: { articleId: null, locationId: null },
        selectedInvestigationId: null,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    setPage: (offset) =>
      set((state) => ({
        filters: normalizeNewsQuery({ ...state.filters, offset }),
        filterUndo: null,
        workspaceUndo: null,
        selection: { articleId: null, locationId: null },
        selectedInvestigationId: null,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    select: (selection) =>
      set((state) => ({
        selection,
        workspaceUndo: null,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    selectAircraft: (selectedAircraftId) => set(s => ({ selectedAircraftId, contextRevision: s.contextRevision + 1, workspaceUndo: null })),
    clearFlights: () => set((state) => {
      const history = state.panelHistory.filter(route => route.view !== 'aircraft');
      return {
        selectedAircraftId: null,
        panel: state.panel?.view === 'aircraft' ? history.at(-1) ?? null : state.panel,
        panelHistory: state.panel?.view === 'aircraft' ? history.slice(0, -1) : history,
      };
    }),
    selectInvestigation: (selectedInvestigationId) =>
      set((state) => ({
        selectedInvestigationId,
        workspaceUndo: null,
        ...(selectedInvestigationId !== state.selectedInvestigationId
          ? { investigationTab: "brief" as const, timelineIntent: null }
          : {}),
        contextRevision: state.contextRevision + 1,
      })),
    setBasemap: (basemap) => set(s => ({ basemap, contextRevision: s.contextRevision + 1, workspaceUndo: null })),
    setViewport: (viewport) => set(s => ({ viewport,
      ...(viewport.userInitiated !== false && JSON.stringify(viewport) !== JSON.stringify(s.viewport) ? { contextRevision: s.contextRevision + 1, workspaceUndo: null } : {}),
    })),
    searchArea: () => {
      const { viewport, filters } = get();
      if (viewport && isSearchableBounds(viewport.bounds))
        get().applyFilters({ ...filters, bounds: [...viewport.bounds] });
    },
    inspectCoordinates: (inspectedCoordinates) => set({ inspectedCoordinates }),
    focusLocation: (location) => {
      if (location.bounds)
        get().requestCamera({
          type: "fit_bounds",
          bounds: [...location.bounds],
        });
      else if (location.coordinates)
        get().requestCamera({
          type: "focus_point",
          coordinates: [...location.coordinates],
        });
    },
    requestCamera: (intent) =>
      set(s => ({ cameraCommand: { ...intent, id: crypto.randomUUID() }, contextRevision: s.contextRevision + 1, workspaceUndo: null })),
    acknowledgeCamera: (id) =>
      set((state) =>
        state.cameraCommand?.id === id ? { cameraCommand: null } : {},
      ),
  }));
}
export const useWorkspace = createWorkspaceStore();
