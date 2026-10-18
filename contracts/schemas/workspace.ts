import type { FromSchema } from "json-schema-to-ts";
import {
  draft,
  recordId,
  recordReferenceId,
  text,
  nullableText,
  utcDateTime,
  nullableUtcDateTime,
  calendarDate,
  bounds,
  coordinates,
  idList,
  pagination,
  httpsUrl,
} from "./common.js";
import { articleSchema, locationSchema, sourceSchema } from "./records.js";
import { newsQuerySchema } from "./api.js";
import { citationSchema, citationReferenceSchema } from "./assistant.js";
import { coverageSchema } from "./responses.js";

const ref = <Name extends string>(name: Name) =>
  ({ $ref: `https://atlas.invalid/contracts/${name}` }) as const;
const object = <
  Name extends string,
  const P extends Record<string, object>,
  R extends readonly (keyof P & string)[],
>(
  name: Name,
  properties: P,
  required: R,
) =>
  ({
    $schema: draft,
    $id: `https://atlas.invalid/contracts/${name}`,
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }) as const;
const array = <const T extends object>(items: T) =>
  ({ type: "array", items, maxItems: 100 }) as const;
const nullable = <const T extends object>(schema: T) =>
  ({ anyOf: [schema, { type: "null" }] }) as const;
const longText = { ...text, maxLength: 12000 } as const;
const metric = {
  type: "string",
  maxLength: 160,
  pattern: "^[a-z][a-z0-9_]*$",
} as const;
const statistic = {
  enum: ["instantaneous", "annual_peak", "daily_mean", "daily_total"],
} as const;
// Embed canonical definitions without nested registration IDs. The model-only draft
// can be passed directly as Gemini parametersJsonSchema, without external $refs.
const { $schema: newsDraft, $id: newsId, ...newsBody } = newsQuerySchema;
const {
  $schema: citationDraft,
  $id: citationId,
  ...citationReferenceBody
} = citationReferenceSchema;
const option = {
  type: "object",
  properties: { id: recordId, label: text },
  required: ["id", "label"],
  additionalProperties: false,
} as const;
export const observationSchema = {
  ...object(
    "Observation",
    {
      id: recordReferenceId,
      location_id: recordId,
      metric,
      value: nullable({ type: "number" } as const),
      unit: text,
      source_id: recordId,
      observed_at: utcDateTime,
      fetched_at: utcDateTime,
      series_id: recordId,
      statistic,
      qualifiers: array(text),
      time_precision: { enum: ["instant", "minute", "day"] },
      period_start: nullableUtcDateTime,
      period_end: nullableUtcDateTime,
    },
    [
      "id",
      "location_id",
      "metric",
      "value",
      "unit",
      "source_id",
      "observed_at",
      "fetched_at",
      "series_id",
      "statistic",
      "qualifiers",
      "time_precision",
      "period_start",
      "period_end",
    ] as const,
  ),
  allOf: [
    {
      if: { properties: { statistic: { const: "instantaneous" } } },
      then: { properties: { time_precision: { const: "instant" } } },
      else: { properties: { time_precision: { enum: ["minute", "day"] } } },
    },
    {
      if: { properties: { period_start: { type: "null" } } },
      then: { properties: { period_end: { type: "null" } } },
      else: { properties: { period_end: utcDateTime } },
    },
  ],
} as const;
export const seriesSchema = {
  ...object(
    "ObservationSeries",
    {
      id: recordId,
      location_id: recordId,
      metric,
      unit: text,
      statistic,
      expected_interval_seconds: nullable({
        type: "integer",
        minimum: 1,
      } as const),
      source_id: recordId,
      provider_series_ref: text,
      description: longText,
      missing_data_rule: longText,
      license: text,
      attribution: text,
      coverage_from: utcDateTime,
      coverage_to: utcDateTime,
      retrieved_at: utcDateTime,
      live: { type: "boolean" },
    },
    [
      "id",
      "location_id",
      "metric",
      "unit",
      "statistic",
      "expected_interval_seconds",
      "source_id",
      "provider_series_ref",
      "license",
      "attribution",
      "retrieved_at",
      "description",
      "missing_data_rule",
      "coverage_from",
      "coverage_to",
      "live",
    ] as const,
  ),
  allOf: [
    {
      if: { properties: { statistic: { const: "instantaneous" } } },
      then: {
        properties: {
          expected_interval_seconds: { type: "integer", minimum: 1 },
        },
      },
      else: { properties: { expected_interval_seconds: { type: "null" } } },
    },
  ],
} as const;
export const evidenceSchema = object(
  "Evidence",
  {
    id: recordId,
    type: { enum: ["observation_series", "report", "article", "imagery"] },
    title: text,
    description: longText,
    limitations: longText,
    source_id: recordId,
    source_ids: idList,
    observed_from: nullableUtcDateTime,
    observed_to: nullableUtcDateTime,
    location_id: nullable(recordId),
    series_id: nullable(recordId),
    imagery: nullable({
      type: "object",
      properties: {
        bounds,
        asset_path: {
          type: "string",
          pattern: "^assets/evidence/(?!.*\\.\\.)[a-zA-Z0-9_./-]+\\.png$",
        },
        layer_ref: text,
        legend: longText,
        attribution: text,
        license: text,
        resolution_m: { type: "number", exclusiveMinimum: 0 },
        comparison_group: nullableText,
        comparison_role: nullable({ enum: ["before", "after"] } as const),
      },
      required: [
        "bounds",
        "asset_path",
        "layer_ref",
        "comparison_group",
        "comparison_role",
        "legend",
        "attribution",
        "license",
        "resolution_m",
      ],
      additionalProperties: false,
    } as const),
  },
  [
    "id",
    "type",
    "title",
    "description",
    "limitations",
    "source_id",
    "source_ids",
    "observed_from",
    "observed_to",
    "location_id",
    "series_id",
    "imagery",
  ] as const,
);
export const investigationSchema = object(
  "Investigation",
  {
    id: recordId,
    title: text,
    summary: { ...text, maxLength: 2000 },
    primary_location_id: recordId,
    event_period: {
      type: "object",
      properties: {
        start_date: calendarDate,
        end_date: calendarDate,
        timezone: text,
      },
      required: ["start_date", "end_date", "timezone"],
      additionalProperties: false,
    },
    content_status: { enum: ["curated_seed", "prepared_fixture"] },
    verification_status: { enum: ["reviewed", "unreviewed"] },
    reviewed_at: nullableUtcDateTime,
    location_ids: idList,
    article_ids: idList,
    evidence_ids: idList,
    series_ids: idList,
    key_observations: array({
      type: "object",
      properties: { observation_id: recordReferenceId, role: text },
      required: ["observation_id", "role"],
      additionalProperties: false,
    } as const),
    items: array({
      type: "object",
      properties: {
        id: recordId,
        kind: {
          enum: [
            "what_happened",
            "public_impact",
            "resource",
            "research_question",
            "uncertainty",
            "business_exposure",
          ],
        },
        text: { ...text, maxLength: 1200 },
        exposure_basis: nullable({
          enum: ["direct", "sector_association"],
        } as const),
        source_ids: idList,
      },
      required: ["id", "kind", "text", "exposure_basis", "source_ids"],
      additionalProperties: false,
    } as const),
  },
  [
    "id",
    "title",
    "summary",
    "primary_location_id",
    "event_period",
    "content_status",
    "verification_status",
    "reviewed_at",
    "location_ids",
    "article_ids",
    "evidence_ids",
    "series_ids",
    "key_observations",
    "items",
  ] as const,
);
export const investigationResponseSchema = object(
  "InvestigationResponse",
  {
    investigation: ref("Investigation"),
    articles: array(ref("Article")),
    evidence: array(ref("Evidence")),
    observations: array(ref("Observation")),
    observation_series: array(ref("ObservationSeries")),
    locations: array(ref("Location")),
    sources: array(ref("Source")),
  },
  [
    "investigation",
    "articles",
    "evidence",
    "observations",
    "observation_series",
    "locations",
    "sources",
  ] as const,
);
export const observationsQuerySchema = object(
  "ObservationsQuery",
  {
    location_id: recordId,
    metric,
    // A location + metric can hold a curated archive and a live series; series_id selects exactly one.
    series_id: recordId,
    observed_from: utcDateTime,
    observed_to: utcDateTime,
    ...pagination,
  },
  [] as const,
);
export const observationsResponseSchema = object(
  "ObservationsResponse",
  {
    items: array(ref("Observation")),
    coverage: ref("Coverage"),
    aggregation: { enum: ["raw"] },
    comparison: nullable({
      type: "object",
      properties: {
        first_id: recordReferenceId,
        last_id: recordReferenceId,
        difference: { type: "number" },
        unit: text,
      },
      required: ["first_id", "last_id", "difference", "unit"],
      additionalProperties: false,
    } as const),
    limitation: text,
  },
  ["items", "coverage", "aggregation"] as const,
);
export const aircraftSchema = object(
  "AircraftState",
  {
    id: recordId,
    provider: { const: "adsb.lol" },
    callsign: nullableText,
    coordinates,
    altitude: nullable({ type: "number" } as const),
    altitude_unit: { const: "ft" },
    altitude_reference: { const: "barometric" },
    speed: nullable({ type: "number" } as const),
    speed_unit: { const: "kn" },
    heading: nullable({ type: "number", minimum: 0, maximum: 360 } as const),
    observed_at: utcDateTime,
    fetched_at: utcDateTime,
    source_url: httpsUrl,
    license: { const: "ODbL-1.0" },
  },
  [
    "id",
    "provider",
    "callsign",
    "coordinates",
    "altitude",
    "altitude_unit",
    "altitude_reference",
    "speed",
    "speed_unit",
    "heading",
    "observed_at",
    "fetched_at",
    "source_url",
    "license",
  ] as const,
);
export const flightRegionSchema = object(
  "FlightRegion",
  {
    id: recordId,
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
    radius_nm: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["id", "latitude", "longitude", "radius_nm"] as const,
);
export const flightsResponseSchema = object(
  "FlightsResponse",
  {
    items: array(ref("AircraftState")),
    region_id: recordId,
    fetched_at: utcDateTime,
    stale: { type: "boolean" },
    mode: { const: "live" },
    replay: { const: false },
    attribution: text,
    retry_at: utcDateTime,
    error: nullableText,
  },
  [
    "items",
    "region_id",
    "fetched_at",
    "stale",
    "mode",
    "replay",
    "attribution",
    "retry_at",
    "error",
  ] as const,
);
export const actionSchema = {
  $schema: draft,
  $id: "https://atlas.invalid/contracts/UIAction",
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "set_filters" }, filters: newsBody },
      required: ["type", "filters"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "focus_location" }, location_id: recordId },
      required: ["type", "location_id"],
      additionalProperties: false,
    },
  ],
} as const;
export const assistantRequestSchema = object(
  "AssistantRequest",
  {
    request_id: { type: "string", minLength: 1, maxLength: 160 },
    message: { ...text, maxLength: 4000 },
    timezone: { ...text, maxLength: 100 },
    filters: ref("NewsQuery"),
    selected_investigation_id: recordId,
    allow_ui_actions: { type: "boolean" },
    audience: { enum: ["general_public", "journalist", "investor"] },
  },
  ["request_id", "message", "timezone"] as const,
);
const answerProperties = {
  answer: longText,
  result_ids: { type: "array", items: recordReferenceId, maxItems: 100 },
  actions: { type: "array", items: ref("UIAction"), maxItems: 8 },
} as const;
export const assistantDraftSchema = object(
  "AssistantDraft",
  {
    ...answerProperties,
    actions: {
      type: "array",
      items: { oneOf: actionSchema.oneOf },
      maxItems: 8,
    },
    citations: array(citationReferenceBody),
  },
  ["answer", "result_ids", "actions", "citations"] as const,
);
export const assistantResponseSchema = object(
  "AssistantResponse",
  {
    ...answerProperties,
    request_id: { type: "string", minLength: 1, maxLength: 160 },
    citations: array(ref("Citation")),
    coverage: ref("Coverage"),
    mode: { enum: ["live", "fixture", "fallback"] },
    errors: array({
      type: "object",
      properties: { code: text, message: text, retryable: { type: "boolean" } },
      required: ["code", "message", "retryable"],
      additionalProperties: false,
    } as const),
  },
  [
    "answer",
    "result_ids",
    "actions",
    "request_id",
    "citations",
    "coverage",
    "mode",
    "errors",
  ] as const,
);
export const workspaceResponseSchema = object(
  "WorkspaceResponse",
  {
    capabilities: {
      type: "object",
      properties: {
        investigations: { type: "boolean" },
        assistant: { type: "boolean" },
        flights: { type: "boolean" },
        observations: { type: "boolean" },
        assistant_context: { type: "boolean" },
        series_filter: { type: "boolean" },
      },
      required: [
        "investigations",
        "assistant",
        "flights",
        "observations",
        "assistant_context",
        "series_filter",
      ],
      additionalProperties: false,
    },
    themes: array(option),
    entities: array(option),
    flight_regions: array(ref("FlightRegion")),
    investigations: array({
      type: "object",
      properties: { id: recordId, title: text, article_ids: idList },
      required: ["id", "title", "article_ids"],
      additionalProperties: false,
    }),
  },
  [
    "capabilities",
    "themes",
    "entities",
    "flight_regions",
    "investigations",
  ] as const,
);
export const featureSchemas = {
  Observation: observationSchema,
  ObservationSeries: seriesSchema,
  Evidence: evidenceSchema,
  Investigation: investigationSchema,
  InvestigationResponse: investigationResponseSchema,
  InvestigationQuery: object("InvestigationQuery", { id: recordId }, [
    "id",
  ] as const),
  ObservationsQuery: observationsQuerySchema,
  ObservationsResponse: observationsResponseSchema,
  CompareObservationsArgs: object(
    "CompareObservationsArgs",
    {
      location_id: recordId,
      metric,
      series_id: recordId,
      observed_from: utcDateTime,
      observed_to: utcDateTime,
      limit: pagination.limit,
    },
    ["location_id", "metric"] as const,
  ),
  AircraftState: aircraftSchema,
  FlightRegion: flightRegionSchema,
  FlightsQuery: object("FlightsQuery", { region_id: recordId }, [
    "region_id",
  ] as const),
  FindAircraftArgs: object(
    "FindAircraftArgs",
    {
      region_id: recordId,
      identifier: { type: "string", pattern: "^[A-Za-z0-9-]{1,16}$" },
    },
    ["region_id", "identifier"] as const,
  ),
  FlightsResponse: flightsResponseSchema,
  FocusLocationArgs: object("FocusLocationArgs", { location_id: recordId }, [
    "location_id",
  ] as const),
  UIAction: actionSchema,
  AssistantRequest: assistantRequestSchema,
  AssistantDraft: assistantDraftSchema,
  AssistantResponse: assistantResponseSchema,
  WorkspaceResponse: workspaceResponseSchema,
} as const;
const references = [
  articleSchema,
  locationSchema,
  sourceSchema,
  newsQuerySchema,
  citationSchema,
  citationReferenceSchema,
  coverageSchema,
  observationSchema,
  seriesSchema,
  evidenceSchema,
  investigationSchema,
  aircraftSchema,
  flightRegionSchema,
  actionSchema,
] as const;
export type FeatureContracts = {
  Observation: FromSchema<
    typeof featureSchemas.Observation,
    { references: [...typeof references] }
  >;
  ObservationSeries: FromSchema<
    typeof featureSchemas.ObservationSeries,
    { references: [...typeof references] }
  >;
  Evidence: FromSchema<
    typeof featureSchemas.Evidence,
    { references: [...typeof references] }
  >;
  Investigation: FromSchema<
    typeof featureSchemas.Investigation,
    { references: [...typeof references] }
  >;
  InvestigationResponse: FromSchema<
    typeof featureSchemas.InvestigationResponse,
    { references: [...typeof references] }
  >;
  InvestigationQuery: FromSchema<
    typeof featureSchemas.InvestigationQuery,
    { references: [...typeof references] }
  >;
  ObservationsQuery: FromSchema<
    typeof featureSchemas.ObservationsQuery,
    { references: [...typeof references] }
  >;
  ObservationsResponse: FromSchema<
    typeof featureSchemas.ObservationsResponse,
    { references: [...typeof references] }
  >;
  CompareObservationsArgs: FromSchema<
    typeof featureSchemas.CompareObservationsArgs,
    { references: [...typeof references] }
  >;
  AircraftState: FromSchema<
    typeof featureSchemas.AircraftState,
    { references: [...typeof references] }
  >;
  FlightRegion: FromSchema<
    typeof featureSchemas.FlightRegion,
    { references: [...typeof references] }
  >;
  FlightsQuery: FromSchema<
    typeof featureSchemas.FlightsQuery,
    { references: [...typeof references] }
  >;
  FindAircraftArgs: FromSchema<
    typeof featureSchemas.FindAircraftArgs,
    { references: [...typeof references] }
  >;
  FlightsResponse: FromSchema<
    typeof featureSchemas.FlightsResponse,
    { references: [...typeof references] }
  >;
  FocusLocationArgs: FromSchema<
    typeof featureSchemas.FocusLocationArgs,
    { references: [...typeof references] }
  >;
  UIAction: FromSchema<
    typeof featureSchemas.UIAction,
    { references: [...typeof references] }
  >;
  AssistantRequest: FromSchema<
    typeof featureSchemas.AssistantRequest,
    { references: [...typeof references] }
  >;
  AssistantDraft: FromSchema<
    typeof featureSchemas.AssistantDraft,
    { references: [...typeof references] }
  >;
  AssistantResponse: FromSchema<
    typeof featureSchemas.AssistantResponse,
    { references: [...typeof references] }
  >;
  WorkspaceResponse: FromSchema<
    typeof featureSchemas.WorkspaceResponse,
    { references: [...typeof references] }
  >;
};
