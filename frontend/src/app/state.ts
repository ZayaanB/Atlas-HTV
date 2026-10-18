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
}
export interface WorkspaceState {
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
    ...readAudiencePreference(),
    setAudience: (audience) => {
      if (!isAudience(audience)) return;
      set({audience,onboardingComplete:true,audienceStorageAvailable:writeAudiencePreference(audience)});
    },
    investigationTab: "brief",
    timelineIntent: null,
    filterUndo: null,
    setInvestigationTab: (investigationTab) => set({ investigationTab }),
    setTimelineIntent: (timelineIntent) =>
      set((s) => ({ timelineIntent, contextRevision: s.contextRevision + 1 })),
    commitAssistant: (prepared, revision) => {
      if (get().contextRevision !== revision) return false;
      set((s) => ({
        ...(prepared.filters
          ? {
              filters: prepared.filters,
              filterUndo: structuredClone(s.filters),
            }
          : {}),
        selection: prepared.selection,
        selectedInvestigationId: prepared.investigationId,
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
        selectedAircraftId: panel.view === 'aircraft' ? panel.id ?? null : null,
        panelHistory: root
          ? []
          : state.panel && state.panel.view !== 'aircraft'
            ? [...state.panelHistory, state.panel].slice(-16)
            : state.panelHistory,
      })),
    closePanel: () => set({ panel: null, selectedAircraftId: null }),
    backPanel: () =>
      set((state) => ({
        panel: state.panelHistory.at(-1) ?? null,
        panelHistory: state.panelHistory.slice(0, -1),
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
        selection: { articleId: null, locationId: null },
        selectedInvestigationId: null,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    setPage: (offset) =>
      set((state) => ({
        filters: normalizeNewsQuery({ ...state.filters, offset }),
        filterUndo: null,
        selection: { articleId: null, locationId: null },
        selectedInvestigationId: null,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    select: (selection) =>
      set((state) => ({
        selection,
        cameraCommand: null,
        contextRevision: state.contextRevision + 1,
      })),
    selectAircraft: (selectedAircraftId) => set({ selectedAircraftId }),
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
        ...(selectedInvestigationId !== state.selectedInvestigationId
          ? { investigationTab: "brief" as const, timelineIntent: null }
          : {}),
        contextRevision: state.contextRevision + 1,
      })),
    setBasemap: (basemap) => set({ basemap }),
    setViewport: (viewport) => set({ viewport }),
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
      set({ cameraCommand: { ...intent, id: crypto.randomUUID() } }),
    acknowledgeCamera: (id) =>
      set((state) =>
        state.cameraCommand?.id === id ? { cameraCommand: null } : {},
      ),
  }));
}
export const useWorkspace = createWorkspaceStore();
