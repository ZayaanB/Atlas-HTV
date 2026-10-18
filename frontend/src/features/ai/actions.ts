import type { QueryClient } from "@tanstack/react-query";
import type {
  Article,
  AssistantResponseV2,
  InvestigationResponse,
  OpenTimelineArgs,
  UIActionV2,
  UIActionV3,
  AircraftState,
} from "@atlas/contracts";
import type { PreparedWorkspaceActions, WorkspaceState } from "../../app/state";
import type { AtlasApi } from "../../lib/api";
import { isSearchableBounds, normalizeNewsQuery } from "../../lib/api";
import { locationOptions } from "../../lib/queries";
import { readContract } from "../../lib/validation";
import { GLOBAL_POSITION_TTL, POSITION_TTL } from '../../lib/flight-observations';

export function validateRange(from?: string, to?: string) {
  if (
    (from && !Number.isFinite(Date.parse(from))) ||
    (to && !Number.isFinite(Date.parse(to))) ||
    (from &&
      to &&
      (Date.parse(to) < Date.parse(from) ||
        Date.parse(to) - Date.parse(from) > 366 * 86400000))
  )
    throw new Error(
      "Choose an ordered observation period of at most 366 days.",
    );
}
export async function resolveTimeline(
  api: AtlasApi,
  client: QueryClient,
  raw: OpenTimelineArgs,
  signal: AbortSignal,
) {
  const target = readContract("OpenTimelineArgs", raw);
  validateRange(target.observed_from, target.observed_to);
  if (!api.investigation) throw new Error("Investigations are not connected.");
  const data = readContract(
    "InvestigationResponse",
    await client.fetchQuery({
      queryKey: [api.mode, "investigation", target.investigation_id],
      retry: false,
      queryFn: async ({ signal: querySignal }) =>
        readContract(
          "InvestigationResponse",
          await api.investigation!(
            target.investigation_id,
            AbortSignal.any([signal, querySignal]),
          ),
        ),
    }),
  );
  signal.throwIfAborted();
  if (data.investigation.id !== target.investigation_id)
    throw new Error("The investigation response has a mismatched ID.");
  const series = data.observation_series.find((s) => s.id === target.series_id);
  if (
    !series ||
    !data.investigation.series_ids.includes(series.id) ||
    !data.sources.some((s) => s.id === series.source_id) ||
    !data.locations.some((l) => l.id === series.location_id)
  )
    throw new Error(
      "The requested timeline is not linked to a verified series and source.",
    );
  if (Date.parse(series.coverage_to) < Date.parse(series.coverage_from))
    throw new Error("The series coverage is reversed.");
  // A series can span decades. Its coverage need not fit a single bounded request.
  return { target: structuredClone(target), data };
}
export async function prepareActions(
  api: AtlasApi,
  client: QueryClient,
  actions: readonly (UIActionV2 | UIActionV3)[],
  snapshot: WorkspaceState,
  articles: readonly Article[],
  investigation: InvestigationResponse | undefined,
  signal: AbortSignal,
  label: AssistantResponseV2["resolved_range"] = null,
  aircraft: readonly AircraftState[] = [],
  resetSelectionOnFilters = false,
): Promise<PreparedWorkspaceActions> {
  const prepared: PreparedWorkspaceActions = {
    selection: { ...snapshot.selection },
    investigationId: snapshot.selectedInvestigationId,
  };
  const ids = [
    ...new Set(
      actions.flatMap((a) =>
        a.type === "focus_location"
          ? [a.location_id]
          : a.type === "set_filters"
            ? (a.filters.location_ids ?? [])
            : [],
      ),
    ),
  ];
  const locations = ids.length
    ? await client.fetchQuery({
        ...locationOptions(api, ids),
        retry: false,
        queryFn: async ({ signal: querySignal }) => {
          const options = locationOptions(api, ids);
          // The standard location query handles bounded batches and pagination.
          return options.queryFn!({
            signal: AbortSignal.any([signal, querySignal]),
            queryKey: options.queryKey,
            client,
            meta: undefined,
          });
        },
      })
    : [];
  signal.throwIfAborted();
  for (const place of locations) readContract("Location", place);
  if (ids.some((id) => !locations.some((l) => l.id === id)))
    throw new Error("The assistant referenced an unavailable location.");
  for (const action of actions) {
    readContract("UIActionV3", action);
    if (action.type === "set_filters") {
      prepared.filters = normalizeNewsQuery(structuredClone(action.filters));
      if (resetSelectionOnFilters) {
        prepared.selection = { articleId: null, locationId: null };
        prepared.investigationId = null;
      }
    }
    if (action.type === "focus_location") {
      const place = locations.find((l) => l.id === action.location_id)!;
      if (place.bounds && !isSearchableBounds(place.bounds))
        throw new Error("The sourced location has invalid bounds.");
      prepared.camera = place.bounds
        ? { type: "fit_bounds", bounds: [...place.bounds] }
        : { type: "focus_point", coordinates: [...place.coordinates!] };
      const article = [...articles, ...(investigation?.articles ?? [])].find(
        (a) => a.id === prepared.selection.articleId,
      );
      prepared.selection = {
        locationId: place.id,
        articleId: article?.location_ids.includes(place.id) ? article.id : null,
      };
      if (
        !investigation ||
        investigation.investigation.id !== prepared.investigationId ||
        !investigation.investigation.location_ids.includes(place.id)
      )
        prepared.investigationId = null;
    }
    if (action.type === "open_timeline") {
      const { type: _type, ...args } = action;
      const resolved = await resolveTimeline(api, client, args, signal);
      prepared.investigationId = args.investigation_id;
      const inv = resolved.data.investigation;
      prepared.selection = {
        articleId:
          prepared.selection.articleId &&
          inv.article_ids.includes(prepared.selection.articleId)
            ? prepared.selection.articleId
            : null,
        locationId:
          prepared.selection.locationId &&
          inv.location_ids.includes(prepared.selection.locationId)
            ? prepared.selection.locationId
            : null,
      };
      prepared.timeline = {
        id: crypto.randomUUID(),
        target: resolved.target,
        label:
          label?.target === "observation" &&
          label.from === args.observed_from &&
          label.to === args.observed_to
            ? label
            : null,
      };
    }
    if (action.type === 'open_record') {
      if (action.record_type === 'article') {
        const article = articles.find(row => row.id === action.id) ?? investigation?.articles.find(row => row.id === action.id)
          ?? (api.article ? await client.fetchQuery({ queryKey: [api.mode, 'article', action.id], retry: false, queryFn: ({ signal: querySignal }) => api.article!(action.id, AbortSignal.any([signal, querySignal])) }) : null);
        if (!article || readContract('Article', article).id !== action.id) throw new Error('The requested article is unavailable.');
        client.setQueryData([api.mode, 'article', action.id], article);
        prepared.selection = { articleId: article.id, locationId: article.location_ids.length === 1 ? article.location_ids[0]! : null };
        prepared.investigationId = investigation?.investigation.article_ids.includes(article.id) ? investigation.investigation.id : null;
        prepared.panel = { view: 'article', id: action.id };
      } else if (action.record_type === 'investigation') {
        if (!api.investigation) throw new Error('Investigations are unavailable.');
        const data = readContract('InvestigationResponse', await client.fetchQuery({ queryKey: [api.mode, 'investigation', action.id], retry: false,
          queryFn: ({ signal: querySignal }) => api.investigation!(action.id, AbortSignal.any([signal, querySignal])) }));
        if (data.investigation.id !== action.id) throw new Error('The investigation has a different ID.');
        prepared.investigationId = action.id;
        prepared.selection = { articleId: null, locationId: data.investigation.primary_location_id };
        prepared.panel = { view: 'investigation', id: action.id };
      } else {
        const item = aircraft.find(row => row.id === action.id);
        if (!snapshot.flightsEnabled || !item || Date.now() - Date.parse(item.observed_at) > (item.provider === 'airlabs' ? GLOBAL_POSITION_TTL : POSITION_TTL)) throw new Error('This aircraft is no longer in the current displayed sample. Refresh the aircraft layer first.');
        readContract('AircraftState', item);
        prepared.aircraftId = item.id; prepared.panel = { view: 'aircraft', id: item.id };
      }
    }
    if (action.type === 'set_basemap') prepared.basemap = action.basemap;
    if (action.type === 'set_layers') {
      if (action.wind === true && !api.wind) throw new Error('Wind is not connected.');
      if (action.flights === true && !api.flightGlobal && !api.flightArea && !api.flights) throw new Error('Aircraft are not connected.');
      prepared.layers = { ...prepared.layers, ...(action.flights === undefined ? {} : { flights: action.flights }), ...(action.wind === undefined ? {} : { wind: action.wind }) };
    }
    if (action.type === 'navigate_map') prepared.camera = action.command === 'globe' ? { type: 'return_to_globe' } : { type: 'zoom', delta: action.command === 'zoom_in' ? 1 : -1 };
  }
  if (
    prepared.timeline &&
    prepared.investigationId !== prepared.timeline.target.investigation_id
  )
    throw new Error(
      "The requested focus and timeline have incompatible place relationships.",
    );
  signal.throwIfAborted();
  return prepared;
}
