import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQuotaStore, QUOTA_KEY, QUOTA_SCRIPT, LEASE_MS, quotaConfiguration } from '../lib/quota.mjs';
import { loadQuotaConfig, diagnoseQuota, checkQuotaReadOnly } from '../scripts/verify-quota.mjs';
import { hostingConfig, publicUsage } from '../lib/hosting.mjs';
import { createServer } from '../server.mjs';
import { budgets } from '../lib/budgets.mjs';
import { wav } from './helpers.mjs';
const config = { quotaUrl: 'https://test.upstash.io', quotaToken: 'private-test-token', hourly: 5, daily: 20 };

test('quota CLI loads local environment before configuration, but never loads it in production', () => {
  const env = {};
  let loads = 0;
  const result = loadQuotaConfig(env, () => {
    loads++; env.UPSTASH_REDIS_REST_URL = config.quotaUrl; env.UPSTASH_REDIS_REST_TOKEN = config.quotaToken;
  });
  assert.equal(loads, 1); assert.deepEqual(result, config);
  loadQuotaConfig({ NODE_ENV: 'production' }, () => assert.fail('production must not load .env'));
  assert.throws(() => loadQuotaConfig({}, () => { throw new Error('private data'); }),
    error => error.stage === 'configuration' && !error.message.includes('private data'));
  assert.equal(quotaConfiguration({ ...config, quotaToken: 'PASTE_YOUR_ACTUAL_TOKEN_HERE' }).UPSTASH_REDIS_REST_TOKEN, 'missing');
  const store = createQuotaStore({ ...config, quotaToken: 'PASTE_YOUR_ACTUAL_TOKEN_HERE' }, { fetcher: () => assert.fail('placeholder must not be sent') });
  assert.throws(() => store.assertConfigured(), error => error.stage === 'configuration');
});

