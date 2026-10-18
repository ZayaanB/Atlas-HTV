import type { Content, FunctionDeclaration } from '@google/genai';
import type { Config } from '../../config.js';
import { AppError } from '../../runtime/errors.js';
import { object, records, type Data } from '../validation.js';
import type { ModelOptions } from './client.js';
import { modelRequestBytes } from './request.js';

export const TOOL_BYTES = 8000;
export const HISTORY_BYTES = 24000;
export const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export function historyPairs(history: unknown): Data[] {
  const turns = records(history), pairs: Data[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    if (turns[i]!.role === 'user' && turns[i + 1]!.role === 'assistant') {
      pairs.push({ user: turns[i]!.content, assistant: turns[++i]!.content });
    }
  }
  return pairs.reverse().map((pair, index) => ({ index, ...pair }));
}
export function initialHistory(history: unknown): Data[] {
  const chosen: Data[] = [];
  for (const pair of historyPairs(history).slice(0, 6)) {
    if (byteLength([...chosen, pair]) > HISTORY_BYTES) break;
    chosen.push(pair);
  }
  return chosen.reverse();
}
export function compactRequest(input: Data, filters: Data): Data {
  const selection: Data = {};
  for (const key of ['selected_article_id', 'selected_investigation_id', 'selected_location_id', 'selected_bounds'])
    if (input[key] !== undefined) selection[key] = input[key];
  return {
    message: input.message, timezone: input.timezone, selection,
    scope: { active_filter_keys: Object.keys(filters).filter(key => !['limit', 'offset'].includes(key)),
      publication_from: filters.published_from ?? null, publication_to: filters.published_to ?? null,
      selected_evidence_exception: true, general_searches: 'within_active_filters' },
    history: initialHistory(input.history), history_available: historyPairs(input.history).length,
  };
}
export interface ResearchBlock { contents: [Content, Content]; records: Data[]; references: string[]; dependsOn?: string[] }
export class PromptBudget {
  readonly limit: number;
  evictions = 0;
  historyOmitted = false;
  constructor(private config: Config) { this.limit = config.aiMaxContextBytes; }
  fit(base: Data, blocks: ResearchBlock[], declarations: FunctionDeclaration[], options?: ModelOptions) {
    const root = structuredClone(base);
    const content = (): Content[] => [{ role: 'user', parts: [{ text: JSON.stringify(root) }] }, ...blocks.flatMap(block => block.contents)];
    let contents = content();
    while (modelRequestBytes(this.config, contents, declarations, options) > this.limit && blocks.length) {
      const removed = blocks.shift()!; this.evictions++;
      const missing = new Set(removed.references);
      for (let i = 0; i < blocks.length;) {
        if (blocks[i]!.dependsOn?.some(reference => missing.has(reference))) {
          const [dependent] = blocks.splice(i, 1); dependent!.references.forEach(reference => missing.add(reference)); this.evictions++;
        } else i++;
      }
      contents = content();
    }
    if (modelRequestBytes(this.config, contents, declarations, options) > this.limit) {
      const request = object(root.request);
      while (records(request.history).length && modelRequestBytes(this.config, contents, declarations, options) > this.limit) {
        request.history = records(request.history).slice(1); this.historyOmitted = true; contents = content();
      }
    }
    const bytes = modelRequestBytes(this.config, contents, declarations, options);
    if (bytes > this.limit) throw new AppError('REQUEST_TOO_LARGE', 'The question and required tool instructions cannot fit the research budget. Shorten the question.', 413);
    return { contents, bytes };
  }
}

// Schemas remain authoritative at dispatch. Omit runtime-only cross-property
// constraints from model hints; keep the property shapes, enums and scalar bounds.
export function compactParameters(value: unknown): Data {
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['allOf', 'if', 'then', 'else', 'not', 'contains', 'patternProperties', 'dependentSchemas'].includes(key))
      .map(([key, child]) => [key, walk(child)]));
  }
  return object(walk(value));
}
