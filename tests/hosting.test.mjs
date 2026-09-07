import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostingConfig, publicUsage } from '../lib/hosting.mjs';
import { extensionApiAccess } from '../extension/server-access.mjs';
import { buildPanel } from '../extension/build.mjs';
import { createPanelFetch } from '../extension/client.mjs';
import { createServer } from '../server.mjs';
import { once } from 'node:events';
import { wav } from './helpers.mjs';
const origin = 'https://realchecknow.xyz';
const extension = 'chrome-extension://lbfnfcfbfiedpcihlklplieolhffpiol';

test('hosting preserves local defaults and validates explicit production configuration', () => {
  assert.equal(hostingConfig({}).host, '127.0.0.1');
  const config = hostingConfig({ REALCHECK_PUBLIC_ORIGIN: origin, PORT: '8080' });
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 8080); assert.equal(config.enabled, false);
  for (const env of [{ NODE_ENV: 'production' }, { HOST: '0.0.0.0' }, { PORT: 'invalid' }, { REALCHECK_PUBLIC_ORIGIN: origin + '/' }, { REALCHECK_PUBLIC_ORIGIN: 'http://realchecknow.xyz' }, { REALCHECK_DAILY_LIMIT: '101' }]) assert.throws(() => hostingConfig(env));
});

test('HTTPS website and exact extension origins pass; missing, forged and foreign origins fail', () => {
  const access = (value, extra = {}) => extensionApiAccess({ method: 'POST', headers: { host: 'internal:8080', origin: value, ...extra } }, '/api/analyze', extension, origin);
  assert.equal(access(origin).denied, false); assert.equal(access(extension).trusted, true);
  for (const value of [undefined, 'null', 'http://realchecknow.xyz', origin + '.evil.test', 'https://www.realchecknow.xyz', extension + 'a']) assert.equal(access(value, { 'x-forwarded-host': 'realchecknow.xyz', 'x-forwarded-proto': 'https' }).denied, true);
  const preflight = extensionApiAccess({ method: 'OPTIONS', headers: { origin: extension, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-file-name,x-request-id' } }, '/api/analyze', extension, origin);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], extension);
});

test('global hourly/daily admission budget survives restart and fails closed on ledger errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'realcheck-budget-'));
  try {
    let time = 100000000;
    const config = { origin, enabled: true, stateDir: root, daily: 3, hourly: 2 };
    let admit = publicUsage(config, { now: () => time });
    assert.equal(admit().allowed, true); assert.equal(admit().allowed, true);
    assert.equal(admit().status, 429);
    admit = publicUsage(config, { now: () => time }); assert.equal(admit().status, 429);
    time += 3600001; assert.equal(admit().allowed, true); assert.equal(admit().status, 429);
    time += 86400001; assert.equal(admit().allowed, true);
    writeFileSync(join(root, 'usage.json'), 'bad'); assert.throws(() => publicUsage(config));
    assert.throws(() => publicUsage({ ...config, stateDir: 'relative' }));
    writeFileSync(join(root, 'usage.json'), '[]');
    admit = publicUsage(config); rmSync(root, { recursive: true });
    assert.equal(admit().status, 503); assert.equal(admit().status, 503);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hosted scans default off, do not call providers, and config contains no process diagnostics', async () => {
  let calls = 0;
  const server = createServer({ REALCHECK_MODE: 'live', REALCHECK_PUBLIC_ORIGIN: origin }, { detect: () => { calls++; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.scansEnabled, false); assert.equal(config.detectionEnabled, false);
    assert.equal(config.server, undefined); assert.equal(config.detection, undefined);
    assert.doesNotMatch(JSON.stringify(config), /projectPath|sdkVersion|workingTree|pid|originReceived|requestMethod/);
    const result = await fetch(base + '/api/analyze', { method: 'POST', headers: { Origin: origin }, body: 'synthetic' });
    assert.equal(result.status, 503); assert.equal(calls, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('hosted admission enforces one active scan and quota before provider calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'realcheck-host-test-'));
  let calls = 0, release, started;
  const pending = new Promise(resolve => { started = resolve; });
  const server = createServer({ REALCHECK_MODE: 'live', REALCHECK_PUBLIC_ORIGIN: origin, REALCHECK_PUBLIC_LIVE_ENABLED: 'true', REALCHECK_STATE_DIR: root, REALCHECK_DAILY_LIMIT: '1', REALCHECK_HOURLY_LIMIT: '1' }, {
    detect: async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); return { label: 'Unlikely deepfake' }; },
    transcribe: async () => ({ text: 'Synthetic test.', language: 'english' }),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const upload = () => fetch(base + '/api/analyze', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'audio/wav', 'X-File-Name': 'synthetic.wav' }, body: wav() });
  try {
    const first = upload(); await pending;
    assert.equal((await upload()).status, 503); release(); assert.equal((await first).status, 200);
    assert.equal((await upload()).status, 429); assert.equal(calls, 1);
  } finally { release?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});

test('extension builds and requests use only their selected allowed backend', async () => {
  const root = mkdtempSync(join(tmpdir(), 'realcheck-host-panel-'));
  try {
    for (const backend of [origin, 'http://127.0.0.1:3001']) {
      await buildPanel(root, backend);
      const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
      assert.deepEqual(manifest.host_permissions, [new URL(backend).protocol + '//' + new URL(backend).hostname + '/*']);
      assert.ok(manifest.content_security_policy.extension_pages.includes('connect-src ' + backend + ';'));
      assert.ok(readFileSync(join(root, 'panel/app.js'), 'utf8').includes(JSON.stringify(backend)));
      const fetcher = createPanelFetch(async (url, init) => { assert.equal(url, backend + '/api/config'); assert.equal(init.method, 'POST'); return Response.json({ sidePanel: { protocol: 1, configured: true, authorized: true } }); }, backend);
      await fetcher('/api/config');
    }
    for (const backend of ['https://evil.test', origin + '/', 'http://realchecknow.xyz', origin + '?secret=bad']) assert.throws(() => createPanelFetch(undefined, backend));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
