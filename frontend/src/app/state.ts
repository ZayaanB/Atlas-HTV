import { create } from 'zustand';
import type { Location, NewsQuery } from '@atlas/contracts';
import { isSearchableBounds, normalizeNewsQuery } from '../lib/api';
import type { BasemapPreference, CameraCommand, Coordinates, MapSelection, ViewportSnapshot } from './map-interface';

type CameraIntent = CameraCommand extends infer Command ? Command extends CameraCommand ? Omit<Command, 'id'> : never : never;
interface WorkspaceState {
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
    filters: { limit: 50, offset: 0 }, selection: { articleId: null, locationId: null },
    selectedInvestigationId: null, selectedAircraftId: null,
    basemap: 'auto', viewport: null, inspectedCoordinates: null, cameraCommand: null, contextRevision: 0,
    applyFilters: filters => set(state => ({
      filters: normalizeNewsQuery({ ...filters, offset: 0 }), selection: { articleId: null, locationId: null },
      cameraCommand: null,
      contextRevision: state.contextRevision + 1
    })),
    setPage: offset => set(state => ({
      filters: normalizeNewsQuery({ ...state.filters, offset }), selection: { articleId: null, locationId: null },
      cameraCommand: null,
      contextRevision: state.contextRevision + 1
    })),
    select: selection => set(state => ({ selection, cameraCommand: null, contextRevision: state.contextRevision + 1 })),
    selectAircraft: selectedAircraftId => set({ selectedAircraftId }),
    selectInvestigation: selectedInvestigationId => set(state => ({ selectedInvestigationId, contextRevision: state.contextRevision + 1 })),
    setBasemap: basemap => set({ basemap }),
    setViewport: viewport => set({ viewport }),
    searchArea: () => {
      const { viewport, filters } = get();
      if (viewport && isSearchableBounds(viewport.bounds)) get().applyFilters({ ...filters, bounds: [...viewport.bounds] });
    },
    inspectCoordinates: inspectedCoordinates => set({ inspectedCoordinates }),
    focusLocation: location => {
      if (location.bounds) get().requestCamera({ type: 'fit_bounds', bounds: [...location.bounds] });
      else if (location.coordinates) get().requestCamera({ type: 'focus_point', coordinates: [...location.coordinates] });
    },
    requestCamera: intent => set({ cameraCommand: { ...intent, id: crypto.randomUUID() } }),
    acknowledgeCamera: id => set(state => state.cameraCommand?.id === id ? { cameraCommand: null } : {})
  }));
}
export const useWorkspace = createWorkspaceStore();
