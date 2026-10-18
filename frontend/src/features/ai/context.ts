import type { AircraftState, Article, AssistantWorkspaceSnapshotV3 } from '@atlas/contracts';
import type { WorkspaceState } from '../../app/state';
import type { FlightMode } from '../../app/map-interface';
import { windBounds } from '../../lib/wind';
import { readContract } from '../../lib/validation';

export interface AssistantEnvironment {
  flightAvailable: boolean;
  flightMode: FlightMode | null;
  flightRegion: string;
  flightFetchedAt: string | null;
  flightStale: boolean;
  aircraft: readonly AircraftState[];
  evidenceOverlay?: { id: string; opacity: number } | null;
}
export function captureWorkspace(state: WorkspaceState, articles: readonly Article[], environment?: AssistantEnvironment, windAvailable = false): AssistantWorkspaceSnapshotV3 {
  const area = windBounds(state.viewport);
  const origin = state.panel?.view === 'assistant' ? state.assistantOrigin : state.panel;
  return readContract('AssistantWorkspaceSnapshotV3', {
    revision: state.contextRevision, captured_at: new Date().toISOString(),
    viewport: state.viewport && area ? { bounds: area, center: [((state.viewport.center[0] + 180) % 360 + 360) % 360 - 180, state.viewport.center[1]], zoom: state.viewport.zoom } : null,
    filters: structuredClone(state.filters),
    selection: { article_id: state.selection.articleId, investigation_id: state.selectedInvestigationId, location_id: state.selection.locationId, aircraft_id: state.selectedAircraftId },
    origin: origin && origin.view !== 'assistant' ? { ...origin, ...(origin.view === 'investigation' ? { tab: state.investigationTab } : {}) } : null,
    visible_article_ids: (origin?.view === 'news' && origin.id ? articles.filter(row => row.location_ids.includes(origin.id!)) : articles).slice(0, 100).map(row => row.id),
    timeline: state.activeTimeline?.investigation_id === state.selectedInvestigationId ? state.activeTimeline
      : state.timelineIntent?.target.investigation_id === state.selectedInvestigationId ? { ...state.timelineIntent.target } : null,
    basemap: state.basemap, layers: { flights: state.flightsEnabled, wind: state.windEnabled },
    capabilities: { flights: environment?.flightAvailable ?? false, wind: windAvailable },
    flight_context: environment?.flightMode ? { mode: environment.flightMode, ...(environment.flightRegion ? { region_id: environment.flightRegion } : {}), fetched_at: environment.flightFetchedAt, stale: environment.flightStale } : null,
    evidence_overlay: environment?.evidenceOverlay ?? null,
  });
}
export function contextLabel(context: AssistantWorkspaceSnapshotV3): string {
  const count = context.visible_article_ids.length;
  const subject = context.origin?.view === 'article' ? 'Selected story' : context.origin?.view === 'aircraft' ? 'Selected aircraft'
    : context.origin?.view === 'investigation' ? context.origin.tab === 'timeline' ? 'Historical timeline' : 'Selected investigation'
    : context.viewport ? `Map near ${context.viewport.center[1].toFixed(1)}, ${context.viewport.center[0].toFixed(1)}` : 'Globe overview';
  return `${subject} · ${count} displayed ${count === 1 ? 'story' : 'stories'}`;
}
