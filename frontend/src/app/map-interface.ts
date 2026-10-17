import type { Article, Coverage, Location } from '@atlas/contracts';

export type Coordinates = NonNullable<Location['coordinates']>;
export type Bounds = NonNullable<Location['bounds']>;
export type BasemapPreference = 'auto' | 'map' | 'satellite';
export type CameraCommand = { id: string } & (
  | { type: 'fit_bounds'; bounds: Bounds }
  | { type: 'focus_point'; coordinates: Coordinates }
  | { type: 'return_to_globe' }
);
export interface ViewportSnapshot { bounds: Bounds; center: Coordinates; zoom: number }
export interface MapSelection { articleId: string | null; locationId: string | null }
export interface MapDataStatus {
  state: 'loading' | 'error' | 'empty' | 'ready';
  refreshing: boolean;
  error: string | null;
  coverage: Coverage | null;
  missingLocationIds: readonly string[];
}
/** The integration boundary. Map internals do not import the store or fetch data. */
export interface AtlasMapProps {
  articles: readonly Article[];
  locations: readonly Location[];
  status: MapDataStatus;
  selection: MapSelection;
  basemap: BasemapPreference;
  cameraCommand: CameraCommand | null;
  onSelect: (selection: MapSelection) => void;
  onInspectCoordinates: (coordinates: Coordinates) => void;
  onViewportChange: (viewport: ViewportSnapshot) => void;
  onCameraCommandHandled: (id: string) => void;
}
