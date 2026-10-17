import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanTigerUri,mergeEnvironment,assertMigrationPrefix,migrations,pgpass,setupOptions,verifyRuntime,setupTiger} from '../src/setup/tiger.js';
import {readConfig} from '../src/config.js';
import {AppError} from '../src/runtime/errors.js';
test('Tiger URI normalization strips URL TLS overrides while retaining credential encoding and session options',() => {
  const uri=cleanTigerUri('postgresql://atlas_runtime:test%40password@service.project.tsdb.cloud.timescale.com:35967/tsdb?sslmode=require&sslrootcert=wrong&options=-c%20default_transaction_read_only%3Don');
  assert.equal(uri.searchParams.has('sslmode'),false); assert.equal(uri.searchParams.has('sslrootcert'),false);
  assert.equal(decodeURIComponent(uri.password),'test@password'); assert.equal(uri.username,'atlas_runtime');
  assert.equal(uri.searchParams.get('options'),'-c default_transaction_read_only=on');
  for (const value of ['not a uri','postgresql://user@service.project.tsdb.cloud.timescale.com/db','postgresql://user:secret@attacker.invalid/db','https://user:secret@service.project.tsdb.cloud.timescale.com/db'])
    assert.throws(() => cleanTigerUri(value),error => error instanceof Error && !error.message.includes('secret'));
});
test('private environment updates preserve Gemini secrets/comments and remove duplicate active database settings',() => {
  const existing="# local settings\nGEMINI_API_KEY='synthetic-test-key'\nGEMINI_MODEL='test-model'\nDATABASE_URL='old'\nDATABASE_URL='duplicate'\n# DATABASE_CA_FILE=optional\n";
  const updated=mergeEnvironment(existing,{DATABASE_URL:'postgresql://synthetic',ATLAS_DATABASE_MODULE:'db/handoff/database.mjs'});
  assert.ok(updated.includes("GEMINI_API_KEY='synthetic-test-key'")); assert.ok(updated.includes('# local settings'));
  assert.equal(updated.split('\n').filter(line => line.startsWith('DATABASE_URL=')).length,1);
  assert.ok(updated.includes('ATLAS_DATABASE_MODULE="db/handoff/database.mjs"'));
});
test('migration resume accepts only a contiguous prefix of the frozen handoff',() => {
  assert.doesNotThrow(() => assertMigrationPrefix([])); assert.doesNotThrow(() => assertMigrationPrefix([...migrations]));
  assert.doesNotThrow(() => assertMigrationPrefix(['001_extensions','002_records']));
  assert.throws(() => assertMigrationPrefix(['001_extensions','003_observations']),/preserve/);
  assert.throws(() => assertMigrationPrefix([...migrations,'unknown_version']),/preserve/);
});
test('psql password records escape delimiters without putting secrets in command arguments',() => {
  const uri=cleanTigerUri('postgresql://tsdbadmin:test%3Apass%5Cword@service.project.tsdb.cloud.timescale.com:35967/tsdb');
  assert.equal(pgpass(uri),'service.project.tsdb.cloud.timescale.com:35967:tsdb:tsdbadmin:test\\:pass\\\\word\n');
});
test('cloud writes require the explicit initialize flag and selected existing service',() => {
  assert.deepEqual(setupOptions(['--service','service-id']),{service:'service-id',initialize:false,caFile:undefined});
  assert.equal(setupOptions(['--service','service-id','--initialize']).initialize,true);
  assert.throws(() => setupOptions(['--service','service; rm -rf']),/existing Tiger service/);
  assert.throws(() => setupOptions(['--create']),/Use --service/);
});
test('runtime verification requires the least-privilege role and readable completed schema, closing connections on every outcome',async () => {
  for (const result of [{role:'atlas_runtime',migrations:5,privileged:false},{role:'tsdbadmin',migrations:5,privileged:true},{role:'atlas_runtime',migrations:4,privileged:false},{role:'atlas_runtime',migrations:5,privileged:true},undefined]) {
    let closed=false;
    const probe=verifyRuntime(readConfig({}),async () => ({query:async sql => {
      assert.match(sql,/^SELECT /); assert.doesNotMatch(sql,/\b(?:ALTER|CREATE|INSERT INTO|UPDATE|DELETE FROM)\s+(?:ROLE|TABLE|SCHEMA|atlas\.)/);
      return {rows:result?[result]:[]};
    },end:async () => {closed=true;}}));
    if (result?.role==='atlas_runtime' && result.migrations===5 && !result.privileged) await probe;
    else await assert.rejects(probe,/Runtime role or readable schema/);
    assert.equal(closed,true);
  }
  let closed=false;
  await assert.rejects(verifyRuntime(readConfig({}),async () => ({query:async () => {throw new Error('synthetic connection failure');},end:async () => {closed=true;}})),/connection failure/);
  assert.equal(closed,true);
});
test('Tiger setup refuses production/unready services before requesting credentials or connecting',async () => {
  for (const service of [{metadata:{environment:'PROD'},status:'READY'},{metadata:{environment:'DEV'},status:'CREATING'}]) {
    let cliCalls=0;
    await assert.rejects(setupTiger(readConfig({}),{service:'synthetic',initialize:true},() => {},{
      cli:async args => {cliCalls++; assert.equal(args[0],'service'); return JSON.stringify(service);},
      pool:async () => {throw new Error('Must not connect');}
    }),error => error instanceof AppError && error.code==='TIGER_SERVICE_NOT_DEV');
    assert.equal(cliCalls,1);
  }
});
test('untrusted Tiger TLS fails before DDL, closes the pool and redacts captured connection errors',async () => {
  let closed=false,queries=0;
  await assert.rejects(setupTiger(readConfig({}),{service:'synthetic',initialize:true},() => {},{
    cli:async args => args[0]==='service'?JSON.stringify({metadata:{environment:'DEV'},status:'READY'}):'postgresql://tsdbadmin:synthetic-secret@service.project.tsdb.cloud.timescale.com/tsdb',
    pool:async config => {
      assert.equal(config.databaseUrl?.includes('sslmode'),false);
      return {query:async sql => {
        queries++; assert.match(sql,/^SELECT /);
        throw Object.assign(new Error('synthetic-secret: raw database details'),{code:'SELF_SIGNED_CERT_IN_CHAIN'});
      },end:async () => {closed=true;}};
    }
  }),error => error instanceof AppError && error.code==='TIGER_TLS_UNTRUSTED' && !error.message.includes('synthetic-secret'));
  assert.equal(queries,1); assert.equal(closed,true);
});
test('an unrecognized existing Atlas schema is preserved before setup attempts any mutation',async () => {
  let queries=0,closed=false;
  await assert.rejects(setupTiger(readConfig({}),{service:'synthetic',initialize:true},() => {},{
    cli:async args => args[0]==='service'?JSON.stringify({metadata:{environment:'DEV'},status:'READY'}):'postgresql://tsdbadmin:synthetic@service.project.tsdb.cloud.timescale.com/tsdb',
    pool:async () => ({query:async sql => {queries++; assert.match(sql,/^SELECT /); return {rows:[{atlas_schema:true,migrations:null,runtime_role:false}]};},end:async () => {closed=true;}})
  }),error => error instanceof AppError && error.code==='TIGER_SCHEMA_CONFLICT');
  assert.equal(queries,1); assert.equal(closed,true);
});
