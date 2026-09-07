import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../server.mjs';
import { wav } from './helpers.mjs';
import { budgets } from '../lib/budgets.mjs';
import { createTranscriber } from '../lib/providers.mjs';
import http from 'node:http';

async function withServer(env, fn, dependencies = {}) {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-http-test-'));
  const server = createServer(env, { tempRoot: root, fixtureDelay: 0, ...dependencies });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await fn('http://127.0.0.1:' + server.address().port, root); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
}
const post = (base, body = wav(), headers = {}) => fetch(base + '/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-File-Name': 'recording.wav', ...headers },
  body, signal: AbortSignal.timeout(3000),
});

test('HTTP rejects inherited formats and oversized metadata using headers alone', async () => {
  await withServer({ REALCHECK_MODE: 'live' }, async (base, root) => {
    for (const name of ['constructor', 'x.__proto__', 'x.png']) {
      const status = await new Promise((resolve, reject) => {
        const request = http.request(base + '/api/analyze', {
          method: 'POST', headers: { 'X-File-Name': name, 'Content-Length': '999999999' },
        }, response => { response.resume(); resolve(response.statusCode); request.destroy(); });
        request.on('error', reject);
        request.setTimeout(2000, () => request.destroy(new Error('Expected rejection before sending a body.')));
        request.flushHeaders(); // No body bytes are ever sent.
      });
      assert.equal(status, 400);
      assert.deepEqual(await readdir(root), []);
    }
  }, { detect: () => assert.fail('provider called before valid upload') });
});
test('HTTP serves the app and config without serving secrets or source files', async () => {
  await withServer({ REALCHECK_MODE: 'fixture', GROQ_API_KEY: 'test-only-private' }, async base => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /RealCheck/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const config = await (await fetch(base + '/api/config')).text();
    assert.ok(!config.includes('test-only-private'));
    assert.equal(JSON.parse(config).clientRequestTimeoutMs, budgets.clientMs);
    for (const path of ['/.env','/.env.example','/.git/config','/lib/providers.mjs','/uploads/recording.wav']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
  });
});

test('HTTP live rate limiting preserves detection and cleans uploads during cooldown', async () => {
  let calls = 0;
  const transcribe = createTranscriber();
  await withServer({ REALCHECK_MODE: 'live', GROQ_API_KEY: 'test-only' }, async (base, root) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await post(base);
      assert.equal(response.status, 200); // Composite response: one provider succeeded.
      const body = await response.json();
      assert.equal(body.fixture, false);
      assert.equal(body.authenticity.label, 'Unclear');
      assert.equal(body.transcription.label, 'Analysis unavailable');
      assert.equal(body.transcription.message, 'Service limit reached; try again later.');
      assert.ok(body.transcription.retryAfterSeconds > 0);
      assert.equal(body.content.status, 'not_evaluated');
      assert.deepEqual(await readdir(root), []);
    }
    assert.equal(calls, 1);
  }, {
    detect: async () => ({ label: 'Unclear' }),
    transcribe: (upload, key) => transcribe(upload, key, {
      fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); },
    }),
  });
});
test('HTTP fixture analysis preserves independent failure states and cleans actual temp files', async () => {
  await withServer({ REALCHECK_MODE: 'fixture' }, async (base, root) => {
    let response = await post(base, wav(), { 'X-Fixture-Detection': 'unavailable', 'X-Fixture-Transcript': 'warning' });
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.fixture, true);
    assert.equal(body.authenticity.label, 'Analysis unavailable');
    assert.equal(body.transcription.status, 'complete');
    assert.equal(body.content.findings.length, 0);
    assert.equal(body.transcription.review, 'fixture');
    assert.deepEqual(await readdir(root), []);
    response = await post(base, wav(), { 'X-Fixture-Detection': 'unlikely', 'X-Fixture-Transcript': 'unavailable' });
    body = await response.json();
    assert.equal(body.authenticity.label, 'Unlikely deepfake');
    assert.equal(body.transcription.label, 'Analysis unavailable');
    assert.equal(body.content.status, 'not_evaluated');
    assert.deepEqual(await readdir(root), []);
  });
});
test('HTTP rejects unsupported files, forged content, invalid scenarios and cross-origin requests', async () => {
  await withServer({ REALCHECK_MODE: 'fixture' }, async (base, root) => {
    assert.equal((await post(base, wav(), { 'X-File-Name': 'video.mp4' })).status, 400);
    assert.equal((await post(base, Buffer.from('not audio'))).status, 400);
    assert.equal((await post(base, wav(), { 'X-Fixture-Detection': 'arbitrary' })).status, 400);
    assert.equal((await post(base, wav(), { Origin: 'https://untrusted.example' })).status, 403);
    assert.deepEqual(await readdir(root), []);
  });
});
test('HTTP live mode with missing keys returns independent unavailability, never requested fixtures', async () => {
  await withServer({ REALCHECK_MODE: 'live' }, async (base, root) => {
    const response = await post(base, wav(), { 'X-Fixture-Detection': 'unlikely', 'X-Fixture-Transcript': 'warning' });
    const body = await response.json();
    assert.equal(body.mode, 'live'); assert.equal(body.fixture, false);
    assert.equal(body.authenticity.label, 'Analysis unavailable');
    assert.equal(body.transcription.label, 'Analysis unavailable');
    assert.equal(body.content.status, 'not_evaluated');
    assert.deepEqual(await readdir(root), []);
  });
});
