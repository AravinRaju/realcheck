import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createQuotaStore, EMPTY_LEDGER, QUOTA_KEY, QUOTA_SCRIPT, LEASE_MS, QuotaError, quotaConfiguration } from '../lib/quota.mjs';
import { loadLocalEnv } from '../lib/config.mjs';

export function loadQuotaConfig(env = process.env, loader = loadLocalEnv) {
  if (env.NODE_ENV !== 'production') {
    try { loader(); } catch { throw new QuotaError('configuration'); }
  }
  return { quotaUrl: env.UPSTASH_REDIS_REST_URL,
    quotaToken: env.UPSTASH_REDIS_REST_TOKEN, hourly: 5, daily: 20 };
}

export async function checkQuotaReadOnly(store) {
  // Redis enforces no writes even if this script is accidentally changed later.
  const result = await store.command(['EVAL_RO', QUOTA_SCRIPT, '1', QUOTA_KEY, 'check']);
  if (result === 404) throw new QuotaError('missing ledger');
  if (result !== 200) throw new QuotaError('ledger validation');
}

export async function diagnoseQuota(store, report = console.log) {
  if (await store.command(['PING']) !== 'PONG') throw new QuotaError('request error', 'unexpected PING result');
  report('REST connection: passed.');
  const echo = await store.command(['EVAL_RO', 'return {KEYS[1], ARGV[1]}', '1', QUOTA_KEY, 'check']);
  if (!Array.isArray(echo) || echo.length !== 2 || echo[0] !== QUOTA_KEY || echo[1] !== 'check') throw new QuotaError('request error', 'EVAL argument mapping');
  report('Read-only Lua and EVAL argument mapping: passed.');
  // Lua parses the entire production script, but the first branch returns
  // before any ledger access. This diagnoses compilation even when no key exists.
  const compiled = await store.command(['EVAL_RO', "if ARGV[1] == 'compile' then return 200 end\n" + QUOTA_SCRIPT, '1', QUOTA_KEY, 'compile']);
  if (compiled !== 200) throw new QuotaError('Lua execution', 'unexpected compilation result');
  report('Quota script compilation: passed.');
  await checkQuotaReadOnly(store);
  report('Existing ledger validation: passed. No writes or attempts admitted.');
}

// Runs the actual production Lua against real Redis, using only a random,
// isolated verification key. No provider imports, media, or production attempts.
export async function verifyQuota(config) {
  const key = 'realcheck:verify:' + randomUUID();
  const options = { key, diagnostics: true };
  const store = createQuotaStore(config, options);
  const command = store.command;
  const time = async () => {
    const tm = await command(['TIME']);
    return Number(tm[0]) * 1000 + Math.floor(Number(tm[1]) / 1000);
  };
  const seed = async (entries = [], owner = '', until = 0) => {
    const clock = await time();
    await command(['SET', key, JSON.stringify({ v: 1, entries, owner, until, clock })]);
  };
  let failure;
  try {
    assert.equal(await store.ready(), false, 'missing ledger must fail closed');
    await seed();
    // Independent clients concurrently contend for one global lease.
    const settled = await Promise.allSettled(Array.from({ length: 8 }, () => createQuotaStore(config, options).admit()));
    const rejected = settled.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    const results = settled.map(result => result.value);
    assert.equal(results.filter(r => r.allowed).length, 1, 'one winner across clients');
    const winner = results.find(r => r.allowed);
    assert.equal(await store.guard(winner.owner), true);
    assert.equal(await store.release(randomUUID()), false, 'foreign release must fail');
    assert.equal((await store.admit()).status, 503);
    assert.equal(await store.release(winner.owner), true);
    for (let i = 1; i < 5; i++) {
      const admitted = await createQuotaStore(config, options).admit();
      assert.equal(admitted.allowed, true); await store.release(admitted.owner);
    }
    assert.equal((await createQuotaStore(config, options).admit()).status, 429, 'hourly quota survives new clients');
    let now = await time();
    await seed(Array(20).fill(now - 7200000));
    assert.equal((await store.admit()).status, 429, 'daily quota includes older hours');
    await seed(Array(5).fill(now - 3601000));
    let admitted = await store.admit(); assert.equal(admitted.allowed, true); await store.release(admitted.owner);
    await seed(Array(20).fill(now - 86401000));
    admitted = await store.admit(); assert.equal(admitted.allowed, true); await store.release(admitted.owner);
    now = await time();
    const oldOwner = randomUUID();
    await seed([now - LEASE_MS - 1000], oldOwner, now - 1000);
    admitted = await store.admit(); assert.equal(admitted.allowed, true, 'expired lease recovers after crash');
    assert.equal(await store.release(oldOwner), false, 'stale owner cannot release replacement');
    assert.equal(await store.guard(oldOwner), false);
    assert.equal((await store.admit()).status, 503);
    await store.release(admitted.owner);
    const state = JSON.parse(await command(['GET', key]));
    assert.equal(state.entries.length, 2, 'crashed/failed attempts remain counted');
    assert.equal(await command(['PTTL', key]), -1, 'ledger never expires');
    await seed([], oldOwner, (await time()) + 1000);
    assert.equal(await store.guard(oldOwner), false, 'short lease cannot start providers');
    for (const raw of ['invalid', '{}', JSON.stringify({ v: 1, entries: [-1], owner: '', until: 0, clock: now })]) {
      await command(['SET', key, raw]);
      assert.equal((await store.admit()).status, 503, 'corruption fails closed');
    }
    await seed(); await command(['PEXPIRE', key, '60000']);
    assert.equal(await store.ready(), false, 'expiring ledger is unsafe');
    await command(['SET', key, JSON.stringify({ v: 1, entries: [], owner: '', until: 0, clock: (await time()) + 60000 })]);
    assert.equal((await store.admit()).status, 503, 'clock rollback fails closed');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // Delete only the random key created by this invocation, never the demo key.
    try { await command(['DEL', key]); }
    catch (error) { if (!failure) throw error; }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const mode = process.argv[2] || 'verify';
    if (!['verify', 'init', 'check', 'configuration', 'diagnose'].includes(mode)) throw new QuotaError('configuration');
    const config = loadQuotaConfig();
    for (const [name, status] of Object.entries(quotaConfiguration(config))) console.log(name + ': ' + status);
    const store = createQuotaStore(config, { diagnostics: true });
    store.assertConfigured();
    if (mode === 'configuration') {
      console.log('Configuration check passed. No network request made.');
    } else if (mode === 'diagnose') {
      await diagnoseQuota(store);
    } else if (mode === 'check') {
      await checkQuotaReadOnly(store);
      console.log('Production quota ledger is reachable and valid. No attempt admitted.');
    } else {
      if (process.env.REALCHECK_PUBLIC_LIVE_ENABLED === 'true') throw new QuotaError('configuration', 'public scans must be disabled');
      await verifyQuota(config);
      console.log('Real Redis verification passed: atomic contention, rolling limits, restart continuity, lease recovery and fail-closed state.');
      if (mode === 'init') {
        await store.command(['SET', QUOTA_KEY, EMPTY_LEDGER, 'NX']);
        assert.equal(await store.ready(), true);
        console.log('Production ledger initialized or preserved. Public scans remain disabled.');
      }
    }
  } catch (error) {
    console.error(error instanceof QuotaError ? error.message : 'Quota check failed at ledger validation.');
    console.error('Keep public scans disabled. No ledger reset was attempted.');
    process.exitCode = 1;
  }
}
