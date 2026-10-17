import {readConfig} from './config.js';
import {AppError} from './runtime/errors.js';
import {setupOptions,setupTiger} from './setup/tiger.js';
async function main() {
  const options=setupOptions(process.argv.slice(2));
  await setupTiger(readConfig(),options,value => console.log(JSON.stringify(value)));
}
main().catch(error => {
  console.error(JSON.stringify({error:{code:error instanceof AppError?error.code:'TIGER_SETUP_FAILED',
    message:error instanceof AppError?error.message:'Tiger setup failed; credentials were not printed'}}));
  process.exitCode=1;
});
