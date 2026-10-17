import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AppError} from '../src/runtime/errors.js';
import {ingestionFailure} from '../src/runtime/ingestion-errors.js';
import {fetchText,readResponse} from '../src/data/providers/http.js';
import {audienceContext} from '../src/services/gemini/audience.js';

test('provider failure diagnostics expose safe status without URLs, bodies or credentials',async () => {
  for (const status of [301,403,429,503]) {
    await assert.rejects(readResponse(new Response('synthetic-secret provider body',{status,headers:{location:'https://secret.invalid/key'}})),error => {
      const result=ingestionFailure(error);
      assert.equal(result.upstream_status,status);
      assert.equal(result.code,status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE');
      assert.ok(!JSON.stringify(result).includes('secret'));
      return true;
    });
  }
  const denied=ingestionFailure(Object.assign(new Error('password=synthetic-secret'),{code:'42501'}));
  assert.equal(denied.code,'DATABASE_PERMISSION_DENIED');
  assert.ok(!JSON.stringify(denied).includes('secret'));
  assert.equal(ingestionFailure(new Error('key=synthetic-secret')).code,'INGESTION_FAILED');
  assert.ok(!JSON.stringify(ingestionFailure(new Error('key=synthetic-secret'))).includes('secret'));
});
test('network failures redact raw fetch diagnostics and cancellation retains its own error code',async () => {
  const signal=new AbortController().signal;
  await assert.rejects(fetchText(async () => {throw new Error('https://secret.invalid/?key=synthetic-secret');},'https://example.invalid',{signal}),error => {
    const result=ingestionFailure(error);
    assert.equal(result.code,'PROVIDER_NETWORK_ERROR');
    assert.ok(!JSON.stringify(result).includes('secret')); return true;
  });
  await assert.rejects(fetchText(async () => {throw new Error('Must not fetch');},'https://example.invalid',{signal:AbortSignal.abort()}),error => error instanceof AppError && error.code==='REQUEST_CANCELLED');
});
test('audience defaults to general public and rejects prototype keys, objects and unknown perspectives',() => {
  assert.equal(audienceContext(undefined).audience,'general_public');
  for (const invalid of ['__proto__','constructor','public',null,{},[],false]) assert.throws(() => audienceContext(invalid),/Choose general_public/);
});
