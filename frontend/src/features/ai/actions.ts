import type { QueryClient } from "@tanstack/react-query";
import type {
  Article,
  AssistantResponseV2,
  InvestigationResponse,
  OpenTimelineArgs,
  UIActionV2,
} from "@atlas/contracts";
import type { PreparedWorkspaceActions, WorkspaceState } from "../../app/state";
import type { AtlasApi } from "../../lib/api";
import { isSearchableBounds, normalizeNewsQuery } from "../../lib/api";
import { locationOptions } from "../../lib/queries";
import { readContract } from "../../lib/validation";

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
  actions: readonly UIActionV2[],
  snapshot: WorkspaceState,
  articles: readonly Article[],
  investigation: InvestigationResponse | undefined,
  signal: AbortSignal,
  label: AssistantResponseV2["resolved_range"] = null,
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
    readContract("UIActionV2", action);
    if (action.type === "set_filters")
      prepared.filters = normalizeNewsQuery(structuredClone(action.filters));
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
