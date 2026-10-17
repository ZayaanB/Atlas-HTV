import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../src/config.js';
import {connectionTargets,verifyDatabase,verifyGemini,type ProbeDependencies} from '../src/runtime/connections.js';
const configured = () => readConfig({NODE_ENV:'test',DATABASE_URL:'postgresql://test:test@db.example.invalid:5432/test',
  GEMINI_API_KEY:'synthetic-test-key',GEMINI_MODEL:'test-model'});
test('missing credentials cause no database or model calls',async () => {
  const dependencies: ProbeDependencies = {pool:async () => {throw new Error('must not connect');},model:async () => {throw new Error('must not call');}};
  assert.equal((await verifyDatabase(readConfig({}),dependencies)).status,'missing_configuration');
  assert.equal((await verifyGemini(readConfig({}),dependencies)).status,'missing_configuration');
});
test('database check reads only fixed system catalogs, verifies TLS and closes its pool',async () => {
  let closed = false;
  const dependencies: ProbeDependencies = {pool:async () => ({query:async sql => {
    assert.match(sql,/^SELECT /); assert.match(sql,/pg_stat_ssl/); assert.match(sql,/pg_extension/);
    assert.doesNotMatch(sql,/CREATE|INSERT|UPDATE|DELETE|ALTER/);
    return {rows:[{tls:true,extensions:['timescaledb','vector']}]};
  },end:async () => {closed = true;}}),model:async () => ({})};
  const result = await verifyDatabase(configured(),dependencies);
  assert.deepEqual(result,{status:'passed',tls_verified:true,extensions:{timescaledb:true,pgvector:true}});
  assert.equal(closed,true);
});
test('database connection success does not invent installed extensions or accept unconfirmed TLS',async () => {
  const dependencies: ProbeDependencies = {pool:async () => ({query:async () => ({rows:[{tls:true,extensions:[]}]}),end:async () => {}}),model:async () => ({})};
  assert.deepEqual((await verifyDatabase(configured(),dependencies)).extensions,{timescaledb:false,pgvector:false});
  dependencies.pool = async () => ({query:async () => ({rows:[{tls:false,extensions:[]}]}),end:async () => {}});
  assert.equal((await verifyDatabase(configured(),dependencies)).code,'DATABASE_TLS_UNCONFIRMED');
});
test('database diagnostics redact error text and close pools after failures',async () => {
  for (const [code,expected] of [['28P01','DATABASE_AUTH_FAILED'],['ENOTFOUND','DATABASE_HOST_UNREACHABLE'],['CERT_HAS_EXPIRED','DATABASE_TLS_FAILED'],['unexpected-secret-code','DATABASE_CONNECTION_FAILED']]) {
    let closed = false;
    const result = await verifyDatabase(configured(),{pool:async () => ({query:async () => {throw Object.assign(new Error('password=secret'),{code});},end:async () => {closed = true;}}),model:async () => ({})});
    assert.equal(result.code,expected); assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(closed,true);
  }
});
test('connection probes enforce deadlines even with stalled injected clients', {timeout:2000},async () => {
  const config = {...configured(),providerTimeoutMs:100};
  const dependencies: ProbeDependencies = {pool:async () => ({query:async () => new Promise(() => {}),end:async () => {}}),model:async () => new Promise(() => {})};
  assert.equal((await verifyDatabase(config,dependencies)).code,'DATABASE_TIMEOUT');
  assert.equal((await verifyGemini(config,dependencies)).code,'GEMINI_CONNECTION_FAILED');
});
test('Gemini check uses model metadata only and requires advertised generation support',async () => {
  let called = false;
  const dependencies: ProbeDependencies = {pool:async () => undefined,model:async (config,signal) => {
    called = true; assert.equal(config.geminiModel,'test-model'); assert.equal(signal.aborted,false);
    return {name:'models/test-model',supportedActions:['generateContent']};
  }};
  assert.deepEqual(await verifyGemini(configured(),dependencies),{status:'passed',generate_content_advertised:true});
  assert.equal(called,true);
  dependencies.model = async () => ({name:'models/test-model',supportedActions:['embedContent']});
  assert.equal((await verifyGemini(configured(),dependencies)).code,'GEMINI_MODEL_UNSUPPORTED');
});
test('Gemini auth/model/quota failures produce safe actionable diagnostics',async () => {
  for (const [status,expected] of [[403,'GEMINI_AUTH_FAILED'],[404,'GEMINI_MODEL_UNAVAILABLE'],[429,'GEMINI_RATE_LIMITED'],[500,'GEMINI_CONNECTION_FAILED']] as const) {
    const result = await verifyGemini(configured(),{pool:async () => undefined,model:async () => {throw Object.assign(new Error('key=secret'),{status});}});
    assert.equal(result.code,expected); assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
test('connection targets accept explicit probes and reject arbitrary arguments',() => {
  assert.deepEqual(connectionTargets([]),['database','gemini']); assert.deepEqual(connectionTargets(['--database']),['database']);
  assert.deepEqual(connectionTargets(['--gemini','--gemini']),['gemini']); assert.throws(() => connectionTargets(['--url=https://bad.invalid']),/Use --database/);
});
