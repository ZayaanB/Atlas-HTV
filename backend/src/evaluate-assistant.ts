import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readConfig } from './config.js';
import { loadHandoffs } from './runtime/handoffs.js';
import { type Contracts, type Data, object, records } from './services/validation.js';

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Scores recorded traces without generating answers or contacting providers.
 * Expected actions include full targets/values, not just matching tool names. */
export function evaluateAssistantTraces(contracts: Contracts, input: unknown): Data {
  const cases = records(input);
  if (!cases.length || cases.length > 1000) throw new Error('Supply 1–1000 recorded scenarios.');
  const totals = { task_completion: 0, unnecessary_clarification: 0, reference_resolution: 0, scope_correctness: 0, action_correctness: 0 };
  for (const scenario of cases) {
    const request = contracts.parse('AssistantRequestV3', scenario.request);
    const response = contracts.parse('AssistantResponseV3', scenario.response, true);
    const expected = object(scenario.expected);
    if (typeof expected.clarification !== 'boolean' || !Array.isArray(expected.reference_ids) || expected.reference_ids.some(id => typeof id !== 'string'))
      throw new Error('Each scenario needs expected.clarification, reference_ids, research_scope and actions.');
    contracts.parse('NewsQuery', expected.research_scope);
    for (const action of records(expected.actions)) contracts.parse('UIActionV3', action);
    const context = request.request_id === response.request_id && equal(request.workspace, response.context);
    const clarification = (response.kind === 'clarification') === expected.clarification;
    const references = equal(records(response.references).map(reference => reference.id), expected.reference_ids);
    const scope = equal(response.research_scope, expected.research_scope);
    const actions = equal(response.actions, expected.actions);
    if (!expected.clarification && response.kind === 'clarification') totals.unnecessary_clarification++;
    if (references) totals.reference_resolution++;
    if (scope) totals.scope_correctness++;
    if (actions) totals.action_correctness++;
    if (context && clarification && references && scope && actions && response.mode !== 'fallback') totals.task_completion++;
  }
  return { scenarios: cases.length, ...totals, network_calls: 0,
    evaluation_scope: 'Recorded response behavior only. These scores do not establish unrecorded Gemini intent quality, factual truth, live coverage or provider latency.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Deliberately no .env, model, database pool, ingestion, or external request.
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run evaluate:assistant -- /path/to/recorded-v3-scenarios.json');
    const { contracts } = await loadHandoffs(readConfig({ NODE_ENV: 'test', ATLAS_CONTRACTS_MODULE: 'contracts/dist/index.js' }));
    const input: unknown = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
    console.log(JSON.stringify(evaluateAssistantTraces(contracts, input), null, 2));
  } catch { console.error('Evaluation needs a valid local v3 scenario file. See backend/docs/assistant-v3.md for its format. No provider request was made.'); process.exitCode = 1; }
}
