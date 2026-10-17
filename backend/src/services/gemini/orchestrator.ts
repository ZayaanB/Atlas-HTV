import type { Content, FunctionDeclaration } from '@google/genai';
import type { Config } from '../../config.js';
import { AppError, bounded, checkAbort } from '../../runtime/errors.js';
import { Contracts, type Data, object, records, string, strings } from '../validation.js';
import { Retrieval } from '../retrieval.js';
import type { Flights } from '../flights.js';
import { EvidenceLedger } from './citations.js';
import { type Model, parseModelJson } from './client.js';
import { isTool, Tools, toolSchemas } from './tools.js';
import { audienceContext } from './audience.js';
export class Assistant {
  private active = 0;
  constructor(private config: Config, private contracts: Contracts, private retrieval: Retrieval, private flights?: Flights, private model?: Model) {}
  async answer(raw: unknown, parent?: AbortSignal): Promise<Data> {
    checkAbort(parent);
    const input = this.contracts.parse('AssistantRequest', raw);
    audienceContext(input.audience);
    if (Buffer.byteLength(JSON.stringify(input)) > 24000 || string(input.message).length > 4000) throw new AppError('REQUEST_TOO_LARGE', 'Assistant request exceeds safety bound', 413);
    if (this.active >= this.config.aiConcurrency) throw new AppError('ASSISTANT_BUSY', 'Assistant concurrency limit reached', 429, true);
    try { new Intl.DateTimeFormat('en', { timeZone: string(input.timezone) }); }
    catch { throw new AppError('INVALID_TIMEZONE', 'Use a valid IANA timezone'); }
    const signal = AbortSignal.any([AbortSignal.timeout(this.config.aiTimeoutMs), ...(parent ? [parent] : [])]);
    this.active++;
    try { return await bounded(this.run(input,signal), signal); }
    finally { this.active--; }
  }
  private async run(input: Data, signal: AbortSignal): Promise<Data> {
    const ledger = new EvidenceLedger(), tools = new Tools(this.contracts,this.retrieval,this.flights,object(input.filters ?? {}),input.allow_ui_actions === true);
    const initial = await this.retrieval.news(input.filters ?? {},signal);
    ledger.collect(initial);
    const selected = input.selected_investigation_id ? await this.retrieval.investigation({id:input.selected_investigation_id},signal) : null;
    ledger.collect(selected);
    ledger.attach(await this.retrieval.sources([...ledger.sourceIds],signal));
    if (!this.model) return this.fallback(input, initial, 'GEMINI_UNAVAILABLE',signal);
    const contents: Content[] = [{ role: 'user', parts: [{ text: JSON.stringify({
      request: input, audience_context: audienceContext(input.audience), current_utc: new Date().toISOString(), evidence: initial, selected_investigation: selected
    }) }] }];
    const declarations: FunctionDeclaration[] = Object.entries(toolSchemas).filter(([name,schema]) => this.contracts.has(schema) && (input.allow_ui_actions === true || !['set_filters','focus_location'].includes(name))).map(([name,schema]) => ({
      name, description: `Atlas validated ${name}; preserve active filters unless user requests a change`,
      parametersJsonSchema: this.contracts.schemas[schema]
    }));
    let calls = 0;
    try {
      for (let round = 0; round < this.config.aiMaxRounds; round++) {
        checkAbort(signal);
        if (Buffer.byteLength(JSON.stringify(contents)) > this.config.aiMaxContextBytes) throw new AppError('CONTEXT_LIMIT', 'Retrieved evidence exceeded assistant context limit', 502);
        const turn = await bounded(this.model.generate(contents,declarations,signal),signal);
        checkAbort(signal);
        if (turn.calls.length) {
          if (calls+turn.calls.length > this.config.aiMaxTools) throw new AppError('TOOL_LIMIT', 'Assistant tool limit reached', 502);
          contents.push(turn.content);
          const parts = [];
          for (const call of turn.calls) {
            checkAbort(signal);
            calls++;
            if (!isTool(call.name)) throw new AppError('INVALID_TOOL', 'Assistant proposed an unsupported tool', 502);
            let result: Data;
            try { result = await tools.dispatch(call.name,call.args,signal); ledger.collect(result); }
            catch (error) {
              if (!(error instanceof AppError) || !['INVALID_INPUT','INVALID_TIME','INVALID_RANGE','NOT_FOUND','INVALID_REGION','FLIGHTS_DISABLED','FLIGHTS_UNAVAILABLE','FILTER_CONFLICT'].includes(error.code)) throw error;
              result = { error: {code:error.code,message:error.message} };
            }
            parts.push({ functionResponse: { name: call.name, id:call.id, response: result } });
          }
          contents.push({role:'user',parts});
          continue;
        }
        ledger.attach(await this.retrieval.sources([...ledger.sourceIds],signal));
        const draft = this.contracts.parse('AssistantDraft',parseModelJson(turn.text),true);
        const citations = ledger.resolve(draft.citations,this.contracts);
        if (!citations.length && ledger.sourceIds.size) throw new AppError('UNCITED_ANSWER','Assistant omitted retrieved citations',502);
        if (!ledger.sourceIds.size && string(draft.answer).trim()) throw new AppError('UNGROUNDED_ANSWER','No source-backed answer is available',502);
        if (strings(draft.result_ids).some(id => !ledger.resultIds.has(id))) throw new AppError('INVALID_RESULT','Assistant returned an unretrieved result',502);
        const actions: Data[] = [];
        for (const action of [...tools.actions,...records(draft.actions)]) {
          if (actions.length >= 8) throw new AppError('ACTION_LIMIT','Too many UI actions',502);
          const valid = await tools.action(action,signal);
          if (!actions.some(a => JSON.stringify(a) === JSON.stringify(valid))) actions.push(valid);
        }
        checkAbort(signal);
        return this.contracts.parse('AssistantResponse', { request_id:input.request_id,answer:draft.answer,citations,
          result_ids:draft.result_ids,actions,coverage:initial.coverage,mode:this.retrieval.repository.mode === 'fixture' ? 'fixture' : 'live',errors:[] },true);
      }
      throw new AppError('TOOL_LIMIT','Assistant iteration limit reached',502);
    } catch (error) {
      checkAbort(signal);
      // Reject all pending actions when synthesis/validation fails. Manual browsing remains usable.
      return this.fallback(input,initial,error instanceof AppError ? error.code : 'GEMINI_UNAVAILABLE',signal);
    }
  }
  private fallback(input: Data, initial: Data, code: string, signal: AbortSignal): Data {
    checkAbort(signal);
    return this.contracts.parse('AssistantResponse', {
      request_id:input.request_id,answer:'Assistant explanation unavailable. Use the source-linked results and manual filters; no AI explanation has been generated.',
      citations:[],result_ids:records(initial.items).map(r => r.id),actions:[],coverage:initial.coverage,mode:'fallback',
      errors:[{code,message:'Assistant unavailable or output rejected',retryable:true}]
    },true);
  }
}
