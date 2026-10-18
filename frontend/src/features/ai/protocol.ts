import type {
  AssistantRequestV2,
  AssistantResponseV2,
  AssistantStreamEvent,
} from "@atlas/contracts";
import { readContract } from "../../lib/validation";

export interface Exchange {
  id: string;
  question: string;
  status: "pending" | "complete" | "failed" | "cancelled";
  response?: AssistantResponseV2;
  error?: {
    message: string;
    code: string;
    retryable: boolean;
    requestId: string | null;
  };
  historyOmitted?: boolean;
  preview?: string | undefined;
  phase?: Extract<AssistantStreamEvent, { type: "status" }>["phase"] | undefined;
}
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Retain a contiguous suffix of whole eligible exchanges. Stored text is never edited. */
export function packHistory(
  base: AssistantRequestV2,
  exchanges: readonly Exchange[],
) {
  const request = {
    ...base,
    history: [] as NonNullable<AssistantRequestV2["history"]>,
  };
  readContract("AssistantRequestV2", request);
  if (bytes(request) > 65536)
    throw new Error(
      "Shorten the question or simplify its context; the request exceeds 65,536 bytes.",
    );
  const eligible = exchanges.filter(
    (e) =>
      e.status === "complete" && e.response && e.response.mode !== "fallback",
  );
  let included = 0;
  for (const exchange of eligible.slice().reverse()) {
    if (
      included === 6 ||
      [...exchange.question].length > 4000 ||
      [...exchange.response!.answer].length > 4000
    )
      break;
    const pair: NonNullable<AssistantRequestV2["history"]> = [
      { role: "user", content: exchange.question },
      { role: "assistant", content: exchange.response!.answer },
    ];
    const candidate = { ...request, history: [...pair, ...request.history] };
    if (bytes(candidate) > 65536) break;
    request.history = candidate.history;
    included++;
  }
  readContract("AssistantRequestV2", request);
  return { request, omitted: included < eligible.length };
}
export function validateAnswer(
  response: AssistantResponseV2,
) {
  if (
    (response.mode === "fallback" || response.kind === "clarification") &&
    response.actions.length
  )
    throw new Error(
      "Fallback and clarification responses cannot change the workspace.",
    );
  if (
    response.resolved_range &&
    (Date.parse(response.resolved_range.to) <
      Date.parse(response.resolved_range.from) ||
      Date.parse(response.resolved_range.to) -
        Date.parse(response.resolved_range.from) >
        366 * 86400000)
  )
    throw new Error("The assistant returned an invalid resolved date range.");
  if (response.mode === "fallback") {
    if (
      response.citations.length ||
      response.result_ids.length ||
      response.search ||
      response.timeline ||
      response.resolved_range
    )
      throw new Error("The fallback response contains unsupported results.");
    return;
  }
}
