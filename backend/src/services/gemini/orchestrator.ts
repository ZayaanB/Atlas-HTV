import type { Content, FunctionDeclaration } from '@google/genai';
import type { Config } from '../../config.js';
import { AppError, bounded, checkAbort,unavailable } from '../../runtime/errors.js';
import { Contracts, type Data, object, records, string, strings } from '../validation.js';
import { Retrieval } from '../retrieval.js';
import type { Flights } from '../flights.js';
import { EvidenceLedger } from './citations.js';
import { type Model, parseModelJson } from './client.js';
import { isTool, Tools, toolSchemas } from './tools.js';
import { audienceContext } from './audience.js';
import {modelParameters} from './schema.js';
import {modelFailure} from './errors.js';
import { CoreAssistant, requireV2Contracts } from './v2.js';
export class Assistant {
  private active = 0;
  private retryUntil=0;
  constructor(private config: Config, private contracts: Contracts, private retrieval: Retrieval, private flights?: Flights, private model?: Model,private clock=Date.now, private diagnostic?: (event: Data) => void) {}
  async answer(raw: unknown, parent?: AbortSignal, progress?: (event: Data) => Promise<void>): Promise<Data> {
    checkAbort(parent);
    const v2 = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && (raw as Data).protocol_version === 2;
    if (v2) requireV2Contracts(this.contracts);
    const input = this.contracts.parse(v2 ? 'AssistantRequestV2' : 'AssistantRequest', raw);
    for (const name of (v2 ? ['Citation'] : ['AssistantDraft','AssistantResponse','Citation',...(input.allow_ui_actions===true?['UIAction']:[])]))
      if (!this.contracts.has(name)) throw unavailable('CONTRACTS_UNAVAILABLE',`Shared schema ${name} has not been supplied`);
    audienceContext(input.audience);
    if (Buffer.byteLength(JSON.stringify(input)) > (v2 ? 65536 : 24000) || (v2 ? [...string(input.message)].length : string(input.message).length) > 4000) throw new AppError('REQUEST_TOO_LARGE', 'Assistant request exceeds safety bound', 413);
    if (v2 && (input.allow_ui_actions !== undefined || records(input.history).length > 12 || records(input.history).some(turn => [...string(turn.content)].length > 4000)))
      throw new AppError('INVALID_INPUT', 'V2 uses bounded history and interaction_mode, not allow_ui_actions');
    if (this.active >= this.config.aiConcurrency) throw new AppError('ASSISTANT_BUSY', 'Assistant concurrency limit reached', 429, true);
    try { new Intl.DateTimeFormat('en', { timeZone: string(input.timezone) }); }
    catch { throw new AppError('INVALID_TIMEZONE', 'Use a valid IANA timezone'); }
    const signal = AbortSignal.any([AbortSignal.timeout(this.config.aiTimeoutMs), ...(parent ? [parent] : [])]);
    this.active++;
    try {
      if (progress) await bounded(progress({ type: 'status', phase: 'reading' }), signal);
      return await bounded(v2 ? new CoreAssistant(this.config, this.contracts, this.retrieval, input, this.model,
        this.clock, this.clock() < this.retryUntil, () => { this.retryUntil = this.clock() + 60000; }, progress, this.diagnostic).run(signal) : this.run(input,signal), signal);
    }
    finally { this.active--; }
  }
  private async run(input: Data, signal: AbortSignal): Promise<Data> {
    const ledger = new EvidenceLedger(), tools = new Tools(this.contracts,this.retrieval,this.flights,object(input.filters ?? {}),input.allow_ui_actions === true);
    const initial = await this.retrieval.news(input.filters ?? {},signal);
    ledger.collect(initial);
    const selected = input.selected_investigation_id ? await this.retrieval.investigation({id:input.selected_investigation_id},signal) : null;
    ledger.collect(selected);
    const sources=await this.retrieval.sources([...ledger.sourceIds],signal);
    ledger.attach(sources);
    if (!this.model) return this.fallback(input, initial, 'GEMINI_UNAVAILABLE',signal);
    if (this.clock()<this.retryUntil) return this.fallback(input,initial,new AppError('GEMINI_RATE_LIMITED','Gemini requests are in shared quota backoff',503,true),signal);
    const contents: Content[] = [{ role: 'user', parts: [{ text: JSON.stringify({
      request: input, audience_context: audienceContext(input.audience), current_utc: new Date(this.clock()).toISOString(), evidence: initial, sources, selected_investigation: selected
    }) }] }];
    const prerequisites: Record<string,string[]>={search_locations:['LocationsResponse','Location'],get_investigation:['InvestigationResponse'],compare_observations:['ObservationsQuery','ObservationsResponse','Observation'],
      get_aircraft_in_region:['FlightsResponse','AircraftState','FlightRegion'],find_aircraft:['FlightsResponse','AircraftState','FlightRegion'],
      set_filters:['UIAction','LocationsQuery','LocationsResponse','Location'],focus_location:['UIAction','LocationsQuery','LocationsResponse','Location']};
    const declarations: FunctionDeclaration[] = Object.entries(toolSchemas).filter(([name,schema]) => this.contracts.has(schema) &&
      (prerequisites[name] ?? []).every(required=>this.contracts.has(required)) &&
      (this.config.flightsEnabled || !['get_aircraft_in_region','find_aircraft'].includes(name)) &&
      (input.allow_ui_actions === true || !['set_filters','focus_location'].includes(name))).map(([name,schema]) => ({
      name, description: `Atlas validated ${name}; preserve active filters unless user requests a change`,
      parametersJsonSchema: modelParameters(this.contracts,schema)
    }));
    declarations.push({name:'respond',description:'Finish with an evidence-backed answer and source/record references. Never combine this with other calls in the same turn.',parametersJsonSchema:modelParameters(this.contracts,'AssistantDraft')});
    let calls = 0;
    try {
      for (let round = 0; round < this.config.aiMaxRounds; round++) {
        checkAbort(signal);
        if (Buffer.byteLength(JSON.stringify(contents)) > this.config.aiMaxContextBytes) throw new AppError('CONTEXT_LIMIT', 'Retrieved evidence exceeded assistant context limit', 502);
        const turn = await bounded(this.model.generate(contents,declarations,signal),signal);
        checkAbort(signal);
        if (turn.calls.length) {
          if (calls+turn.calls.length > this.config.aiMaxTools) throw new AppError('TOOL_LIMIT', 'Assistant tool limit reached', 502);
          if (turn.calls.some(call=>call.name==='respond')) {
            if (turn.calls.length!==1) throw new AppError('INVALID_MODEL_OUTPUT','Final response must be the only call in its turn',502);
            const draft=this.contracts.parse('AssistantDraft',turn.calls[0]!.args,true);
            return await this.finish(input,draft,initial,ledger,tools,signal);
          }
          contents.push(turn.content);
          const parts = [];
          for (const call of turn.calls) {
            checkAbort(signal);
            calls++;
            if (!isTool(call.name) || !declarations.some(declaration=>declaration.name===call.name)) throw new AppError('INVALID_TOOL', 'Assistant proposed an unsupported tool', 502);
            let result: Data;
            try { result = await tools.dispatch(call.name,call.args,signal); ledger.collect(result); }
            catch (error) {
              if (!(error instanceof AppError) || !['INVALID_INPUT','INVALID_TIME','INVALID_RANGE','NOT_FOUND','INVALID_REGION','FLIGHTS_DISABLED','FLIGHTS_UNAVAILABLE','FILTER_CONFLICT','INCOMPARABLE_OBSERVATIONS'].includes(error.code)) throw error;
              result = { error: {code:error.code,message:error.message} };
            }
            parts.push({ functionResponse: { name: call.name, id:call.id, response: result } });
          }
          contents.push({role:'user',parts});
          continue;
        }
        const draft = this.contracts.parse('AssistantDraft',parseModelJson(turn.text),true);
        return await this.finish(input,draft,initial,ledger,tools,signal);
      }
      throw new AppError('TOOL_LIMIT','Assistant iteration limit reached',502);
    } catch (error) {
      checkAbort(signal);
      const failure=modelFailure(error);
      if (failure.code==='GEMINI_RATE_LIMITED') this.retryUntil=this.clock()+60000;
      // Reject all pending actions when synthesis/validation fails. Manual browsing remains usable.
      return this.fallback(input,initial,failure,signal);
    }
  }
  private async finish(input:Data,draft:Data,initial:Data,ledger:EvidenceLedger,tools:Tools,signal:AbortSignal):Promise<Data> {
    const actions: Data[] = [];
    for (const action of [...tools.actions,...records(draft.actions)]) {
      const valid = await tools.action(action,signal);
      if (!actions.some(a => JSON.stringify(a) === JSON.stringify(valid))) {
        if (actions.length >= 8) throw new AppError('ACTION_LIMIT','Too many UI actions',502);
        // A final-draft filter change must execute the same query as its tool
        // counterpart before results/actions can be returned to the browser.
        if (valid.type === 'set_filters' && !tools.actions.some(a => JSON.stringify(a) === JSON.stringify(valid)))
          ledger.collect(await tools.dispatch('set_filters', valid.filters, signal));
        actions.push(valid);
      }
    }
    ledger.attach(await this.retrieval.sources([...ledger.sourceIds],signal));
    const citations = ledger.resolve(draft.citations,this.contracts);
    if (!citations.length && ledger.sourceIds.size) throw new AppError('UNCITED_ANSWER','Assistant omitted retrieved citations',502);
    if (!ledger.sourceIds.size && string(draft.answer).trim()) throw new AppError('UNGROUNDED_ANSWER','No source-backed answer is available',502);
    if (strings(draft.result_ids).some(id => !ledger.resultIds.has(id))) throw new AppError('INVALID_RESULT','Assistant returned an unretrieved result',502);
    const resultIds = tools.latestNews ? records(tools.latestNews.items).map(r => r.id) : draft.result_ids;
    checkAbort(signal);
    return this.contracts.parse('AssistantResponse', { request_id:input.request_id,answer:draft.answer,citations,
      result_ids:resultIds,actions,coverage:initial.coverage,mode:this.retrieval.repository.mode === 'fixture' ? 'fixture' : 'live',errors:[] },true);
  }
  private fallback(input: Data, initial: Data, failure: string|AppError, signal: AbortSignal): Data {
    checkAbort(signal);
    return this.contracts.parse('AssistantResponse', {
      request_id:input.request_id,answer:'Assistant explanation unavailable. Use the source-linked results and manual filters; no AI explanation has been generated.',
      citations:[],result_ids:records(initial.items).map(r => r.id),actions:[],coverage:initial.coverage,mode:'fallback',
      errors:[{code:typeof failure==='string'?failure:failure.code,message:'Assistant unavailable or output rejected',retryable:typeof failure==='string'||failure.retryable}]
    },true);
  }
}
