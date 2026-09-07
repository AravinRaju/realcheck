import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from '../../server.mjs';
import { createTranscriber } from '../../lib/providers.mjs';
import { wav } from '../../tests/helpers.mjs';
const id = 'a'.repeat(32), origin = 'chrome-extension://' + id;
const hash = value => createHash('sha256').update(value).digest('hex');
async function withBackend(env, action, dependencies = {}) {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-extension-test-'));
  const server = createServer(env, { tempRoot: root, fixtureDelay: 0, ...dependencies });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await action('http://127.0.0.1:' + server.address().port, root); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
}
test('configured panel completes one traced upload; providers stay on server and wording checks wait', async () => {
  const bytes = wav(), requestId = '12345678-1234-1234-1234-123456789abc';
  let detections = 0, transcriptions = 0;
  await withBackend({ REALCHECK_MODE: 'live', REALCHECK_EXTENSION_ID: id, REALITY_DEFENDER_API_KEY: 'private-test-rd', GROQ_API_KEY: 'private-test-groq' }, async (base, root) => {
    const response = await fetch(base + '/api/config', { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const config = await response.json();
    assert.deepEqual(config.sidePanel, { protocol: 1, configured: true, authorized: true });
    assert.equal(config.transcriptionReviewRequired, true);
    assert.doesNotMatch(JSON.stringify(config), /private-test-/);
    assert.equal(detections + transcriptions, 0);
    const preflight = await fetch(base + '/api/analyze', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-file-name, x-request-id',
    } });
    assert.equal(preflight.status, 204); assert.equal(detections + transcriptions, 0);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    const upload = await fetch(base + '/api/analyze', { method: 'POST', body: bytes, headers: {
      Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'audio/wav', 'X-File-Name': 'test.wav', 'X-Request-ID': requestId,
    } });
    assert.equal(upload.status, 200); assert.equal(upload.headers.get('access-control-allow-origin'), origin);
    const body = await upload.json();
    assert.equal(body.fixture, false); assert.equal(body.authenticity.label, 'Unlikely deepfake');
    assert.equal(body.transcription.text, 'Synthetic offline transcript.'); assert.equal(body.transcription.review, 'unverified');
    assert.equal(body.content.status, 'not_evaluated'); assert.deepEqual(body.content.findings, []);
    assert.equal(body.trace.requestId, requestId); assert.equal(body.trace.uploadSha256, hash(bytes));
    assert.equal(body.trace.groqInputSha256, hash(bytes)); assert.equal(body.trace.groqTextSha256, hash(body.transcription.text));
    assert.equal(detections, 1); assert.equal(transcriptions, 1);
    assert.doesNotMatch(JSON.stringify(body), /private-test-/); assert.deepEqual(await readdir(root), []);
    assert.equal((await fetch(base + '/')).status, 200); // Existing website still works.
  }, {
    detect: async (upload, key) => { detections++; assert.equal(key, 'private-test-rd'); assert.equal(hash(upload.bytes), hash(bytes)); return { label: 'Unlikely deepfake' }; },
    transcribe: (upload, key) => createTranscriber()(upload, key, { fetcher: async (_url, init) => {
      transcriptions++; assert.equal(init.headers.Authorization, 'Bearer private-test-groq');
      assert.equal(hash(Buffer.from(await init.body.get('file').arrayBuffer())), hash(bytes));
      return Response.json({ text: 'Synthetic offline transcript.', language: 'english' });
    } }),
  });
});
test('unknown origins and unsafe preflights cannot reach providers or create uploads', async () => {
  const fail = () => assert.fail('unauthorized provider request');
  await withBackend({ REALCHECK_MODE: 'live', REALCHECK_EXTENSION_ID: id }, async (base, root) => {
    for (const untrusted of ['chrome-extension://' + 'b'.repeat(32), 'https://example.com', 'null']) {
      for (const path of ['/api/config', '/api/analyze']) {
        const result = await fetch(base + path, { method: path === '/api/config' ? 'GET' : 'POST', headers: { Origin: untrusted } });
        assert.equal(result.status, 403); assert.equal(result.headers.get('access-control-allow-origin'), null);
      }
    }
    const forbidden = await fetch(base + '/api/analyze', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await readdir(root), []);
  }, { detect: fail, transcribe: fail });
});
test('fixture panel remains explicitly authored and cannot call either provider', async () => {
  const fail = () => assert.fail('fixture called provider');
  await withBackend({ REALCHECK_MODE: 'fixture', REALCHECK_EXTENSION_ID: id }, async base => {
    const result = await fetch(base + '/api/analyze', { method: 'POST', body: wav(), headers: { Origin: origin, 'X-File-Name': 'test.wav', 'Content-Type': 'audio/wav' } });
    const body = await result.json();
    assert.equal(body.fixture, true); assert.equal(body.transcription.review, 'fixture');
    assert.deepEqual(body.content.findings, []); assert.equal(body.trace.groqInputSha256, undefined);
  }, { detect: fail, transcribe: fail });
});
test('missing extension configuration rejects panel requests while preserving the website', async () => {
  await withBackend({ REALCHECK_MODE: 'fixture' }, async base => {
    assert.equal((await fetch(base + '/api/config', { headers: { Origin: origin } })).status, 403);
    assert.equal((await fetch(base + '/api/config')).status, 200);
    assert.equal((await fetch(base + '/')).status, 200);
  });
});
