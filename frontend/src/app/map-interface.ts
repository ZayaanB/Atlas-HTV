import type {
  AircraftState,
  Article,
  Coverage,
  Evidence,
  FlightRegion,
  Location,
  WindSample,
} from "@atlas/contracts";

export type Coordinates = NonNullable<Location["coordinates"]>;
export type Bounds = NonNullable<Location["bounds"]>;
export type BasemapPreference = "auto" | "map" | "satellite";
export type FlightMode = "global" | "area" | "region";
export type CameraCommand = { id: string } & (
  | { type: "fit_bounds"; bounds: Bounds }
  | { type: "focus_point"; coordinates: Coordinates }
  | { type: "return_to_globe" }
  | { type: "zoom"; delta: number }
);
export interface ViewportSnapshot {
  userInitiated?: boolean;
  bounds: Bounds;
  center: Coordinates;
  zoom: number;
}
export interface MapSelection {
  articleId: string | null;
  locationId: string | null;
}
export interface MapDataStatus {
  state: "loading" | "error" | "empty" | "ready";
  refreshing: boolean;
  error: string | null;
  coverage: Coverage | null;
  missingLocationIds: readonly string[];
}
export interface FlightTrailSegment {
  aircraftId: string;
  coordinates: readonly Coordinates[];
  observedFrom: string;
  observedTo: string;
}
/** The integration boundary. Map internals do not import the store or fetch data. */
export interface AtlasMapProps {
  overlayInsets?: { top: number; right: number; bottom: number; left: number };
  evidenceOverlay?: { evidence: Evidence; url: string; opacity: number } | null;
  aircraft?: readonly AircraftState[];
  flightsEnabled?: boolean;
  flightMode?: FlightMode;
  flightCoverage?: FlightRegion | null;
  flightCoverageOversized?: boolean;
  flightAttribution?: string;
  flightTrails?: readonly FlightTrailSegment[];
  lastKnownAircraftIds?: readonly string[];
  selectedAircraftId?: string | null;
  windSamples?: readonly WindSample[];
  onSelectAircraft?: (id: string) => void;
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
