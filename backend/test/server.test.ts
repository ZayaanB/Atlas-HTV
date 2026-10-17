import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {backendRoot} from '../src/runtime/load.js';
test('server process serves liveness and exits cleanly on SIGTERM', {timeout:10000},async t => {
  const reservation = createServer();
  await new Promise<void>((resolve,reject) => {reservation.once('error',reject); reservation.listen(0,'127.0.0.1',resolve);});
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve,reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath,['--import','tsx','src/server.ts'],{
    cwd:backendRoot,env:{PATH:process.env.PATH,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','ignore','pipe']
  });
  let stderr = '';
  child.stderr.on('data',(chunk: Buffer) => {stderr = (stderr+chunk.toString()).slice(0,2000);});
  const exit = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject) => {
    child.once('error',reject); child.once('exit',(code,signal) => resolve({code,signal}));
  });
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exit;});
  let live = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) assert.fail(`Server exited during startup: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/live`,{signal:AbortSignal.timeout(200)});
      live = response.status === 200 && (await response.json() as {status:string}).status === 'ok';
      if (live) break;
    } catch { /* Child may still be loading TypeScript. */ }
    await delay(25);
  }
  assert.equal(live,true,'Server must become live without provider credentials');
  assert.equal(child.kill('SIGTERM'),true);
  assert.deepEqual(await exit,{code:0,signal:null});
});
