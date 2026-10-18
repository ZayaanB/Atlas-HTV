import type { FromSchema } from "json-schema-to-ts";
import { draft } from "./common.js";
import { apiErrorSchema } from "./responses.js";
import { assistantResponseV2Schema, assistantV2References } from "./assistant-v2.js";

const request_id = assistantResponseV2Schema.properties.request_id;
const event = <const P extends Record<string, object>, const R extends readonly (keyof P & string)[]>(properties: P, required: R) => ({
  type: "object", properties: { request_id, ...properties },
  required: ["request_id", ...required], additionalProperties: false,
}) as const;
export const assistantStreamEventSchema = {
  $schema: draft, $id: "https://atlas.invalid/contracts/AssistantStreamEvent",
  oneOf: [
    event({ type: { const: "status" }, phase: { enum: ["reading", "interpreting", "researching", "writing", "validating"] } }, ["type", "phase"]),
    event({ type: { const: "answer_delta" }, text: { type: "string", minLength: 1, maxLength: 16000 } }, ["type", "text"]),
    event({ type: { const: "complete" }, response: { $ref: assistantResponseV2Schema.$id } }, ["type", "response"]),
    event({ type: { const: "error" }, error: apiErrorSchema.properties.error }, ["type", "error"]),
  ],
} as const;
export type AssistantStreamEventContract = FromSchema<typeof assistantStreamEventSchema, {
  references: [typeof assistantResponseV2Schema, ...typeof assistantV2References];
}>;
