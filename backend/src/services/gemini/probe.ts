import type {Content,FunctionDeclaration} from '@google/genai';
import type {Config} from '../../config.js';
import {AppError,bounded,checkAbort} from '../../runtime/errors.js';
import {object,records,type Data} from '../validation.js';
import {Retrieval} from '../retrieval.js';
import type {Model} from './client.js';
import {Tools} from './tools.js';
import {EvidenceLedger} from './citations.js';
import {modelParameters} from './schema.js';

// A diagnostic using only already-delivered contracts. It does not bypass
// AssistantRequest/Draft/Response or expose an alternate assistant endpoint.
export async function probeGeminiTools(config: Config,retrieval: Retrieval,model: Model,query: Data,signal: AbortSignal) {
  const contracts=retrieval.contracts;
  const filters=retrieval.newsInput(query);
  for (const name of ['CitationReference','Citation','Source'])
    if (!contracts.has(name)) throw new AppError('CONTRACTS_UNAVAILABLE',`Shared schema ${name} has not been supplied`,503,true);
  const baseline=await retrieval.news(filters,signal);
  if (!records(baseline.items).length) throw new AppError('PROBE_NO_EVIDENCE','No stored articles match the diagnostic filters',503);
  const tools=new Tools(contracts,retrieval,undefined,filters,false),ledger=new EvidenceLedger();
  const declarations: FunctionDeclaration[]=[
    {name:'search_news',description:'Retrieve stored Atlas articles using validated active filters.',parametersJsonSchema:modelParameters(contracts,'NewsQuery')},
    {name:'cite_record',description:'Diagnostic only: select one retrieved article and its actual source ID. This does not generate a briefing or change the workspace.',parametersJsonSchema:modelParameters(contracts,'CitationReference')}
  ];
  const contents: Content[]=[{role:'user',parts:[{text:JSON.stringify({
    task:'First call search_news using these active filters. Then use cite_record to identify one article/source returned by the search. No other tools, prose, URLs or facts are requested.',filters
  })}]}];
  if (Buffer.byteLength(JSON.stringify(contents))>config.aiMaxContextBytes) throw new AppError('CONTEXT_LIMIT','Diagnostic input exceeds its context bound',413);
  const search=await bounded(model.generate(contents,declarations,signal,{forceTool:'search_news'}),signal);
  checkAbort(signal);
  if (search.calls.length!==1 || search.calls[0]!.name!=='search_news') throw new AppError('PROBE_INVALID_TOOL','Expected exactly one validated news search',502);
  const call=search.calls[0]!;
  const result=await tools.dispatch(call.name,call.args,signal);
  const canonical=await retrieval.news({...filters,...contracts.parse('NewsQuery',call.args)},signal);
  if (JSON.stringify(result.items)!==JSON.stringify(canonical.items)) throw new AppError('PROBE_FILTER_MISMATCH','Manual and AI retrieval results differ',502);
  if (!records(result.items).length) throw new AppError('PROBE_NO_EVIDENCE','The proposed search returned no stored articles',503);
  ledger.collect(result);
  const sources=await retrieval.sources([...ledger.sourceIds],signal); ledger.attach(sources);
  contents.push(search.content,{role:'user',parts:[
    {functionResponse:{name:call.name,id:call.id,response:{output:result,sources}}},
    {text:'Now call cite_record once using an article ID and the source ID that belongs to that article. Do not cite dataset coverage, a source record itself, or an unretrieved record.'}
  ]});
  if (Buffer.byteLength(JSON.stringify(contents))>config.aiMaxContextBytes) throw new AppError('CONTEXT_LIMIT','Diagnostic evidence exceeds its context bound',502);
  const final=await bounded(model.generate(contents,declarations,signal,{forceTool:'cite_record'}),signal);
  checkAbort(signal);
  if (final.calls.length!==1 || final.calls[0]!.name!=='cite_record') throw new AppError('PROBE_INVALID_TOOL','Expected exactly one retrieved citation reference',502);
  const reference=contracts.parse('CitationReference',final.calls[0]!.args,true);
  if (!records(result.items).some(article=>article.id===reference.record_id)) throw new AppError('INVALID_CITATION','Diagnostic citation must identify a returned article',502);
  const [citation]=ledger.resolve([reference],contracts);
  return {status:'passed',generation_verified:true,canonical_tool_verified:true,manual_filter_parity:true,citation_verified:true,
    citation:object(citation),data_mode:retrieval.repository.mode,assistant_api_verified:false,
    note:'Two real model turns select a validated stored news result/source. This diagnostic does not verify an assistant explanation, investigation, timeline or UI actions.'};
}
