import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import type { Config } from '../../config.js';
import { AppError, bounded, checkAbort } from '../../runtime/errors.js';
import { type Data, object, string } from '../validation.js';
import {modelFailure} from './errors.js';
import { partialStringProperty } from './stream.js';
import { generationParameters, modelRequestBytes } from './request.js';
export interface ModelTurn { content: Content; calls: { name: string; args: unknown; id?: string }[]; text: string }
export interface ModelOptions { forceTool?: string; onAnswerDelta?: (text: string) => Promise<void> }
export interface Model {
  generate(contents: Content[], declarations: FunctionDeclaration[], signal: AbortSignal, options?: ModelOptions): Promise<ModelTurn>;
}
export interface GenerationClient {models: {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
  generateContentStream?(params: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>>;
}}
export class Gemini implements Model {
  private client: GenerationClient;
  constructor(private config: Config,client?: GenerationClient) {
    this.client = client ?? new GoogleGenAI({ apiKey: config.geminiKey!, httpOptions: { timeout: config.aiTimeoutMs, retryOptions: { attempts: 1 } } });
  }
  async generate(contents: Content[], declarations: FunctionDeclaration[], signal: AbortSignal, options?: ModelOptions): Promise<ModelTurn> {
    if (signal.aborted) throw new AppError('REQUEST_CANCELLED','Request cancelled or timed out',408,true);
    if (options?.forceTool && !declarations.some(d=>d.name===options.forceTool)) throw new AppError('INVALID_TOOL','Forced tool must be declared');
    if (modelRequestBytes(this.config, contents, declarations, options)>this.config.aiMaxContextBytes) throw new AppError('CONTEXT_LIMIT','Model input and tool definitions exceed the context bound',502);
    try {
      const params = generationParameters(this.config, contents, declarations, signal, options);
      const finalSchema = params.config?.responseJsonSchema;
      const response = finalSchema
        ? await this.stream(params, signal, options!.onAnswerDelta!)
        : await bounded(this.client.models.generateContent(params), signal);
      const candidate=response.candidates?.[0],content=candidate?.content;
      if (candidate?.finishReason==='MAX_TOKENS') throw new AppError('MODEL_TRUNCATED','Gemini output reached its token limit',502,true);
      if (candidate?.finishReason && !['STOP','FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason)) throw new AppError('MODEL_OUTPUT_REJECTED','Gemini did not complete a valid response',502);
      if (!content) throw new AppError(response.promptFeedback?.blockReason?'MODEL_OUTPUT_REJECTED':'MODEL_EMPTY','Gemini returned no usable content',502,true);
      if (Buffer.byteLength(JSON.stringify(content))>64000) throw new AppError('INVALID_MODEL_OUTPUT','Gemini content exceeded the output bound',502);
      return {content,text:(content.parts ?? []).filter(p=>p.thought!==true && typeof p.text==='string').map(p=>p.text).join(''),
        calls:(content.parts ?? []).flatMap(p=>p.functionCall?[{name:string(p.functionCall.name),args:p.functionCall.args ?? {},id:p.functionCall.id}]:[])};
    } catch(error) {throw modelFailure(error);}
  }
  private async stream(params: GenerateContentParameters, signal: AbortSignal, publish: (text: string) => Promise<void>): Promise<Pick<GenerateContentResponse, 'candidates' | 'promptFeedback'>> {
    if (!this.client.models.generateContentStream) throw new AppError('STREAM_UNAVAILABLE', 'Gemini streaming is unavailable', 503);
    const stream = await bounded(this.client.models.generateContentStream(params), signal);
    const content: Content = { role: 'model', parts: [] };
    let last: NonNullable<GenerateContentResponse['candidates']>[number] | undefined;
    let promptFeedback: GenerateContentResponse['promptFeedback'], json = '', published = '';
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        const item = await bounded(iterator.next(), signal); checkAbort(signal);
        if (item.done) break;
        const chunk = item.value, candidate = chunk.candidates?.[0];
        promptFeedback = chunk.promptFeedback ?? promptFeedback;
        if (!candidate) continue;
        last = candidate;
        const parts = candidate.content?.parts ?? [];
        if (parts.some(p => p.functionCall?.partialArgs?.length || p.functionCall?.willContinue))
          throw new AppError('INVALID_MODEL_OUTPUT', 'Incomplete tool arguments cannot be executed', 502);
        content.parts!.push(...parts);
        if (Buffer.byteLength(JSON.stringify(content)) > 64000) throw new AppError('INVALID_MODEL_OUTPUT', 'Gemini content exceeded the output bound', 502);
        json += parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
        if (partialStringProperty(json, 'kind') === 'answer') {
          const answer = partialStringProperty(json, 'answer') ?? '';
          if (!answer.startsWith(published)) throw new AppError('INVALID_MODEL_OUTPUT', 'Inconsistent structured answer stream', 502);
          if (answer.length > published.length) { await publish(answer.slice(published.length)); published = answer; }
        }
      }
    } finally {
      // Do not wait for a transport that ignores cancellation. The SDK also
      // receives the same AbortSignal, and no late chunk can be dispatched.
      void iterator.return?.(undefined).catch(() => {});
    }
    return { candidates: last ? [{ ...last, content }] : [], promptFeedback };
  }
}
export function parseModelJson(text: string, maxBytes = 16000): Data {
  if (Buffer.byteLength(text) > maxBytes) throw new AppError('INVALID_MODEL_OUTPUT', 'Assistant output exceeded safety bound', 502);
  try { return object(JSON.parse(text)); }
  catch { throw new AppError('INVALID_MODEL_OUTPUT', 'Assistant returned invalid JSON', 502); }
}
