import { readFile } from 'node:fs/promises';
import { readConfig } from './config.js';
import { loadHandoffs } from './runtime/handoffs.js';
import { Assistant } from './services/gemini/orchestrator.js';
import { Retrieval, matchesNews } from './services/retrieval.js';
import { records, strings, type Data } from './services/validation.js';
import type { Repository } from './data/queries.js';
import type { Model } from './services/gemini/client.js';
import { byteLength } from './services/gemini/budget.js';

// Deliberately no .env, database pool or real model. Uses authoritative historical
// examples and the production orchestrator to profile its exact assembled input.
const config = readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js',
  AI_MAX_CONTEXT_BYTES: '128000', AI_MAX_ROUNDS: '6', AI_REQUEST_TIMEOUT_MS: '50000' });
const { contracts } = await loadHandoffs(config);
const core = JSON.parse(await readFile(new URL('../../contracts/examples/helene-core.json', import.meta.url), 'utf8'));
const research = JSON.parse(await readFile(new URL('../../contracts/examples/helene-research.json', import.meta.url), 'utf8'));
const investigation = research.investigations[0];
const item = investigation.investigation.items.find((row: Data) => strings(row.source_ids).length);
const report: Data[] = [];
for (const history of [[], Array.from({ length: 6 }, (_, index) => [
  { role: 'user', content: `Previous question ${index}: ` + 'q'.repeat(400) },
  { role: 'assistant', content: `Previous answer ${index}: ` + 'a'.repeat(400) },
]).flat()]) {
  const repository: Repository = {
    mode: 'fixture', health: async () => true, close: async () => {},
    read: async (name, args) => {
      if (name === 'freshness') return [];
      if (name === 'workspace') return [research.workspace];
      if (name === 'article') return core.articles.filter((row: Data) => row.id === args.id);
      if (name === 'sources') return core.sources.filter((row: Data) => strings(args.ids).includes(String(row.id)));
      if (name === 'locations') return core.locations.filter((row: Data) => !strings(args.ids).length || strings(args.ids).includes(String(row.id)));
      if (name === 'investigation') return research.investigations.filter((row: Data) => (row.investigation as Data).id === args.id);
      if (name === 'news') return core.articles.filter((row: Data) => matchesNews(row, args)).slice(Number(args.offset), Number(args.offset) + Number(args.limit));
      throw new Error('Unexpected offline profile query');
    },
  };
  let round = 0, peakToolBytes = 0;
  const metrics: Data[] = [];
  const model: Model = { generate: async contents => {
    for (const content of contents) for (const part of content.parts ?? []) if (part.functionResponse) peakToolBytes = Math.max(peakToolBytes, byteLength(part.functionResponse.response));
    const turns = [
      { name: 'interpret_request', args: { actions: [], filter_keys: [], clear_filters: [], clarification_reason: null, use_current_area: false, date_expression: null, date_target: null } },
      { name: 'get_investigation', args: { id: investigation.investigation.id } },
      { name: 'get_investigation', args: { id: investigation.investigation.id, section: 'items', limit: 3 } },
      { name: 'respond', args: { kind: 'answer', answer: 'Offline profiling response [1].', citations: [{ source_id: item.source_ids[0], record_id: item.id }], result_ids: [item.id], actions: [], clarification_reason: null } },
    ];
    const call = turns[round++];
    if (!call) throw new Error('Unexpected profiling generation round');
    return { content: { role: 'model', parts: [{ functionCall: call }] }, calls: [call], text: '' };
  } };
  const result = await new Assistant(config, contracts, new Retrieval(contracts, repository), undefined, model, Date.now, event => metrics.push(event)).answer({
    protocol_version: 2, interaction_mode: 'intent', request_id: 'offline-profile',
    message: 'What do the selected investigation’s stored records establish?', timezone: 'America/Toronto', filters: { limit: 50 },
    selected_investigation_id: investigation.investigation.id, history,
  });
  if (result.mode !== 'fixture') throw new Error('Offline profiling response failed validation');
  const requests = metrics.filter(event => event.phase === 'model_request');
  report.push({ scenario: history.length ? 'six_supplied_exchanges' : 'selected_investigation',
    interpretation_bytes: requests[0]!.input_bytes, initial_research_bytes: requests[1]!.input_bytes,
    peak_input_bytes: Math.max(...requests.map(event => Number(event.input_bytes))), peak_tool_payload_bytes: peakToolBytes,
    generation_rounds: requests.length, initial_history_pairs: requests[1]!.initial_history_pairs,
    validated_citations: records(result.citations).length });
}
console.log(JSON.stringify({ profile: 'offline_historical_fixture', live_provider_or_database_calls: false,
  working_ceiling_bytes: 48000, hard_guard_bytes: config.aiMaxContextBytes, scenarios: report }, null, 2));
