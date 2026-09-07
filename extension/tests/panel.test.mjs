import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPanelFetch } from '../client.mjs';
import { buildPanel } from '../build.mjs';

test('panel sends only explicit API requests to the fixed loopback backend', async () => {
  let calls = 0;
  const fetcher = createPanelFetch(async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:3001/api/config');
    assert.equal(init.method, 'POST'); assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).has('origin'), false);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store'); assert.equal(init.mode, 'cors');
    return Response.json({ mode: 'fixture', sidePanel: { protocol: 1, configured: true, authorized: true } });
  });
  assert.equal(calls, 0);
  await fetcher('/api/config'); assert.equal(calls, 1);
  for (const path of ['https://api.groq.com/', '/api/config?key=secret', '/api/analyze', '/api/other']) {
    assert.throws(() => fetcher(path));
  }
  assert.equal(calls, 1);
});
test('panel refuses config from an outdated or unauthorized backend without retries', async () => {
  for (const [config, code] of [[{ mode: 'live' }, 'panel_schema'],
    [{ sidePanel: { protocol: 1, configured: true, authorized: false } }, 'panel_origin'],
    [{ sidePanel: { protocol: 1, configured: false, authorized: false } }, 'panel_unconfigured'],
    [{ sidePanel: { protocol: 2, authorized: true } }, 'panel_schema']]) {
    let calls = 0;
    const fetcher = createPanelFetch(async () => { calls++; return Response.json(config); });
    await assert.rejects(fetcher('/api/config'), error => error.code === code);
    assert.equal(calls, 1);
  }
});
test('config failures identify transport, HTTP and JSON steps without exposing raw errors', async () => {
  for (const [fetcher, code] of [
    [async () => { throw new Error('private transport details'); }, 'panel_transport'],
    [async () => new Response('private rejection body', { status: 403 }), 'panel_http'],
    [async () => new Response('private invalid JSON'), 'panel_json'],
  ]) {
    await assert.rejects(createPanelFetch(fetcher)('/api/config'), error => {
      assert.equal(error.code, code); assert.doesNotMatch(error.message, /private/); return true;
    });
  }
  assert.throws(() => createPanelFetch()('/api/config', { body: new Blob(['not a config request']) }), /must not contain media/);
});
test('panel preserves the exact selected file and request ID with no authorization header', async () => {
  const file = new Blob(['synthetic input']);
  const headers = { 'X-Request-ID': 'test-id' };
  const fetcher = createPanelFetch(async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/analyze');
    assert.equal(init.body, file); assert.equal(init.headers, headers);
    assert.equal(init.headers.Authorization, undefined);
  });
  await fetcher('/api/analyze', { method: 'POST', body: file, headers });
});
test('packaged panel reuses exact app/review/rules and preserves review controls', async () => {
  const output = await mkdtemp(join(tmpdir(), 'realcheck-panel-test-'));
  try {
    await buildPanel(output);
    const root = new URL('../../', import.meta.url);
    const app = await readFile(new URL('public/app.js', root), 'utf8');
    assert.equal(await readFile(join(output, 'panel/app.js'), 'utf8'), "import { createPanelFetch } from '../client.mjs';\nconst fetch = createPanelFetch(undefined, \"http://127.0.0.1:3001\");\n" + app);
    for (const [target, source] of [['panel/review.mjs', 'public/review.mjs'], ['lib/rules.mjs', 'lib/rules.mjs']]) {
      assert.equal(await readFile(join(output, target), 'utf8'), await readFile(new URL(source, root), 'utf8'));
    }
    const html = await readFile(join(output, 'panel/index.html'), 'utf8');
    for (const id of ['review-confirm', 'transcript-edit', 'check-wording', 'media-preview', 'fixture-controls']) assert.ok(html.includes('id="' + id + '"'));
    assert.ok(html.includes('src="./app.js"')); assert.ok(html.includes('id="extension-id"'));
  } finally { await rm(output, { recursive: true, force: true }); }
});
test('manifest has no page-reading, storage, provider-host or broad web permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.template.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['sidePanel']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.equal(manifest.content_scripts, undefined); assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.ok(manifest.content_security_policy.extension_pages.includes('connect-src http://127.0.0.1:3001;'));
});
