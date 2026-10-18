import type {
  WorkspaceResponse,
  Article,
  InvestigationResponse,
  ObservationsQuery,
  CompareObservationsArgs,
  ObservationsResponse,
  AssistantRequestV2,
  AssistantResponseV2,
  AssistantStreamEvent,
  AssistantRequestV3,
  AssistantResponseV3,
  AssistantStreamEventV3,
  FlightsResponse,
  WindQuery,
  WindResponse,
  FlightAreaQuery,
  FlightAreaResponse,
  FlightGlobalResponse,
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
  article?: (id: string, signal: AbortSignal) => Promise<Article>;
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
  assistantV3?: (request: AssistantRequestV3, signal: AbortSignal) => Promise<AssistantResponseV3>;
  assistantStreamV3?: (request: AssistantRequestV3, signal: AbortSignal, onEvent: (event: AssistantStreamEventV3) => void) => Promise<AssistantResponseV3>;
  flights?: (regionId: string, signal: AbortSignal) => Promise<FlightsResponse>;
  wind?: (query: WindQuery, signal: AbortSignal) => Promise<WindResponse>;
  flightArea?: (query: FlightAreaQuery, signal: AbortSignal) => Promise<FlightAreaResponse>;
  flightGlobal?: (signal: AbortSignal) => Promise<FlightGlobalResponse>;
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
    readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

/** Retry-After is either seconds from receipt or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const input = value.trim();
  const time = /^\d+(?:\.\d+)?$/.test(input)
    ? now + Number(input) * 1000
    : /^[A-Za-z]{3},/.test(input) ? Date.parse(input) : NaN;
  return Number.isFinite(time) ? Math.max(now, time) : null;
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
export function serializeQuery(query: NewsQuery | LocationsQuery | FlightAreaQuery): string {
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
  assistantVersion: 2 | 3 = 3,
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
      if (!response.ok) throw new ApiFailure(`API request failed (${response.status}).`, 'HTTP_ERROR', response.status,
        response.status === 429 || response.status >= 500, null, parseRetryAfter(response.headers.get('Retry-After')));
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
          parseRetryAfter(response.headers.get("Retry-After")),
        );
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(
          `API request failed (${response.status}).`,
          "HTTP_ERROR",
          response.status,
          response.status === 429 || response.status >= 500,
          null,
          parseRetryAfter(response.headers.get("Retry-After")),
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
      if (signal.aborted) throw signal.reason;
      if (!response.ok) throw new ApiFailure(`This feature is unavailable (${response.status}).`, 'HTTP_ERROR', response.status,
        response.status === 429 || response.status >= 500, null, parseRetryAfter(response.headers.get('Retry-After')));
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
          parseRetryAfter(response.headers.get("Retry-After")),
        );
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        throw new ApiFailure(
          `This feature is unavailable (${response.status}).`,
          "HTTP_ERROR",
          response.status,
          response.status >= 500 || response.status === 429,
          null,
          parseRetryAfter(response.headers.get("Retry-After")),
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
    article: (id, signal) => feature('Article', `articles/${encodeURIComponent(readContract('InvestigationQuery', { id }).id)}`, signal),
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
    ...(assistantVersion === 3 ? { assistantV3: (request, signal) => feature('AssistantResponseV3', 'assistant', signal, readContract('AssistantRequestV3', request)),
    assistantStreamV3: async (request, signal, onEvent) => {
      readContract('AssistantRequestV3', request);
      let response: Response;
      try {
        response = await fetcher('/api/assistant', { method: 'POST', signal,
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
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
        try { return readContract('AssistantResponseV3', body); }
        catch { throw new ApiFailure('The response failed shared validation.', 'INVALID_RESPONSE', 502, false, request.request_id); }
      }
      return readAssistantStream(response, request.request_id, signal, onEvent, 3);
    } } satisfies Partial<AtlasApi> : {}),
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
    wind: (query, signal) => feature("WindResponse", `wind?${new URLSearchParams({ bounds: readContract("WindQuery", query).bounds.join(",") })}`, signal),
    flightArea: (query, signal) => feature(
      "FlightAreaResponse",
      `flights/area?${serializeQuery(readContract("FlightAreaQuery", query))}`,
      signal,
    ),
    flightGlobal: signal => feature("FlightGlobalResponse", "flights/global", signal),
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

function readAssistantStream(response: Response, requestId: string, signal: AbortSignal, onEvent: (event: AssistantStreamEvent) => void): Promise<AssistantResponseV2>;
function readAssistantStream(response: Response, requestId: string, signal: AbortSignal, onEvent: (event: AssistantStreamEventV3) => void, version: 3): Promise<AssistantResponseV3>;
async function readAssistantStream(response: Response, requestId: string, signal: AbortSignal, onEvent: ((event: AssistantStreamEvent) => void) | ((event: AssistantStreamEventV3) => void), version: 2 | 3 = 2): Promise<AssistantResponseV2 | AssistantResponseV3> {
  const interrupted = () => new ApiFailure('The answer was interrupted. Retry the question to get a complete, checked response.', 'STREAM_INTERRUPTED', 502, true, requestId);
  const invalid = () => new ApiFailure('The assistant stream failed shared validation.', 'INVALID_RESPONSE', 502, false, requestId);
  if (!response.body) throw interrupted();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', received = 0, previewLength = 0, final: AssistantResponseV2 | AssistantResponseV3 | undefined;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  function frame(value: string) {
    const lines = value.split('\n').filter(line => line.startsWith('data:'));
    if (!lines.length) return;
    if (final) throw invalid();
    let event: AssistantStreamEvent | AssistantStreamEventV3;
    try { event = readContract(version === 3 ? 'AssistantStreamEventV3' : 'AssistantStreamEvent', JSON.parse(lines.map(line => line.slice(5).trimStart()).join('\n'))); }
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
      if (version === 3) (onEvent as (event: AssistantStreamEventV3) => void)(event as AssistantStreamEventV3);
      else (onEvent as (event: AssistantStreamEvent) => void)(event as AssistantStreamEvent);
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
