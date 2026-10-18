import type { FunctionDeclaration } from '@google/genai';
import { createHash } from 'node:crypto';
import type { Config } from '../../config.js';
import { AppError, bounded, checkAbort, unavailable } from '../../runtime/errors.js';
import { Contracts, type Data, object, records, string, strings, bounds, page } from '../validation.js';
import { Retrieval } from '../retrieval.js';
import { type Model, parseModelJson } from './client.js';
import { EvidenceLedger } from './citations.js';
import { audienceContext } from './audience.js';
import { timelineTarget } from './context.js';
import { resolveDateRange } from './dates.js';
import { clarification, mergeFilterPatch, permissions } from './policy.js';
import { modelParameters } from './schema.js';
import { modelFailure } from './errors.js';
import { Tools } from './tools.js';
import { ResearchTools, type ResearchPage } from './research.js';
import { PromptBudget, compactParameters, compactRequest, byteLength, type ResearchBlock } from './budget.js';

// Names only: Person 1 supplies the sole authoritative schemas in contracts/.
// Missing exports stop v2 before retrieval or generation; v1 remains available.
export const requiredV2Schemas = ['AssistantRequestV2', 'AssistantResponseV2', 'AssistantDraftV2',
  'AssistantIntent', 'AssistantFilterPatch', 'OpenTimelineArgs', 'UIActionV2', 'CitationV2'] as const;
export function requireV2Contracts(contracts: Contracts): void {
  const missing = [...requiredV2Schemas, 'AssistantNewsSearchArgs', 'AssistantLocationsSearchArgs', 'AssistantArticleReadArgs',
    'AssistantInvestigationReadArgs', 'AssistantCatalogSearchArgs', 'AssistantSourcesReadArgs', 'AssistantHistoryReadArgs',
    'AssistantResearchRecord', 'AssistantToolResult'].filter(name => !contracts.has(name));
  if (missing.length) throw unavailable('CONTRACTS_UNAVAILABLE', `Assistant v2 awaits shared schemas: ${missing.join(', ')}`);
}

const actionTools = { set_filters: 'AssistantFilterPatch', focus_location: 'FocusLocationArgs', open_timeline: 'OpenTimelineArgs' } as const;
const recoverable = new Set(['INVALID_INPUT', 'INVALID_TIME', 'INVALID_RANGE', 'INVALID_BOUNDS', 'NOT_FOUND',
  'FILTER_CONFLICT', 'UNSUPPORTED_PERIOD', 'UNSUPPORTED_COVERAGE', 'INCOMPARABLE_OBSERVATIONS', 'TOOL_RESULT_TOO_LARGE']);

