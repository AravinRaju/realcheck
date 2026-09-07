import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredExtensionOrigin, extensionApiAccess } from '../server-access.mjs';
const id = 'a'.repeat(32), origin = configuredExtensionOrigin(id);
const request = (headers = {}, method = 'POST') => ({ method, headers: { host: '127.0.0.1:3001', ...headers } });

test('extension access is disabled unless one exact extension ID is configured', () => {
  assert.equal(configuredExtensionOrigin(), null);
  for (const value of ['*', 'https://example.com', 'null', id + ',' + id, 'z'.repeat(32)]) assert.throws(() => configuredExtensionOrigin(value));
  assert.equal(extensionApiAccess(request({ origin }), '/api/analyze', null).denied, true);
});
test('only the configured extension origin receives CORS, never credentials or wildcard', () => {
  const access = extensionApiAccess(request({ origin, 'sec-fetch-site': 'cross-site' }), '/api/analyze', origin);
  assert.equal(access.trusted, true); assert.equal(access.headers['Access-Control-Allow-Origin'], origin);
  assert.equal(access.headers['Access-Control-Allow-Credentials'], undefined);
  for (const untrusted of ['chrome-extension://' + 'b'.repeat(32), origin + '.evil', 'null', 'https://example.com']) {
    const denied = extensionApiAccess(request({ origin: untrusted }), '/api/analyze', origin);
    assert.equal(denied.denied, true); assert.deepEqual(denied.headers, {});
  }
});
test('same-origin website behavior remains allowed without extension configuration', () => {
  for (const headers of [{}, { origin: 'http://127.0.0.1:3001', 'sec-fetch-site': 'same-origin' }]) {
    assert.equal(extensionApiAccess(request(headers), '/api/analyze', null).denied, false);
  }
});
test('preflight is restricted to route method and upload headers', () => {
  const headers = { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-file-name, x-request-id' };
  assert.equal(extensionApiAccess(request(headers, 'OPTIONS'), '/api/analyze', origin).preflight, true);
  for (const changes of [{ 'access-control-request-method': 'DELETE' }, { 'access-control-request-headers': 'authorization' }, { origin: 'https://example.com' }]) {
    assert.equal(extensionApiAccess(request({ ...headers, ...changes }, 'OPTIONS'), '/api/analyze', origin).denied, true);
  }
});
