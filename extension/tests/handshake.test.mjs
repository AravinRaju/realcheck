import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../../server.mjs';
import { createPanelFetch } from '../client.mjs';
const expectedId = 'lbfnfcfbfiedpcihlklplieolhffpiol';
const expectedOrigin = 'chrome-extension://' + expectedId;

test('originless GET reproduces rejection; origin-bearing config POST authorizes only the exact extension', async () => {
  const fail = () => assert.fail('configuration must not call a provider');
  const server = createServer({ REALCHECK_MODE: 'fixture', REALCHECK_EXTENSION_ID: expectedId }, { detect: fail, transcribe: fail });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    // Reproduce the old contract: browser-permitted extension GET omits Origin.
    const oldResponse = await fetch(base + '/api/config');
    const oldConfig = await oldResponse.json();
    assert.equal(oldResponse.status, 200);
    assert.equal(oldConfig.sidePanel.configured, true);
    assert.equal(oldConfig.sidePanel.originReceived, undefined);
    assert.equal(oldConfig.sidePanel.authorized, false);

    let requests = 0;
    const panel = createPanelFetch(async (url, options) => {
      requests++;
      assert.equal(url, 'http://127.0.0.1:3001/api/config');
      assert.equal(options.method, 'POST'); assert.equal(options.body, undefined);
      assert.equal(new Headers(options.headers).has('Origin'), false);
      // Node has no extension execution origin. Emulate the browser's Origin
      // header here, not in production client code. Only a loopback server is used.
      return fetch(base + '/api/config', { ...options, headers: { Origin: expectedOrigin } });
    });
    const response = await panel('/api/config');
    const config = await response.json();
    assert.equal(requests, 1); assert.equal(config.sidePanel.authorized, true);
    assert.equal(config.sidePanel.requestMethod, undefined); assert.equal(config.sidePanel.originReceived, undefined);
    assert.equal(response.headers.get('access-control-allow-origin'), expectedOrigin);
    assert.equal(config.transcriptionReviewRequired, true);

    // Neither a claimed extension ID nor absent/null/foreign Origin grants access.
    for (const headers of [{}, { 'X-Extension-ID': expectedId },
      { Origin: 'null', 'X-Extension-ID': expectedId },
      { Origin: 'chrome-extension://' + 'a'.repeat(32), 'X-Extension-ID': expectedId },
      { Origin: 'https://example.com', 'X-Extension-ID': expectedId }]) {
      const denied = await fetch(base + '/api/config', { method: 'POST', headers });
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
    }
    const preflight = await fetch(base + '/api/config', { method: 'OPTIONS', headers: {
      Origin: expectedOrigin, 'Access-Control-Request-Method': 'POST',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');
    const withBody = await fetch(base + '/api/config', { method: 'POST', headers: { Origin: expectedOrigin }, body: 'not allowed' });
    assert.equal(withBody.status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
