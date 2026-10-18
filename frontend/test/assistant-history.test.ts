import { expect, it } from "vitest";
import { packHistory, type Exchange } from "../src/features/ai/protocol";
import type { AssistantRequestV2, AssistantResponseV2 } from "@atlas/contracts";
const base: AssistantRequestV2 = {
  protocol_version: 2,
  request_id: "r",
  message: "Current question",
  timezone: "UTC",
  interaction_mode: "intent",
};
function exchange(
  n: number,
  question = `Question ${n}`,
  answer = `Answer ${n}`,
): Exchange {
  return {
    id: String(n),
    question,
    status: "complete",
    response: {
      protocol_version: 2,
      kind: "answer",
      request_id: String(n),
      mode: "fixture",
      answer,
      citations: [],
      result_ids: [],
      actions: [],
      coverage: { mode: "fixture", live: false },
      errors: [],
      search: null,
      resolved_range: null,
      timeline: null,
    },
  };
}
it("uses at most six complete previous exchanges and excludes pending/failed/cancelled/fallback turns", () => {
  const exchanges = Array.from({ length: 8 }, (_, n) => exchange(n));
  exchanges.push(
    { ...exchange(8), status: "pending" },
    { ...exchange(9), status: "failed" },
    { ...exchange(10), status: "cancelled" },
    {
      ...exchange(11),
      response: { ...exchange(11).response!, mode: "fallback" },
    },
  );
  const packed = packHistory(base, exchanges);
  expect(packed.request.history).toHaveLength(12);
  expect(packed.request.history![0]!.content).toBe("Question 2");
  expect(packed.omitted).toBe(true);
  expect(packed.request.history!.some((m) => m.content === base.message)).toBe(
    false,
  );
});
it("stops at an oversized exchange while leaving every stored character intact", () => {
  const exchanges = [
    exchange(0),
    exchange(1, "Big question", "x".repeat(4001)),
    exchange(2),
  ];
  const packed = packHistory(base, exchanges);
  expect(packed.request.history).toHaveLength(2);
  expect(packed.request.history![0]!.content).toBe("Question 2");
  expect(exchanges[1]!.response!.answer).toHaveLength(4001);
  expect(packed.omitted).toBe(true);
});
it("packs by UTF-8 bytes, including Unicode, JSON escaping, and the complete base context", () => {
  const exchanges = Array.from({ length: 6 }, (_, n) =>
    exchange(n, "😀".repeat(4000), "😀".repeat(4000)),
  );
  const packed = packHistory(base, exchanges);
  expect(
    new TextEncoder().encode(JSON.stringify(packed.request)).byteLength,
  ).toBeLessThanOrEqual(65536);
  expect(packed.request.history).toHaveLength(4);
  expect(packed.omitted).toBe(true);
  expect(packed.request.history![0]!.content).toBe("😀".repeat(4000));
});
it("rejects an oversized base without trimming the current question", () => {
  const large = {
    ...base,
    message: "😀".repeat(4000),
    filters: {
      location_ids: Array.from(
        { length: 100 },
        (_, n) => `loc-${n}-` + "a".repeat(150),
      ),
      themes: Array.from(
        { length: 100 },
        (_, n) => `theme-${n}-` + "a".repeat(149),
      ),
      entity_ids: Array.from(
        { length: 100 },
        (_, n) => `ent-${n}-` + "a".repeat(150),
      ),
    },
  };
  // Increase escaping bytes without changing valid character bounds.
  large.filters.location_ids = large.filters.location_ids.map((s) =>
    s.slice(0, 160),
  );
  large.filters.entity_ids = large.filters.entity_ids.map((s) =>
    s.slice(0, 160),
  );
  large.filters.themes = large.filters.themes.map((s) => s.slice(0, 160));
  const extra = {
    ...large,
    filters: { ...large.filters, semantic_query: "😀".repeat(4000) },
  };
  expect(() => packHistory(extra, [])).toThrow(/65,536 bytes/);
  expect(extra.message).toBe("😀".repeat(4000));
});