test('CLI diagnostics identify failure stages without propagating upstream secrets', async () => {
  const cases = [
    ['network', async () => { throw Object.assign(new Error('private upstream token'), { cause: { code: 'EACCES' } }); }, 'EACCES'],
    ['request error', async () => new Response('private upstream token', { status: 401 }), '401'],
    ['Lua execution', async () => Response.json({ error: 'ERR Error compiling script: private upstream token' }, { status: 400 }), 'compile error'],
    ['request error', async () => new Response('private upstream token')],
    ['ledger validation', async () => Response.json({ result: '200' })],
  ];
  for (const [stage, fetcher, detail] of cases) {
    const store = createQuotaStore(config, { fetcher, diagnostics: true });
    await assert.rejects(store.ready(), error => {
      assert.equal(error.stage, stage);
      if (detail) assert.ok(error.message.includes(detail));
      assert.doesNotMatch(error.message, /private|upstash\.io|Bearer/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(await createQuotaStore(config, { fetcher }).ready(), false);
  }
});

test('HTTP 400 error envelopes distinguish request, Lua and wrong-type failures without raw output', async () => {
  const cases = [
    ['ERR wrong number of arguments for eval: private upstream token', 'request error'],
    ['ERR unknown command private upstream token', 'request error'],
    ['NOPERM private upstream token', 'request error'],
    ["ERR Error compiling script (new function): user_script:9: '<name>' expected near 'until'; private upstream token", 'Lua execution'],
    ['ERR Error running script: user_script:4: private upstream token', 'Lua execution'],
    ['WRONGTYPE private upstream token', 'ledger validation'],
    ['private upstream token https://secret.example/path', 'request error'],
  ];
  for (const [raw, stage] of cases) {
    const store = createQuotaStore(config, { fetcher: async () => Response.json({ error: raw }, { status: 400 }), diagnostics: true });
    await assert.rejects(store.command(['EVAL_RO', QUOTA_SCRIPT, '1', QUOTA_KEY, 'check']), error => {
      assert.equal(error.stage, stage); assert.match(error.message, /HTTP 400/);
      assert.doesNotMatch(error.message, /private|https:|user_script|until/);
      return true;
    });
  }
});

test('read-only diagnostic checks transport, key/argument order, full compilation and missing ledger without mutations', async () => {
  const commands = [], output = [];
  const replies = ['PONG', [QUOTA_KEY, 'check'], 200, 404];
  const store = createQuotaStore(config, { fetcher: async (url, init) => {
    assert.equal(url, config.quotaUrl);
    assert.equal(new URL(url).pathname, '/');
    assert.equal(new URL(url).search, '');
    assert.equal(init.method, 'POST');
    const command = JSON.parse(init.body); commands.push(command);
    assert.ok(command.every(value => typeof value === 'string'));
    return Response.json({ result: replies.shift() });
  } });
  await assert.rejects(diagnoseQuota(store, line => output.push(line)), error => error.stage === 'missing ledger');
  assert.deepEqual(commands.map(command => command[0]), ['PING', 'EVAL_RO', 'EVAL_RO', 'EVAL_RO']);
  assert.deepEqual(commands[1].slice(2), ['1', QUOTA_KEY, 'check']);
  assert.ok(commands[2][1].endsWith(QUOTA_SCRIPT));
  assert.deepEqual(commands[2].slice(2), ['1', QUOTA_KEY, 'compile']);
  assert.deepEqual(commands[3], ['EVAL_RO', QUOTA_SCRIPT, '1', QUOTA_KEY, 'check']);
  assert.equal(output.length, 3);
  assert.doesNotMatch(output.join('\n'), /upstash\.io|private-test-token|Bearer/);
});

test('read-only ledger check distinguishes missing, invalid, valid and malformed responses', async () => {
  for (const [result, expected] of [[404, 'missing ledger'], [503, 'ledger validation'], ['200', 'ledger validation'], [null, 'ledger validation'], [200, null]]) {
    const store = createQuotaStore(config, { fetcher: async () => Response.json({ result }) });
    if (expected) await assert.rejects(checkQuotaReadOnly(store), error => error.stage === expected);
    else await checkQuotaReadOnly(store);
  }
});

test('quota Lua accesses the reserved until field using bracket notation', () => {
  // Regression for the confirmed compilation failure: Lua keywords cannot
  // follow a dot. This is not a substitute for the remote compilation probe.
  assert.doesNotMatch(QUOTA_SCRIPT, /\.until\b/);
  assert.match(QUOTA_SCRIPT, /s\["until"\]/);
});

test('REST admission is one authenticated atomic command, with bounded time and no redirect/retry', async () => {
  const commands = [];
  const store = createQuotaStore(config, { fetcher: async (url, init) => {
    assert.equal(url, config.quotaUrl); assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, 'Bearer private-test-token');
    commands.push(JSON.parse(init.body)); return Response.json({ result: 200 });
  } });
  const admitted = await store.admit();
  assert.equal(admitted.allowed, true);
  assert.deepEqual(commands[0], ['EVAL', QUOTA_SCRIPT, '1', QUOTA_KEY, 'admit', admitted.owner, '5', '20']);
  assert.equal(await store.guard(admitted.owner), true);
  assert.equal(await store.release(admitted.owner), true);
  assert.equal(commands[1][5], admitted.owner); assert.equal(commands[2][5], admitted.owner);
  assert.ok(LEASE_MS > budgets.clientMs);
});

test('unavailable, ambiguous, malformed and denied storage results never admit or retry', async () => {
  for (const fetcher of [
    async () => { throw new Error('private upstream details'); },
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => new Response('private upstream details', { status: 401 }),
    async () => new Response('invalid JSON'),
    ...[null, {}, { error: 'private', result: 200 }, { result: '200' }, { result: true }, { result: 429 }, { result: 503 }].map(body => async () => Response.json(body)),
  ]) {
    let calls = 0;
    const store = createQuotaStore(config, { fetcher: (...args) => { calls++; return fetcher(...args); } });
    assert.equal((await store.admit()).allowed, false); assert.equal(calls, 1);
    assert.equal(await store.ready(), false); assert.equal(await store.guard('owner'), false);
    assert.equal(await store.release('owner'), false);
  }
});

test('missing/unsafe configuration fails closed, local development stays independent of Redis', async () => {
  for (const quotaUrl of [undefined, 'http://test.upstash.io', 'https://test.upstash.io.evil.test', 'https://user:pass@test.upstash.io', 'https://test.upstash.io/?token=secret']) {
    const store = createQuotaStore({ ...config, quotaUrl }, { fetcher: () => assert.fail('must not send credentials') });
    assert.equal(await store.ready(), false); assert.equal((await store.admit()).status, 503);
  }
  for (const env of [{ REALCHECK_HOURLY_LIMIT: '6' }, { REALCHECK_DAILY_LIMIT: '21' }]) assert.throws(() => hostingConfig(env));
  const local = publicUsage(hostingConfig({}), { fetcher: () => assert.fail('local must not contact storage') });
  assert.equal((await local.admit()).allowed, true);
});

test('HTTP failures preserve quota, await cleanup, and never dispatch providers without a valid lease', { timeout: 5000 }, async () => {
  const origin = 'https://realchecknow.xyz';
  const tempRoot = await mkdtemp(join(tmpdir(), 'realcheck-quota-test-'));
  let calls = 0, commands = [], admissionStatus = 200, guardStatus = 200, readyStatus = 200;
  const server = createServer({ REALCHECK_MODE: 'live', REALCHECK_PUBLIC_ORIGIN: origin,
    REALCHECK_PUBLIC_LIVE_ENABLED: 'true', UPSTASH_REDIS_REST_URL: config.quotaUrl, UPSTASH_REDIS_REST_TOKEN: config.quotaToken }, {
    tempRoot,
    quotaOptions: { fetcher: async (_url, init) => {
      const args = JSON.parse(init.body); commands.push(args);
      return Response.json({ result: args[4] === 'admit' ? admissionStatus : args[4] === 'guard' ? guardStatus : args[4] === 'check' ? readyStatus : 200 });
    } },
    detect: async () => { calls++; throw new Error('synthetic provider failure'); },
    transcribe: async () => ({ text: 'Synthetic transcript.', language: 'english' }),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const upload = (headers = {}, body = wav()) => fetch(base + '/api/analyze', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'audio/wav', 'X-File-Name': 'test.wav', ...headers }, body });
  try {
    assert.equal((await upload({ Origin: 'https://evil.test' })).status, 403); assert.equal(commands.length, 0);
    assert.equal((await upload({}, Buffer.from('invalid media'))).status, 400);
    // Wait for the server's asynchronous release before the next request.
    while (commands.at(-1)?.[4] !== 'release') await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands.map(c => c[4]), ['admit', 'release']); assert.equal(calls, 0);
    assert.deepEqual(await readdir(tempRoot), []);
    commands = []; guardStatus = 503;
    assert.equal((await upload()).status, 503);
    while (commands.at(-1)?.[4] !== 'release') await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 0); assert.deepEqual(await readdir(tempRoot), []);
    commands = []; guardStatus = 200;
    const result = await (await upload()).json();
    assert.equal(result.authenticity.status, 'unavailable'); assert.equal(result.transcription.status, 'complete');
    assert.equal(result.content.status, 'not_evaluated'); assert.equal(calls, 1);
    while (commands.at(-1)?.[4] !== 'release') await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands.map(c => c[4]), ['admit', 'guard', 'release']);
    assert.deepEqual(await readdir(tempRoot), []);
    commands = []; admissionStatus = 503;
    assert.equal((await upload()).status, 503); assert.deepEqual(commands.map(c => c[4]), ['admit']); assert.equal(calls, 1);
    readyStatus = 503;
    assert.equal((await (await fetch(base + '/api/config')).json()).scansEnabled, false);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('pending storage admission reserves the local slot and missing storage cannot enable hosted scans', { timeout: 5000 }, async () => {
  const origin = 'https://realchecknow.xyz';
  const env = { REALCHECK_MODE: 'live', REALCHECK_PUBLIC_ORIGIN: origin, REALCHECK_PUBLIC_LIVE_ENABLED: 'true' };
  let finishAdmission, enteredAdmission;
  const entered = new Promise(resolve => { enteredAdmission = resolve; });
  let storageCalls = 0, providerCalls = 0;
  const servers = [createServer(env), createServer({ ...env,
    UPSTASH_REDIS_REST_URL: config.quotaUrl, UPSTASH_REDIS_REST_TOKEN: config.quotaToken }, {
    quotaOptions: { fetcher: async () => {
      storageCalls++; enteredAdmission();
      await new Promise(resolve => { finishAdmission = resolve; });
      return Response.json({ result: 503 });
    } },
    detect: () => { providerCalls++; }, transcribe: () => { providerCalls++; },
  })];
  for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const upload = server => fetch('http://127.0.0.1:' + server.address().port + '/api/analyze',
    { method: 'POST', headers: { Origin: origin }, body: 'synthetic' });
  try {
    const cfg = await (await fetch('http://127.0.0.1:' + servers[0].address().port + '/api/config')).json();
    assert.equal(cfg.scansEnabled, false); assert.equal(cfg.detectionEnabled, false);
    assert.equal((await upload(servers[0])).status, 503);
    const first = upload(servers[1]); await entered;
    assert.equal((await upload(servers[1])).status, 503);
    assert.equal(storageCalls, 1); finishAdmission();
    assert.equal((await first).status, 503); assert.equal(providerCalls, 0);
  } finally {
    finishAdmission?.();
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
