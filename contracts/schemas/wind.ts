import type { FromSchema } from "json-schema-to-ts";
import { bounds, coordinates, draft, nullableText, recordId, text, utcDateTime } from "./common.js";

const windQuery = {
  $schema: draft, type: "object", additionalProperties: false,
  properties: { bounds }, required: ["bounds"],
} as const;
const windSample = {
  $schema: draft, type: "object", additionalProperties: false,
  properties: {
    id: recordId,
    coordinates,
    model_coordinates: coordinates,
    speed_kmh: { type: "number", minimum: 0, maximum: 500 },
    direction_from_degrees: { anyOf: [{ type: "number", minimum: 0, maximum: 360 }, { type: "null" }] },
    valid_at: utcDateTime,
  },
  required: ["id", "coordinates", "model_coordinates", "speed_kmh", "direction_from_degrees", "valid_at"],
} as const;
const windResponse = {
  $schema: draft, type: "object", additionalProperties: false,
  properties: {
    items: { type: "array", items: windSample, maxItems: 9 }, bounds,
    requested_points: { const: 9 },
    height_m: { const: 10 }, kind: { const: "model_estimate" },
    provider: { const: "open-meteo" },
    fetched_at: utcDateTime, next_refresh_at: utcDateTime,
    stale: { type: "boolean" }, warning: nullableText,
    attribution: text, source_url: { const: "https://open-meteo.com/en/docs" },
    license: { const: "CC-BY-4.0" },
  },
  required: ["items", "bounds", "requested_points", "height_m", "kind", "provider", "fetched_at", "next_refresh_at", "stale", "warning", "attribution", "source_url", "license"],
} as const;
export const windSchemas = { WindQuery: windQuery, WindSample: windSample, WindResponse: windResponse } as const;
export type WindContracts = {
  WindQuery: FromSchema<typeof windQuery>;
  WindSample: FromSchema<typeof windSample>;
  WindResponse: FromSchema<typeof windResponse>;
};
