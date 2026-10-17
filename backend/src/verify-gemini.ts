import {readConfig} from './config.js';
import {createServices} from './runtime/services.js';
import {AppError} from './runtime/errors.js';
import {Gemini} from './services/gemini/client.js';
import {modelFailure} from './services/gemini/errors.js';
import {probeGeminiTools} from './services/gemini/probe.js';

async function main() {
  if (process.argv.length!==2) throw new AppError('INVALID_ARGUMENT','The Gemini tool diagnostic accepts no arguments');
  const config=readConfig();
  if (!config.geminiKey || !config.geminiModel || !config.databaseUrl) {
    console.log(JSON.stringify({status:'missing_configuration',code:'AI_CONFIGURATION_MISSING',message:'Configure the existing Gemini model/key and Tiger runtime connection'}));
    process.exitCode=2;return;
  }
  const services=await createServices(config);
  try {
    console.log(JSON.stringify(await probeGeminiTools(config,services.retrieval,new Gemini(config),{
      location_ids:['loc-asheville-nc'],keyword:'water',limit:3
    },AbortSignal.timeout(config.aiTimeoutMs)),null,2));
  } finally {await services.flights.close();await services.repository.close();}
}
main().catch(error=>{
  const failure=modelFailure(error);
  console.error(JSON.stringify({status:'failed',error:{code:failure.code,message:failure.message,retryable:failure.retryable},
    generation_verified:false,assistant_api_verified:false}));process.exitCode=1;
});
