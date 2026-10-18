import type {
  WorkspaceResponse,
  InvestigationResponse,
  ObservationsQuery,
  CompareObservationsArgs,
  ObservationsResponse,
  AssistantRequestV2,
  AssistantResponseV2,
  AssistantStreamEvent,
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
    request: AssistantRequestV2,
    signal: AbortSignal,
  ) => Promise<AssistantResponseV2>;
  assistantStream?: (
    request: AssistantRequestV2,
    signal: AbortSignal,
    onEvent: (event: AssistantStreamEvent) => void,
  ) => Promise<AssistantResponseV2>;
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
  const canonical = <T extends string>(values: T[] | undefined) => values?.length ? [...new Set(values)].sort() : undefined;
  const events = canonical(normalized.event_types), topics = canonical(normalized.topics);
  if (events) normalized.event_types = events;
  else delete normalized.event_types;
  if (topics) normalized.topics = topics;
  else delete normalized.topics;
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
        "AssistantResponseV2",
        "assistant",
        signal,
        readContract("AssistantRequestV2", request),
      ),
    assistantStream: async (request, signal, onEvent) => {
      readContract("AssistantRequestV2", request);
      let response: Response;
      try {
        response = await fetcher('/api/assistant', {
          method: 'POST', signal,
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiFailure('Cannot reach the Atlas API. Check the backend connection.', 'NETWORK_ERROR', 0, true, request.request_id);
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          try {
            const { error } = readContract('ApiError', body);
            throw new ApiFailure(error.message, error.code, response.status, error.retryable, error.request_id);
          } catch (error) {
            if (error instanceof ApiFailure) throw error;
            throw new ApiFailure(`Assistant unavailable (${response.status}).`, 'HTTP_ERROR', response.status, response.status >= 500 || response.status === 429, request.request_id);
          }
        }
        // Same validated v2 protocol when an adapter returns a JSON response.
        try { return readContract('AssistantResponseV2', body); }
        catch { throw new ApiFailure('The response failed shared validation.', 'INVALID_RESPONSE', 502, false, request.request_id); }
      }
      return readAssistantStream(response, request.request_id, signal, onEvent);
    },
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

async function readAssistantStream(response: Response, requestId: string, signal: AbortSignal, onEvent: (event: AssistantStreamEvent) => void): Promise<AssistantResponseV2> {
  const interrupted = () => new ApiFailure('The answer was interrupted. Retry the question to get a complete, checked response.', 'STREAM_INTERRUPTED', 502, true, requestId);
  const invalid = () => new ApiFailure('The assistant stream failed shared validation.', 'INVALID_RESPONSE', 502, false, requestId);
  if (!response.body) throw interrupted();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', received = 0, previewLength = 0, final: AssistantResponseV2 | undefined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  function frame(value: string) {
    const lines = value.split('\n').filter(line => line.startsWith('data:'));
    if (!lines.length) return;
    if (final) throw invalid();
    let event: AssistantStreamEvent;
    try { event = readContract('AssistantStreamEvent', JSON.parse(lines.map(line => line.slice(5).trimStart()).join('\n'))); }
    catch { throw invalid(); }
    if (event.request_id !== requestId) throw invalid();
    if (event.type === 'error') {
      if (event.error.request_id !== requestId) throw invalid();
      throw new ApiFailure(event.error.message, event.error.code, 502, event.error.retryable, event.error.request_id);
    }
    if (event.type === 'complete') {
      if (event.response.request_id !== requestId) throw invalid();
      final = event.response;
    } else {
      if (event.type === 'answer_delta' && (previewLength += event.text.length) > 32000) throw invalid();
      onEvent(event);
    }
  }
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const part = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (part.done) { buffer += decoder.decode(); break; }
      received += part.value.byteLength;
      if (received > 1048576) throw invalid();
      buffer += decoder.decode(part.value, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      if (buffer.length > 262144) throw invalid();
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) { frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    if (buffer.trim() || !final) throw interrupted();
    return final;
  } catch (error) {
    if (signal.aborted || error instanceof ApiFailure) throw error;
    throw interrupted();
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
