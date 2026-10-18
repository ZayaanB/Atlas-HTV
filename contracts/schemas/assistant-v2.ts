import type { FromSchema } from "json-schema-to-ts";
import {
  bounds,
  draft,
  nullableCalendarDate,
  nullableUtcDateTime,
  recordId,
  recordReferenceId,
  text,
  utcDateTime,
} from "./common.js";
import { newsQuerySchema } from "./api.js";
import { citationReferenceSchema, citationSchema } from "./assistant.js";
import {
  assistantRequestSchema,
  assistantResponseSchema,
} from "./workspace.js";
import { coverageSchema } from "./responses.js";

const object = <
  N extends string,
  const P extends Record<string, object>,
  const R extends readonly (keyof P & string)[],
>(
  name: N,
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
const ref = <N extends string>(name: N) =>
  ({ $ref: `https://atlas.invalid/contracts/${name}` }) as const;
const nullable = <const T extends object>(value: T) =>
  ({ anyOf: [value, { type: "null" }] }) as const;
const array = <const T extends object>(items: T, maxItems: number) =>
  ({ type: "array", items, maxItems }) as const;
const filterKeys = [
  "location_ids",
  "bounds",
  "themes",
  "entity_ids",
  "event_types",
  "topics",
  "verification_status",
  "has_location",
  "keyword",
  "semantic_query",
  "published_from",
  "published_to",
] as const;
const keys = {
  type: "array",
  items: { enum: filterKeys },
  uniqueItems: true,
  maxItems: filterKeys.length,
} as const;
const clarificationReason = {
  enum: [
    "ambiguous_intent",
    "missing_location",
    "ambiguous_location",
    "missing_metric",
    "unsupported_period",
    "unsupported_coverage",
  ],
} as const;
const clarification = nullable(clarificationReason);
const target = { enum: ["publication", "observation"] } as const;
const kind = {
  enum: ["answer", "clarification", "empty", "action_summary"],
} as const;
const { limit, offset, ...filterProperties } = newsQuerySchema.properties;
const patchProperties = {
  set: {
    type: "object",
    properties: {
      ...filterProperties,
      location_ids: { ...filterProperties.location_ids, minItems: 1 },
      themes: { ...filterProperties.themes, minItems: 1 },
      entity_ids: { ...filterProperties.entity_ids, minItems: 1 },
      event_types: { ...filterProperties.event_types, minItems: 1 },
      topics: { ...filterProperties.topics, minItems: 1 },
      keyword: { ...filterProperties.keyword, minLength: 1, pattern: "\\S" },
    },
    additionalProperties: false,
  },
  clear: keys,
} as const;
// These constraints refine properties in the same closed object, never extend a
// closed v1 object. Conflict checks are also enforced for drafts' inline patches.
const patchConstraints = filterKeys.map(
  (key) =>
    ({
      not: {
        properties: {
          set: { type: "object", properties: { [key]: {} }, required: [key] },
          clear: { type: "array", contains: { const: key } },
        },
        required: ["set", "clear"],
      },
    }) as const,
);
export const assistantFilterPatchSchema = {
  ...object("AssistantFilterPatch", patchProperties, ["set", "clear"]),
  allOf: patchConstraints,
} as const;
export const openTimelineArgsSchema = object(
  "OpenTimelineArgs",
  {
    investigation_id: recordId,
    series_id: recordId,
    observed_from: utcDateTime,
    observed_to: utcDateTime,
  },
  ["investigation_id", "series_id"],
);
const filterAction = {
  type: "object",
  properties: { type: { const: "set_filters" }, filters: ref("NewsQuery") },
  required: ["type", "filters"],
  additionalProperties: false,
} as const;
const focusAction = {
  type: "object",
  properties: { type: { const: "focus_location" }, location_id: recordId },
  required: ["type", "location_id"],
  additionalProperties: false,
} as const;
const timelineAction = {
  type: "object",
  properties: {
    type: { const: "open_timeline" },
    ...openTimelineArgsSchema.properties,
  },
  required: ["type", ...openTimelineArgsSchema.required],
  additionalProperties: false,
} as const;
export const uiActionV2Schema = {
  $schema: draft,
  $id: "https://atlas.invalid/contracts/UIActionV2",
  oneOf: [filterAction, focusAction, timelineAction],
} as const;
const request = assistantRequestSchema.properties;
export const assistantRequestV2Schema = object(
  "AssistantRequestV2",
  {
    protocol_version: { const: 2 },
    request_id: request.request_id,
    message: request.message,
    timezone: request.timezone,
    filters: ref("NewsQuery"),
    selected_investigation_id: recordId,
    selected_article_id: recordId,
    selected_location_id: recordId,
    selected_bounds: bounds,
    audience: request.audience,
    interaction_mode: { enum: ["intent", "read_only"] },
    history: array(
      {
        type: "object",
        properties: {
          role: { enum: ["user", "assistant"] },
          content: { ...text, maxLength: 4000 },
        },
        required: ["role", "content"],
        additionalProperties: false,
      } as const,
      12,
    ),
  },
  ["protocol_version", "request_id", "message", "timezone"],
);
export const assistantIntentSchema = {
  ...object(
    "AssistantIntent",
    {
      actions: array(
        {
          type: "object",
          properties: {
            type: { enum: ["set_filters", "focus_location", "open_timeline"] },
            quote: { ...text, maxLength: 4000 },
          },
          required: ["type", "quote"],
          additionalProperties: false,
        } as const,
        3,
      ),
      filter_keys: keys,
      clear_filters: keys,
      clarification_reason: clarification,
      use_current_area: { type: "boolean" },
      date_expression: nullable({ ...text, maxLength: 200 }),
      date_target: nullable(target),
    },
    [
      "actions",
      "filter_keys",
      "clear_filters",
      "clarification_reason",
      "use_current_area",
      "date_expression",
      "date_target",
    ],
  ),
  allOf: [
    {
      if: { properties: { date_expression: { type: "null" } } },
      then: { properties: { date_target: { type: "null" } } },
      else: { properties: { date_target: target } },
    },
    ...filterKeys.map(
      (key) =>
        ({
          if: {
            properties: {
              clear_filters: { type: "array", contains: { const: key } },
            },
          },
          then: {
            properties: {
              filter_keys: { type: "array", contains: { const: key } },
            },
          },
        }) as const,
    ),
  ],
} as const;
export const assistantDraftV2Schema = {
  ...object(
    "AssistantDraftV2",
    {
      kind,
      answer: { type: "string", maxLength: 16000, description: "Plain text. Source references are optional; [1], [2] index the citations array when supplied." },
      citations: array(ref("CitationReference"), 30),
      result_ids: array(recordReferenceId, 100),
      actions: array(
        {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { const: "set_filters" },
                ...patchProperties,
              },
              required: ["type", "set", "clear"],
              additionalProperties: false,
              allOf: patchConstraints,
            },
            focusAction,
            timelineAction,
          ],
        } as const,
        8,
      ),
      clarification_reason: clarification,
    },
    [
      "kind",
      "answer",
      "citations",
      "result_ids",
      "actions",
      "clarification_reason",
    ],
  ),
  allOf: [
    {
      if: {
        properties: {
          kind: { enum: ["clarification", "empty", "action_summary"] },
        },
      },
      then: {
        properties: {
          citations: { type: "array", maxItems: 0 },
          result_ids: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: { properties: { kind: { const: "clarification" } } },
      then: { properties: { clarification_reason: clarificationReason } },
    },
  ],
} as const;
export const citationV2Schema = object(
  "CitationV2",
  {
    ...citationSchema.properties,
    number: { type: "integer", minimum: 1, maximum: 30 },
    published_at: nullableUtcDateTime,
    published_date: nullableCalendarDate,
    observed_at: nullableUtcDateTime,
    observed_from: nullableUtcDateTime,
    observed_to: nullableUtcDateTime,
    period_start: nullableUtcDateTime,
    period_end: nullableUtcDateTime,
  },
  [
    ...citationSchema.required,
    "number",
    "published_at",
    "published_date",
    "observed_at",
    "observed_from",
    "observed_to",
    "period_start",
    "period_end",
  ],
);
export const assistantResponseV2Schema = {
  ...object(
    "AssistantResponseV2",
    {
      ...assistantResponseSchema.properties,
      protocol_version: { const: 2 },
      kind,
      answer: { ...text, maxLength: 16000 },
      actions: array(ref("UIActionV2"), 8),
      citations: array(ref("CitationV2"), 30),
      search: nullable({
        type: "object",
        properties: {
          filters: ref("NewsQuery"),
          returned_count: { type: "integer", minimum: 0, maximum: 100 },
          limit,
          offset,
        },
        required: ["filters", "returned_count", "limit", "offset"],
        additionalProperties: false,
      } as const),
      resolved_range: nullable({
        type: "object",
        properties: {
          from: utcDateTime,
          to: utcDateTime,
          timezone: request.timezone,
          label: { ...text, maxLength: 200 },
          target,
        },
        required: ["from", "to", "timezone", "label", "target"],
        additionalProperties: false,
      } as const),
      timeline: nullable(ref("OpenTimelineArgs")),
    },
    [
      ...assistantResponseSchema.required,
      "protocol_version",
      "kind",
      "search",
      "resolved_range",
      "timeline",
    ],
  ),
  allOf: [
    {
      if: { properties: { mode: { const: "fallback" } } },
      then: {
        properties: {
          kind: { const: "answer" },
          citations: { type: "array", maxItems: 0 },
          result_ids: { type: "array", maxItems: 0 },
          actions: { type: "array", maxItems: 0 },
          search: { type: "null" },
          resolved_range: { type: "null" },
          timeline: { type: "null" },
        },
      },
    },
    {
      if: { properties: { kind: { const: "clarification" } } },
      then: { properties: { actions: { type: "array", maxItems: 0 } } },
    },
  ],
} as const;
export const assistantV2Schemas = {
  AssistantRequestV2: assistantRequestV2Schema,
  AssistantIntent: assistantIntentSchema,
  AssistantFilterPatch: assistantFilterPatchSchema,
  OpenTimelineArgs: openTimelineArgsSchema,
  UIActionV2: uiActionV2Schema,
  AssistantDraftV2: assistantDraftV2Schema,
  CitationV2: citationV2Schema,
  AssistantResponseV2: assistantResponseV2Schema,
} as const;
export const assistantV2References = [
  newsQuerySchema,
  citationReferenceSchema,
  coverageSchema,
  openTimelineArgsSchema,
  uiActionV2Schema,
  citationV2Schema,
] as const;
const references = assistantV2References;
export type AssistantV2Contracts = {
  AssistantRequestV2: FromSchema<
    typeof assistantRequestV2Schema,
    { references: [...typeof references] }
  >;
  AssistantIntent: FromSchema<
    typeof assistantIntentSchema,
    { references: [...typeof references] }
  >;
  AssistantFilterPatch: FromSchema<
    typeof assistantFilterPatchSchema,
    { references: [...typeof references] }
  >;
  OpenTimelineArgs: FromSchema<
    typeof openTimelineArgsSchema,
    { references: [...typeof references] }
  >;
  UIActionV2: FromSchema<
    typeof uiActionV2Schema,
    { references: [...typeof references] }
  >;
  AssistantDraftV2: FromSchema<
    typeof assistantDraftV2Schema,
    { references: [...typeof references] }
  >;
  CitationV2: FromSchema<
    typeof citationV2Schema,
    { references: [...typeof references] }
  >;
  AssistantResponseV2: FromSchema<
    typeof assistantResponseV2Schema,
    { references: [...typeof references] }
  >;
};