export class CoreAssistant {
  private ledger = new EvidenceLedger();
  private filters: Data;
  private latest: Data = {};
  private context: Data = {};
  private policy = permissions({}, {});
  private actions: Data[] = [];
  private suggestion: Data | null = null;
  private resolved: Data | null = null;
  private useCurrentArea = false;
  private investigations: Data[] = [];
  private initial: Data = {};
  private needsClarification: string | null = null;
  private locationChoices: string[] = [];
  private calls = 1;
  private searched: { query: Data; result: Data } | null = null;
  private research: ResearchTools;
  private budget: PromptBudget;
  private blocks: ResearchBlock[] = [];
  private reads = new Map<string, Promise<unknown>>();
  private articles = new Map<string, Data>();
  private searchedIds = new Set<string>();
  private discoveredInvestigations = new Set<string>();
  private stopReason: string | null = null;
  private started = 0;
  private lastInputBytes = 0;
  private lastRound = 0;
  constructor(private config: Config, private contracts: Contracts, private retrieval: Retrieval,
    private input: Data, private model: Model | undefined, private clock = Date.now,
    private backoff = false, private onQuota: () => void = () => {},
    private progress?: (event: Data) => Promise<void>, private diagnostic?: (event: Data) => void) {
    this.filters = retrieval.newsInput(input.filters ?? {});
    this.budget = new PromptBudget(config);
    this.research = new ResearchTools(contracts, {
      news: (args, signal) => this.searchNews(args, signal),
      locations: async (args, signal) => {
        const found = await this.cached('locations', args, () => retrieval.locations(args, signal)), items = records(found.items);
        const term = string(args.query).trim().toLowerCase();
        const exact = items.filter(location => string(location.name).toLowerCase() === term);
        if (term && (!items.length || (items.length > 1 && exact.length !== 1))) {
          this.needsClarification = items.length ? 'ambiguous_location' : 'unsupported_coverage';
          this.locationChoices = items.map(location => string(location.name)).slice(0, 5);
        }
        return found;
      },
      article: async (id, signal) => {
        const selected = await this.selectedContext(signal);
        if (id !== this.input.selected_article_id && !this.searchedIds.has(id) &&
          !strings(object(selected.investigation ?? {}).article_ids).includes(id) &&
          !strings(object(object(selected.investigation ?? {}).investigation ?? {}).article_ids).includes(id))
          throw new AppError('FILTER_CONFLICT', 'Search inside active filters first, or select the article/investigation to use its linked evidence');
        return this.article(id, signal);
      },
      investigation: async (id, signal) => {
        const selected = await this.selectedContext(signal);
        const selectedException = id === this.input.selected_investigation_id || object(object(selected.investigation ?? {}).investigation ?? {}).id === id;
        if (!selectedException && !this.discoveredInvestigations.has(id))
          throw new AppError('FILTER_CONFLICT', 'Discover an investigation through search_catalog within the current view, or select it explicitly');
        const data = await this.investigation(id, signal);
        if (selectedException || !Object.keys(this.filters).some(key => !['limit', 'offset'].includes(key))) return data;
        const matching = await this.queryNews({ ...this.filters, limit: 100, offset: 0 }, signal);
        const allowed = new Set(records(matching.items).map(row => row.id));
        return { ...data, articles: records(data.articles).filter(row => allowed.has(row.id)),
          evidence: [], observations: [], observation_series: [], locations: [],
          investigation: { ...object(data.investigation), items: [] },
          research_limitation: 'Only articles matching the current filters are available here. Explicitly select this investigation to inspect its other linked evidence.' };
      },
      catalog: async signal => {
        const catalog = await this.catalog(signal), termKeys = Object.keys(this.filters).filter(key => !['limit', 'offset'].includes(key));
        let investigations = records(catalog.investigations);
        if (termKeys.length) {
          const result = await this.queryNews({ ...this.filters, limit: 100, offset: 0 }, signal);
          const ids = new Set(records(result.items).map(row => string(row.id)));
          investigations = investigations.filter(row => strings(row.article_ids).some(id => ids.has(id)));
        }
        investigations.forEach(row => this.discoveredInvestigations.add(string(row.id)));
        return { ...catalog, investigations };
      },
      sources: async (ids, signal) => {
        if (ids.some(id => !this.ledger.sourceIds.has(id))) throw new AppError('INVALID_INPUT', 'Read sources only for evidence already exposed in this question');
        return this.sources(ids, signal);
      },
      compare: (args, signal) => this.compare(args, signal),
    }, input.history);
  }
  private async cached<T>(name: string, args: unknown, read: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([name, args]);
    let work = this.reads.get(key) as Promise<T> | undefined;
    if (!work) { work = read(); this.reads.set(key, work); }
    try { return await work; } catch (error) { this.reads.delete(key); throw error; }
  }
  private async article(id: string, signal: AbortSignal): Promise<Data> {
    let article = this.articles.get(id);
    if (!article) { article = await this.cached('article', id, () => this.retrieval.article(id, signal)); this.articles.set(id, article); }
    return article;
  }
  private async investigation(id: string, signal: AbortSignal): Promise<Data> {
    const data = await this.cached('investigation', id, () => this.retrieval.investigation({ id }, signal));
    if (!this.investigations.some(row => object(row.investigation).id === id)) this.investigations.push(data);
    records(data.articles).forEach(article => this.articles.set(string(article.id), article));
    return data;
  }
  private catalog(signal: AbortSignal) { return this.cached('catalog', {}, () => this.retrieval.catalog(signal)); }
  private async selectedContext(signal: AbortSignal): Promise<Data> {
    if (this.context.ready) return this.context;
    const article = this.input.selected_article_id ? await this.article(string(this.input.selected_article_id), signal) : null;
    let investigationId = this.input.selected_investigation_id;
    if (!investigationId && article) {
      try {
        const catalog = await this.catalog(signal);
        const linked = records(catalog.investigations).filter(row => strings(row.article_ids).includes(string(article.id)));
        if (linked.length === 1) investigationId = linked[0]!.id;
      } catch (error) { if (!(error instanceof AppError) || error.code !== 'DATA_UNAVAILABLE') throw error; }
    }
    const investigation = investigationId ? await this.investigation(string(investigationId), signal) : null;
    const locationId = this.input.selected_location_id ?? (article && strings(article.location_ids).length === 1 ? strings(article.location_ids)[0] : null)
      ?? (investigation ? object(investigation.investigation).primary_location_id : null);
    const location = locationId ? await this.cached('location', locationId, () => this.retrieval.location(string(locationId), signal)) : null;
    this.context = { ready: true, article, investigation, location, bounds: location ? null : this.input.selected_bounds ?? null };
    return this.context;
  }
  private async sources(ids: string[], signal: AbortSignal): Promise<Data[]> {
    const result: Data[] = [];
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100).sort();
      result.push(...await this.cached('sources', batch, () => this.retrieval.sources(batch, signal)));
    }
    return result;
  }
  private async queryNews(query: Data, signal: AbortSignal) {
    const result = await this.cached('news', query, () => this.retrieval.news(query, signal));
    records(result.items).forEach(article => this.articles.set(string(article.id), article));
    return result;
  }
  private async searchNews(args: Data, signal: AbortSignal) {
    const query = this.publicationRange(args);
    if (this.useCurrentArea && !strings(query.location_ids).length && !query.bounds && !strings(this.filters.location_ids).length && !this.filters.bounds) {
      const context = await this.selectedContext(signal);
      if (context.location) query.location_ids = object(context.location).id ? [object(context.location).id] : [];
      else if (context.bounds) { bounds(context.bounds); query.bounds = context.bounds; }
    }
    // The existing validated dispatcher is the authority for filter conflicts.
    const scoped = new Tools(this.contracts, this.retrieval, undefined, this.filters, false);
    const result = await this.cached('scoped_news', [this.filters, query], () => scoped.dispatch('search_news', query, signal));
    records(result.items).forEach(row => { this.articles.set(string(row.id), row); this.searchedIds.add(string(row.id)); });
    this.searched = { query: { ...this.filters, ...query }, result };
    return result;
  }
  private async compare(args: Data, signal: AbortSignal): Promise<Data> {
    const query = this.observationRange(args), selected = await this.selectedContext(signal);
    const linkedLocations = selected.investigation ? records(object(selected.investigation).locations).map(row => row.id) : [];
    const selectedException = query.location_id === this.input.selected_location_id || linkedLocations.includes(query.location_id);
    if (!selectedException && strings(this.filters.location_ids).length && !strings(this.filters.location_ids).includes(string(query.location_id)))
      throw new AppError('FILTER_CONFLICT', 'Observation location is outside active filters');
    if (!selectedException && this.filters.bounds) {
      const place = await this.retrieval.location(string(query.location_id), signal), area = bounds(this.filters.bounds)!;
      const extent = place.bounds ? bounds(place.bounds)! : Array.isArray(place.coordinates) ? [...place.coordinates, ...place.coordinates] as number[] : [];
      if (extent.length !== 4 || extent[0]! < area[0]! || extent[1]! < area[1]! || extent[2]! > area[2]! || extent[3]! > area[3]!)
        throw new AppError('FILTER_CONFLICT', 'Observation location is outside active bounds');
    }
    const compared = await this.cached('compare', query, () => this.retrieval.compare(query, signal));
    const matches = this.investigations.flatMap(data => records(data.observation_series)
      .filter(series => series.location_id === query.location_id && series.metric === query.metric &&
        (query.series_id === undefined || series.id === query.series_id))
      .map(series => ({ investigation_id: object(data.investigation).id, series_id: series.id })));
    if (matches.length) this.suggestion = await timelineTarget({ ...matches[0],
      ...(query.observed_from === undefined ? {} : { observed_from: query.observed_from }),
      ...(query.observed_to === undefined ? {} : { observed_to: query.observed_to }) }, this.retrieval, signal);
    return { ...compared, ...(this.suggestion ? { timeline: this.suggestion } : {}) };
  }
  private prompt(): Data {
    const request = compactRequest(this.input, this.filters);
    return { request, audience_context: audienceContext(this.input.audience), current_utc: new Date(this.clock()).toISOString(),
      resolved_range: this.resolved, authorized_actions: [...this.policy.allowed],
      state: { staged_actions: this.actions.map(action => ({ type: action.type, location_id: action.location_id, investigation_id: action.investigation_id })),
        research_stopped: this.stopReason, instruction: 'Use tools for evidence; preserve active scope. Offer a timeline after comparison, but open it only when authorized. On a research limit, finish with what you found without more tool calls.' } };
  }
  private declarations(finalOnly = false): FunctionDeclaration[] {
    const definitions = finalOnly ? [] : Object.entries(this.research.registry).map(([name, tool]) => ({ name, description: tool.description,
      parametersJsonSchema: compactParameters(modelParameters(this.contracts, tool.schema)) }));
    if (!finalOnly) for (const [name, schema] of Object.entries(actionTools)) {
      if (this.policy.allowed.has(name)) definitions.push({ name, description: `Stage authorized ${name}; only requested changes. Preserve unnamed filters.`, parametersJsonSchema: compactParameters(modelParameters(this.contracts, schema)) });
    }
    if (!finalOnly) definitions.push({ name: 'suggest_timeline', description: 'Validate a timeline suggestion without changing the workspace.', parametersJsonSchema: compactParameters(modelParameters(this.contracts, 'OpenTimelineArgs')) });
    const parameters = compactParameters(modelParameters(this.contracts, 'AssistantDraftV2'));
    const properties = object(parameters.properties), actions = object(properties.actions), items = object(actions.items);
    if (Array.isArray(items.oneOf)) items.oneOf = records(items.oneOf).filter(branch => this.policy.allowed.has(string((object(object(branch.properties).type).enum as unknown[])?.[0])));
    if (!Array.isArray(items.oneOf) || !items.oneOf.length) properties.actions = { type: 'array', items: { type: 'null' }, maxItems: 0 };
    definitions.push({ name: 'respond', description: 'Finish alone with an answer or honest status. Include available source references when useful; citations are optional. Status kinds have no model citation/result arrays.', parametersJsonSchema: parameters });
    return definitions;
  }
  async run(signal: AbortSignal): Promise<Data> {
    this.started = this.clock();
    const coverage = await this.retrieval.coverage(signal);
    this.latest = { items: [], coverage }; this.initial = this.latest;
    try {
      if (!this.model || this.backoff) return this.fallback(this.backoff
        ? new AppError('GEMINI_RATE_LIMITED', 'Gemini is in shared quota backoff', 503, true) : unavailable('GEMINI_UNAVAILABLE', 'Gemini is unavailable'));
      await this.progress?.({ type: 'status', phase: 'interpreting' });
      const base = { request: compactRequest(this.input, this.filters), instruction: 'Interpret only the current message. History resolves references, never action authorization. Return exact unquoted command excerpts. Identify only explicitly changed/cleared filter keys. Publication date changes name both boundaries; geography clearing names location_ids and bounds. Date expressions must be verbatim.' };
      const interpretation = await this.generate(base, [{ name: 'interpret_request', parametersJsonSchema: compactParameters(modelParameters(this.contracts, 'AssistantIntent')) }], signal, 0, 'interpret_request');
      if (interpretation.calls.length !== 1 || interpretation.calls[0]!.name !== 'interpret_request') throw new AppError('INVALID_MODEL_OUTPUT', 'Expected a single structured interpretation', 502);
      const intent = this.contracts.parse('AssistantIntent', interpretation.calls[0]!.args, true);
      this.policy = permissions(this.input, intent); this.useCurrentArea = intent.use_current_area === true;
      if (intent.clarification_reason || this.policy.ambiguous) return this.status('clarification', clarification(this.policy.ambiguous ? 'ambiguous_intent' : string(intent.clarification_reason)));
      if (this.useCurrentArea) {
        const context = await this.selectedContext(signal);
        if (!context.location && !context.bounds && !strings(this.filters.location_ids).length && !this.filters.bounds) return this.status('clarification', clarification('missing_location'));
      }
      if (intent.date_expression) {
        if (!['publication', 'observation'].includes(string(intent.date_target)) || !string(this.input.message).toLowerCase().includes(string(intent.date_expression).toLowerCase()))
          throw new AppError('INVALID_MODEL_OUTPUT', 'Date expression/target must come from the current request', 502);
        try { this.resolved = { ...resolveDateRange(string(intent.date_expression), string(this.input.timezone), this.clock()), target: intent.date_target }; }
        catch (error) { if (error instanceof AppError && ['UNSUPPORTED_PERIOD', 'INVALID_TIME', 'INVALID_RANGE'].includes(error.code)) return this.status('clarification', clarification('unsupported_period')); throw error; }
      }
      for (let round = 1; round < this.config.aiMaxRounds; round++) {
        const remaining = this.config.aiTimeoutMs - (this.clock() - this.started);
        const finalOnly = !!this.stopReason || round === this.config.aiMaxRounds - 1 || this.calls >= this.config.aiMaxTools - 1 || remaining <= Math.min(15000, this.config.aiTimeoutMs / 3);
        if (finalOnly) this.stopReason ??= remaining <= Math.min(15000, this.config.aiTimeoutMs / 3) ? 'time_limit' : 'research_limit';
        const pendingEvidence = this.blocks.some(block => block.records.some(record => record.source_id || strings(record.source_ids).length));
        if (finalOnly && !this.ledger.sourceIds.size && !pendingEvidence) {
          if (this.actions.length && [...this.policy.allowed].every(type => this.actions.some(action => action.type === type)))
            return await this.finish({ kind: 'action_summary', answer: '', citations: [], result_ids: [], actions: [], clarification_reason: null }, signal);
          return this.fallback(new AppError('RESEARCH_LIMIT_REACHED', 'No sufficient evidence was retrieved within the research budget. Narrow the place, topic or period.', 503, true));
        }
        await this.progress?.({ type: 'status', phase: 'researching' });
        const researchSignal = finalOnly ? signal : AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(remaining - Math.min(15000, this.config.aiTimeoutMs / 3))))]);
        let turn;
        try { turn = await this.generate(this.prompt(), this.declarations(finalOnly), researchSignal, round); }
        catch (error) {
          if (!signal.aborted && researchSignal.aborted && !finalOnly) { this.stopReason = 'time_limit'; continue; }
          throw error;
        }
        if (turn.calls.length && turn.text.trim()) throw new AppError('INVALID_MODEL_OUTPUT', 'A final structured answer cannot include tool calls', 502);
        const final = !turn.calls.length && turn.text.trim() ? parseModelJson(turn.text, 64000)
          : turn.calls.length === 1 && turn.calls[0]!.name === 'respond' ? turn.calls[0]!.args : null;
        if (final) {
          if (++this.calls > this.config.aiMaxTools) throw new AppError('TOOL_LIMIT', 'Assistant tool limit reached', 502);
          await this.progress?.({ type: 'status', phase: 'validating' });
          return await this.finish(this.contracts.parse('AssistantDraftV2', final, true), signal);
        }
        if (finalOnly || !turn.calls.length || turn.calls.some(call => call.name === 'respond')) throw new AppError('INVALID_MODEL_OUTPUT', 'A supported final response is required', 502);
        if (this.calls + turn.calls.length >= this.config.aiMaxTools) { this.stopReason = 'tool_limit'; continue; }
        this.calls += turn.calls.length;
        const parts = [], fullParts = [], evidence: Data[] = [], allEvidence: Data[] = [], references: string[] = [], allReferences: string[] = [], dependencies: string[] = [];
        const active = new Set(this.blocks.flatMap(block => block.references));
        // Never stage actions from a model block too large to round-trip safely.
        if (byteLength(turn.content) > 16000) { this.stopReason = 'oversized_model_block'; continue; }
        for (const call of turn.calls) {
          checkAbort(signal);
          let page: ResearchPage;
          try { page = await bounded(this.dispatch(call.name, call.args, researchSignal), researchSignal); }
          catch (error) {
            if (!signal.aborted && researchSignal.aborted) { this.stopReason = 'time_limit'; break; }
            if (!(error instanceof AppError) || !recoverable.has(error.code)) throw error;
            page = { result: this.contracts.parse('AssistantToolResult', { kind: 'error', items: [], returned_count: 0, truncated: false, error: { code: error.code, message: error.message } }, true), evidence: [], reference: '' };
          }
          const repeated = page.reference && active.has(page.reference);
          const response = repeated ? this.research.receipt({ reference: page.reference, already_in_context: true }).result : page.result;
          if (!repeated) { evidence.push(...page.evidence); if (page.reference) references.push(page.reference); }
          else dependencies.push(page.reference);
          allEvidence.push(...page.evidence); if (page.reference) allReferences.push(page.reference);
          fullParts.push({ functionResponse: { name: call.name, id: call.id, response: page.result } });
          parts.push({ functionResponse: { name: call.name, id: call.id, response } });
          if (this.needsClarification) {
            this.actions = []; this.suggestion = null; this.latest = this.initial; this.searched = null;
            return this.status('clarification', clarification(this.needsClarification) + (this.locationChoices.length ? ' Available locations: ' + this.locationChoices.join('; ') + '.' : ''));
          }
        }
        if (this.stopReason === 'time_limit') continue;
        const block: ResearchBlock = { contents: [turn.content, { role: 'user', parts }], records: evidence, references, dependsOn: dependencies };
        this.blocks.push(block);
        this.budget.fit(this.prompt(), this.blocks, this.declarations(), this.progress ? { onAnswerDelta: async () => {} } : undefined);
        if (!this.blocks.includes(block) && dependencies.length) {
          // An original payload was evicted while admitting its reference receipt.
          // Re-emit the cached data in the new, not-yet-sent response instead.
          block.contents[1] = { role: 'user', parts: fullParts }; block.records = allEvidence;
          block.references = allReferences; block.dependsOn = []; this.blocks.push(block);
          this.budget.fit(this.prompt(), this.blocks, this.declarations(), this.progress ? { onAnswerDelta: async () => {} } : undefined);
        }
        if (!this.blocks.includes(block)) this.stopReason = 'context_budget';
      }
      return this.fallback(new AppError('RESEARCH_LIMIT_REACHED', 'Research finished without a supported answer. Narrow the question.', 503, true));
    } catch (error) {
      checkAbort(signal); const failure = modelFailure(error);
      if (failure.code === 'GEMINI_RATE_LIMITED') this.onQuota();
      return this.fallback(failure);
    } finally {
      this.report({ phase: 'finished', round: this.lastRound, input_bytes: this.lastInputBytes, exposed_records: this.ledger.resultIds.size,
        cache_hits: this.research.cacheHits, compactions: this.budget.evictions, stop_reason: this.stopReason });
    }
  }
  private report(metrics: Data) {
    const event = { event: 'assistant_research', request_key: createHash('sha256').update(string(this.input.request_id)).digest('hex').slice(0, 12), ...metrics };
    try {
      if (this.diagnostic) this.diagnostic(event);
      else if (this.config.nodeEnv !== 'test') console.info(JSON.stringify(event));
    } catch { /* Diagnostics must not change assistant behavior. */ }
  }
  private async generate(base: Data, declarations: FunctionDeclaration[], signal: AbortSignal, round: number, forceTool?: string) {
    checkAbort(signal); let writing = false;
    const options = forceTool ? { forceTool } : this.progress ? { onAnswerDelta: async (text: string) => {
      checkAbort(signal); if (!writing) { await this.progress!({ type: 'status', phase: 'writing' }); writing = true; }
      await this.progress!({ type: 'answer_delta', text });
    } } : undefined;
    const { contents, bytes } = this.budget.fit(base, this.blocks, declarations, options);
    this.lastInputBytes = bytes; this.lastRound = round;
    for (const block of this.blocks) for (const record of block.records) this.ledger.collect(record);
    const packed = object(JSON.parse(contents[0]!.parts![0]!.text!));
    const included = records(object(packed.request).history).length;
    const metrics = { round, input_bytes: bytes, exposed_records: this.ledger.resultIds.size, cache_hits: this.research.cacheHits,
      compactions: this.budget.evictions, initial_history_pairs: included,
      history_omitted: this.budget.historyOmitted || included < Number(object(base.request).history_available ?? 0), stop_reason: this.stopReason };
    this.report({ phase: 'model_request', ...metrics });
    const turn = await bounded(this.model!.generate(contents, declarations, signal, options), signal); checkAbort(signal); return turn;
  }
  private async dispatch(name: string, raw: unknown, signal: AbortSignal): Promise<ResearchPage> {
    if (Object.hasOwn(this.research.registry, name)) return this.research.run(name, raw, signal);
    const schema = name === 'suggest_timeline' ? 'OpenTimelineArgs' : actionTools[name as keyof typeof actionTools];
    if (!schema) throw new AppError('INVALID_TOOL', 'Tool is not authorized', 502);
    if (name !== 'suggest_timeline' && !this.policy.allowed.has(name)) throw new AppError('ACTION_NOT_AUTHORIZED', 'Current message did not authorize this action', 502);
    const args = this.contracts.parse(schema, raw);
    if (name === 'set_filters') {
      const patch: Data = { ...args, set: this.publicationRange(object(args.set)) };
      const next = this.retrieval.newsInput(mergeFilterPatch(this.filters, patch, this.policy.keys, this.policy.clear));
      for (const id of strings(next.location_ids)) await this.retrieval.location(id, signal);
      if (Object.hasOwn(object(patch.set), 'themes') || Object.hasOwn(object(patch.set), 'entity_ids')) {
        const catalog = await this.catalog(signal);
        for (const [key, collection] of [['themes', 'themes'], ['entity_ids', 'entities']] as const) {
          const known = new Set(records(catalog[collection]).map(row => string(row.id)));
          if (Object.hasOwn(object(patch.set), key) && strings(next[key]).some(id => !known.has(id))) throw new AppError('UNSUPPORTED_COVERAGE', 'Choose an available topic or entity');
        }
      }
      const latest = await this.queryNews(next, signal);
      checkAbort(signal);
      this.filters = next; this.latest = latest; this.searched = null; this.research.scopeRevision++;
      this.searchedIds.clear(); this.discoveredInvestigations.clear();
      this.addAction({ type: 'set_filters', filters: next });
      return this.research.receipt({ action_type: name, changed_keys: [...Object.keys(object(patch.set)), ...strings(patch.clear)] }, records(latest.items).length);
    }
    if (name === 'focus_location') {
      const location = await this.retrieval.location(string(args.location_id), signal);
      checkAbort(signal);
      this.addAction({ type: 'focus_location', location_id: location.id });
      return this.research.receipt({ action_type: name, location_id: location.id });
    }
    this.suggestion = await timelineTarget(this.observationRange(args), this.retrieval, signal);
    checkAbort(signal);
    if (name === 'open_timeline') this.addAction({ type: 'open_timeline', ...this.suggestion });
    return this.research.receipt({ action_type: name, ...this.suggestion });
  }
  private publicationRange(args: Data): Data {
    if (this.resolved?.target !== 'publication') return { ...args };
    for (const [key, value] of [['published_from', this.resolved.from], ['published_to', this.resolved.to]] as const)
      if (args[key] !== undefined && args[key] !== value) throw new AppError('INVALID_RANGE', 'Use the server-resolved publication range');
    return { ...args, published_from: this.resolved.from, published_to: this.resolved.to };
  }
  private observationRange(args: Data): Data {
    if (this.resolved?.target !== 'observation') return args;
    for (const [key, value] of [['observed_from', this.resolved.from], ['observed_to', this.resolved.to]] as const)
      if (args[key] !== undefined && args[key] !== value) throw new AppError('INVALID_RANGE', 'Use the server-resolved observation range');
    return { ...args, observed_from: this.resolved.from, observed_to: this.resolved.to };
  }
  private addAction(action: Data): void {
    const valid = this.contracts.parse('UIActionV2', action, true);
    if (this.actions.some(existing => JSON.stringify(existing) === JSON.stringify(valid))) return;
    if (this.actions.length >= 8) throw new AppError('ACTION_LIMIT', 'Too many workspace actions', 502);
    // Only the final state of each action kind is committed to the browser.
    this.actions = this.actions.filter(existing => existing.type !== valid.type);
    this.actions.push(valid);
  }
  private async finish(draft: Data, signal: AbortSignal): Promise<Data> {
    if (this.calls + records(draft.actions).length > this.config.aiMaxTools)
      throw new AppError('TOOL_LIMIT', 'Final actions exceed the request tool limit', 502);
    for (const action of records(draft.actions)) {
      checkAbort(signal);
      const type = string(action.type);
      if (!Object.hasOwn(actionTools, type)) throw new AppError('INVALID_ACTION', 'Unsupported final action', 502);
      const args = { ...action }; delete args.type;
      // set_filters actions in the model draft carry a patch, never a complete
      // replacement object. The server emits canonical UIActionV2 afterwards.
      await this.dispatch(type, args, signal);
    }
    checkAbort(signal);
    if (draft.kind !== 'answer' && (records(draft.citations).length || strings(draft.result_ids).length))
      throw new AppError('INVALID_MODEL_OUTPUT', 'Status responses must not contain model citations or result IDs', 502);
    if (draft.kind !== 'clarification' && [...this.policy.allowed].some(type => !this.actions.some(action => action.type === type)))
      throw new AppError('INVALID_MODEL_OUTPUT', 'A requested workspace action was not completed', 502);
    if (draft.kind === 'clarification') {
      if (this.actions.length) throw new AppError('INVALID_MODEL_OUTPUT', 'Clarification cannot include actions', 502);
      return this.status('clarification', clarification(string(draft.clarification_reason)));
    }
    if (draft.kind === 'empty') {
      if (!this.searchPage() || records(this.searchPage()!.result.items).length) throw new AppError('INVALID_MODEL_OUTPUT', 'Empty result contradicts the final query', 502);
      return this.status('empty', 'No stored news matches these filters. Broaden a place, topic, or publication period to search again.');
    }
    if (draft.kind === 'action_summary') {
      if (!this.actions.length) throw new AppError('INVALID_MODEL_OUTPUT', 'No workspace action was executed', 502);
      if (this.actions.some(a => a.type === 'set_filters') && !records(this.latest.items).length)
        return this.status('empty', 'No stored news matches these filters. Broaden a place, topic, or publication period to search again.');
      return this.status('action_summary', this.actions.some(a => a.type === 'set_filters')
        ? `Showing ${records(this.latest.items).length} stored news records on this result page. Other filters were preserved unless you requested a change.`
        : 'Updated the requested workspace view using verified stored records.');
    }
    const sourceIds = [...new Set(records(draft.citations).map(reference => string(reference.source_id)))]
      .filter(id => this.ledger.sourceIds.has(id));
    if (sourceIds.length) {
      try { this.ledger.attach(await this.sources(sourceIds, signal)); }
      catch { checkAbort(signal); } // Optional source cards must not discard the answer.
    }
    return this.response('answer', string(draft.answer), this.ledger.availableCitations(draft.citations, this.contracts),
      strings(draft.result_ids).filter(id => this.ledger.resultIds.has(id)));
  }
  private status(kind: string, answer: string): Data { return this.response(kind, answer, [], []); }
  private searchPage() {
    return !this.actions.some(action => action.type === 'set_filters') && this.searched
      ? this.searched : this.actions.some(action => action.type === 'set_filters') ? { query: this.filters, result: this.latest } : null;
  }
  private response(kind: string, answer: string, citations: Data[], resultIds: string[]): Data {
    const filtersChanged = this.actions.some(action => action.type === 'set_filters');
    const search = this.searchPage();
    return this.contracts.parse('AssistantResponseV2', {
      protocol_version: 2, request_id: this.input.request_id, kind, answer, citations,
      result_ids: filtersChanged ? records(this.latest.items).map(row => row.id) : resultIds,
      actions: this.actions, coverage: this.latest.coverage, mode: this.retrieval.repository.mode === 'fixture' ? 'fixture' : 'live', errors: this.stopReason && kind === 'answer' ? [{ code: 'RESEARCH_LIMIT_REACHED', message: 'This is a partial answer from the evidence retrieved within the research budget. Further questions can investigate the unresolved details.', retryable: false }] : [],
      search: search ? { filters: search.query, returned_count: records(search.result.items).length, ...page(search.query) } : null,
      resolved_range: this.resolved, timeline: this.suggestion
    }, true);
  }
  private fallback(failure: AppError): Data {
    this.actions = []; this.suggestion = null;
    // Failed synthesis applies no state changes and reports no search summary.
    return this.contracts.parse('AssistantResponseV2', {
      protocol_version: 2, request_id: this.input.request_id, kind: 'answer',
      answer: failure.code === 'RESEARCH_LIMIT_REACHED'
        ? 'I could not retrieve enough evidence within this question’s research budget. Narrow the place, topic or period.'
        : 'Assistant unavailable or output rejected. Use manual filters and original sources.',
      citations: [], result_ids: [], actions: [], coverage: this.latest.coverage, mode: 'fallback',
      errors: [{ code: failure.code, message: failure.message, retryable: failure.retryable }],
      search: null, resolved_range: null, timeline: null
    }, true);
  }
}
