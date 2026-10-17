import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../src/config.js';

test('slow manual news providers get a separate bounded timeout without extending interactive provider deadlines',() => {
  const defaults=readConfig({});
  assert.equal(defaults.ingestionProviderTimeoutMs,30000);
  assert.equal(defaults.providerTimeoutMs,8000);
  const configured=readConfig({INGESTION_PROVIDER_TIMEOUT_MS:'15000',PROVIDER_TIMEOUT_MS:'4000'});
  assert.equal(configured.ingestionProviderTimeoutMs,15000);
  assert.equal(configured.providerTimeoutMs,4000);
  for (const invalid of ['0','99','30001','-1','NaN','secret-invalid-setting']) {
    assert.throws(() => readConfig({INGESTION_PROVIDER_TIMEOUT_MS:invalid}),error => error instanceof Error && error.message==='Invalid INGESTION_PROVIDER_TIMEOUT_MS');
  }
});
