import type {
  WorkspaceResponse,
  InvestigationResponse,
  ObservationsQuery,
  CompareObservationsArgs,
  ObservationsResponse,
  AssistantRequest,
  AssistantResponse,
  FlightsResponse,
  Contract,
  SchemaName,
} from "@atlas/contracts";
import type {
  LocationsQuery,
  LocationsResponse,
  NewsQuery,
  NewsResponse,
} from "@atlas/contracts";
import { readContract } from "./validation";

export type DataMode = "api" | "fixture";
export interface AtlasApi {
  readonly mode: DataMode;
  workspace?: (signal: AbortSignal) => Promise<WorkspaceResponse>;
  investigation?: (
    id: string,
    signal: AbortSignal,
  ) => Promise<InvestigationResponse>;
  observations?: (
    query: ObservationsQuery,
    signal: AbortSignal,
  ) => Promise<ObservationsResponse>;
  compare?: (
    query: CompareObservationsArgs,
    signal: AbortSignal,
  ) => Promise<ObservationsResponse>;
  assistant?: (
    request: AssistantRequest,
    signal: AbortSignal,
  ) => Promise<AssistantResponse>;
  flights?: (regionId: string, signal: AbortSignal) => Promise<FlightsResponse>;
  news: (query: NewsQuery, signal: AbortSignal) => Promise<NewsResponse>;
  locations: (
    query: LocationsQuery,
    signal: AbortSignal,
  ) => Promise<LocationsResponse>;
}
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** Canonical arrays make equivalent filters share a cache key and wire format. */
export function normalizeNewsQuery(query: NewsQuery): NewsQuery {
  const normalized = {
    ...query,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };
  for (const key of ["location_ids", "themes", "entity_ids"] as const) {
    if (normalized[key]?.length)
      normalized[key] = [...new Set(normalized[key])].sort();
    else delete normalized[key];
  }
  if (normalized.keyword?.trim())
    normalized.keyword = normalized.keyword.trim();
  else delete normalized.keyword;
  readContract("NewsQuery", normalized);
  if (normalized.bounds && !isSearchableBounds(normalized.bounds))
    throw new Error(
      "Search bounds must be ordered and within geographic ranges",
    );
  const from = normalized.published_from,
    to = normalized.published_to;
  if (
    from &&
    to &&
    (Date.parse(to) < Date.parse(from) ||
      Date.parse(to) - Date.parse(from) > 366 * 86400000)
  ) {
    throw new Error(
      "Publication range must be ordered and no longer than 366 days",
    );
  }
  return normalized;
}
export function isSearchableBounds(bounds: readonly number[]): boolean {
  const [w, s, e, n] = bounds;
  return (
    bounds.length === 4 &&
    bounds.every(Number.isFinite) &&
    w! >= -180 &&
    e! <= 180 &&
    w! <= e! &&
    s! >= -90 &&
    n! <= 90 &&
    s! <= n!
  );
}
export function serializeQuery(query: NewsQuery | LocationsQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (value !== undefined)
      search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return search.toString();
}
export function createHttpApi(
  fetcher: typeof fetch = globalThis.fetch,
): AtlasApi {
  async function get(
    path: string,
    query: NewsQuery | LocationsQuery,
    signal: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`/api/${path}?${serializeQuery(query)}`, {
        signal,
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiFailure(
        "Cannot reach the Atlas API. Check the backend connection.",
        "NETWORK_ERROR",
        0,
        true,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ApiFailure(
        "The API returned an unreadable response.",
        "INVALID_RESPONSE",
        response.status,
        false,
      );
    }
    if (!response.ok) {
      try {
        const { error } = readContract("ApiError", body);
        throw new ApiFailure(
          error.message,
          error.code,
          response.status,
          error.retryable,
          error.request_id,
        );
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(
          `API request failed (${response.status}).`,
          "HTTP_ERROR",
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }
    }
    return body;
  }
  async function validated<Name extends "NewsResponse" | "LocationsResponse">(
    name: Name,
    body: Promise<unknown>,
  ) {
    const data = await body;
    try {
      return readContract(name, data);
    } catch {
      throw new ApiFailure(
        "The API response does not match the shared contract.",
        "INVALID_RESPONSE",
        502,
        false,
      );
    }
  }
  async function feature<Name extends SchemaName>(
    name: Name,
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<Contract<Name>> {
    let response: Response;
    try {
      response = await fetcher(`/api/${path}`, {
        signal,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiFailure(
        "Cannot reach the Atlas API. Try again when the connection returns.",
        "NETWORK_ERROR",
        0,
        true,
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiFailure(
        "The API returned an unreadable response.",
        "INVALID_RESPONSE",
        response.status,
        false,
      );
    }
    if (!response.ok) {
      try {
        const { error } = readContract("ApiError", data);
        throw new ApiFailure(
          error.message,
          error.code,
          response.status,
          error.retryable,
          error.request_id,
        );
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(
          `This feature is unavailable (${response.status}).`,
          "HTTP_ERROR",
          response.status,
          response.status >= 500 || response.status === 429,
        );
      }
    }
    try {
      return readContract(name, data);
    } catch {
      throw new ApiFailure(
        "The response failed shared validation.",
        "INVALID_RESPONSE",
        502,
        false,
      );
    }
  }
  return {
    workspace: (signal) => feature("WorkspaceResponse", "workspace", signal),
    investigation: (id, signal) =>
      feature(
        "InvestigationResponse",
        `investigations/${encodeURIComponent(readContract("InvestigationQuery", { id }).id)}`,
        signal,
      ),
    observations: (query, signal) =>
      feature(
        "ObservationsResponse",
        `observations?${serializeQuery(readContract("ObservationsQuery", query))}`,
        signal,
      ),
    compare: (query, signal) =>
      feature(
        "ObservationsResponse",
        `observations/compare?${serializeQuery(readContract("CompareObservationsArgs", query))}`,
        signal,
      ),
    assistant: (request, signal) =>
      feature(
        "AssistantResponse",
        "assistant",
        signal,
        readContract("AssistantRequest", request),
      ),
    flights: (id, signal) =>
      feature(
        "FlightsResponse",
        `flights?region_id=${encodeURIComponent(id)}`,
        signal,
      ),
    mode: "api",
    news: (query, signal) =>
      validated("NewsResponse", get("news", normalizeNewsQuery(query), signal)),
    locations: (query, signal) =>
      validated(
        "LocationsResponse",
        get("locations", readContract("LocationsQuery", query), signal),
      ),
  };
}
