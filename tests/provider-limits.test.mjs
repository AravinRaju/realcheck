import test from 'node:test';
import assert from 'node:assert/strict';
import { budgets } from '../lib/budgets.mjs';
import { createTranscriber, parseRetryAfter, providerFailure, ProviderError, SERVICE_LIMIT_MESSAGE, logProviderFailure } from '../lib/providers.mjs';
import { analyze } from '../lib/analyze.mjs';
import { audioUpload } from './helpers.mjs';
import http from 'node:http';
import { once } from 'node:events';

test('Groq failures log bounded stages/status/timeouts while preserving detection with no retry', async () => {
  const cases = [
    ...[400, 401, 413, 429, 500].map(status => ({ fetcher: async () => new Response('private raw response', { status }), code: 'http_' + status, stage: 'response_headers', httpStatus: status, timeoutCode: null })),
    { fetcher: async () => { throw new DOMException('private timeout', 'TimeoutError'); }, code: 'timeout', stage: 'request', httpStatus: null, timeoutCode: 'TimeoutError' },
    { fetcher: async () => { throw new TypeError('private network', { cause: { code: 'EACCES' } }); }, code: 'network', stage: 'request', httpStatus: null, timeoutCode: null },
    { fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('private body', 'AbortError'); } }), code: 'timeout', stage: 'response_body', httpStatus: 200, timeoutCode: 'AbortError' },
    { fetcher: async () => new Response('private malformed JSON'), code: 'invalid_response', stage: 'response_body', httpStatus: 200, timeoutCode: null },
    { fetcher: async () => Response.json({ text: { secret: 'private transcript' } }), code: 'invalid_response', stage: 'response_validation', httpStatus: 200, timeoutCode: null },
  ];
  for (const expected of cases) {
    const logs = []; let calls = 0;
    const result = await analyze(audioUpload(), { mode: 'live', keys: { GROQ_API_KEY: 'private test credential' } }, {
      detect: async () => ({ label: 'Unlikely deepfake' }),
      transcribe: (upload, key) => createTranscriber()(upload, key, { fetcher: (...args) => { calls++; return expected.fetcher(...args); } }),
      providerLogger: line => logs.push(line),
    });
    assert.equal(calls, 1); assert.equal(logs.length, 1);
    const event = JSON.parse(logs[0]);
    assert.equal(event.provider, 'groq'); assert.equal(event.event, 'provider_failure');
    for (const name of ['code', 'stage', 'httpStatus', 'timeoutCode']) assert.equal(event[name], expected[name]);
    assert.doesNotMatch(logs[0], /private|Bearer|audio|transcript|https:/);
    assert.equal(result.transcription.code, expected.code);
    assert.equal(result.authenticity.label, 'Unlikely deepfake');
    assert.equal(result.content.status, 'not_evaluated');
  }
});

test('diagnostic fields and API codes are allowlisted; logging failure cannot erase results', async () => {
  const logs = [];
  const error = new ProviderError('private credential', { stage: 'private transcript', httpStatus: 'private header', timeoutCode: 'private audio', networkCode: 'private url' });
  logProviderFailure('private provider', error, line => logs.push(line));
  assert.deepEqual(JSON.parse(logs[0]), { event: 'provider_failure', provider: 'unknown', code: 'internal', stage: 'unknown', httpStatus: null, timeoutCode: null, networkCode: null });
  assert.equal(providerFailure(error).code, 'internal');
  const result = await analyze(audioUpload(), { mode: 'live' }, {
    detect: async () => { throw new ProviderError('timeout', { stage: 'worker', timeoutCode: 'worker_timeout' }); },
    transcribe: async () => ({ text: 'Synthetic successful transcript', language: 'english' }),
    providerLogger: () => { throw new Error('logger unavailable'); },
  });
  assert.equal(result.authenticity.code, 'timeout'); assert.equal(result.transcription.status, 'complete');
  assert.equal(result.content.status, 'not_evaluated');
  let fixtureLogs = 0;
  await analyze(audioUpload(), { mode: 'fixture' }, { fixtureDelay: 0, providerLogger: () => { fixtureLogs++; } });
  assert.equal(fixtureLogs, 0);
});

test('client budget covers upload, parallel provider ceiling, and response margin', () => {
  assert.ok(budgets.requestReceiveMs >= budgets.uploadMs);
  assert.ok(budgets.workerMs > budgets.providerMs);
  assert.ok(budgets.clientMs >= budgets.requestReceiveMs + budgets.workerMs + 5000);
  assert.ok(budgets.clientMs <= 120000);
});

test('Retry-After accepts seconds and HTTP dates, not malformed values', () => {
  const now = Date.parse('Mon, 07 Sep 2026 06:00:00 GMT');
  assert.equal(parseRetryAfter('120', now), 120);
  assert.equal(parseRetryAfter('Mon, 07 Sep 2026 06:00:30 GMT', now), 30);
  assert.equal(parseRetryAfter('Mon, 07 Sep 2026 05:59:00 GMT', now), 0);
  for (const value of [null, '', '-1', '1.5', 'later', 'Infinity', '999999999999999999999999']) {
    assert.equal(parseRetryAfter(value, now), null);
  }
});

test('Groq 429 is unavailable, never quota exhaustion; respects cooldown without retries', async () => {
  let now = 1000, calls = 0;
  const transcribe = createTranscriber({ now: () => now });
  const fetcher = async () => {
    calls++;
    return new Response('private provider details', { status: 429, headers: { 'Retry-After': '30' } });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(transcribe(audioUpload(), 'test-only', { fetcher }), error => {
      const failure = providerFailure(error);
      assert.equal(failure.label, 'Analysis unavailable');
      assert.equal(failure.message, SERVICE_LIMIT_MESSAGE);
      assert.equal(failure.retryAfterSeconds, 30);
      assert.doesNotMatch(JSON.stringify(failure), /quota|private/);
      return true;
    });
  }
  assert.equal(calls, 1);
  now += 30000;
  const result = await transcribe(audioUpload(), 'test-only', {
    fetcher: async () => { calls++; return Response.json({ text: 'Hello', language: 'english' }); },
  });
  assert.equal(result.text, 'Hello'); assert.equal(calls, 2);
});

test('429 without Retry-After does not invent a delay or automatically retry', async () => {
  let calls = 0;
  await assert.rejects(createTranscriber()(audioUpload(), 'test-only', {
    fetcher: async () => { calls++; return new Response('', { status: 429 }); },
  }), error => {
    assert.equal(providerFailure(error).retryAfterSeconds, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test('rate-limit details remain independent in both directions', async () => {
  for (const limited of ['detect', 'transcribe']) {
    const providers = {
      detect: async () => ({ label: 'Unclear' }),
      transcribe: async () => ({ text: 'Hello', language: 'english' }),
    };
    providers[limited] = async () => { throw new ProviderError('http_429', { retryAfterSeconds: 15 }); };
    const result = await analyze(audioUpload(), { mode: 'live' }, providers);
    const failed = limited === 'detect' ? result.authenticity : result.transcription;
    const succeeded = limited === 'detect' ? result.transcription : result.authenticity;
    assert.equal(failed.message, SERVICE_LIMIT_MESSAGE);
    assert.equal(failed.retryAfterSeconds, 15);
    assert.equal(succeeded.status, 'complete');
    assert.equal(result.fixture, false);
  }
});

test('missing, malformed, raw processing and raw failure results never become Unclear', async () => {
  // Adapter-boundary checks only, NOT verification of an unavailable SDK schema.
  for (const value of [null, {}, { status: 'PROCESSING' }, { status: 'FAILED' }, { label: 'FAKE' },
    { label: 'Unclear', status: 'FAILED' }, { label: 'Unlikely deepfake', score: 0.1 }]) {
    const result = await analyze({ metadata: { kind: 'image' } }, { mode: 'live' }, { detect: async () => value });
    assert.equal(result.authenticity.label, 'Analysis unavailable');
    assert.equal(result.authenticity.code, 'invalid_response');
  }
});

test('network diagnostic preserves only allowlisted errno, never the original message', async () => {
  await assert.rejects(createTranscriber()(audioUpload(), 'test-only', {
    fetcher: async () => { throw new TypeError('private error', { cause: { code: 'EACCES' } }); },
  }), error => {
    assert.equal(error.code, 'network'); assert.equal(error.networkCode, 'EACCES');
    assert.doesNotMatch(JSON.stringify(providerFailure(error)), /private|EACCES/);
    return true;
  });
});

test('provider deadline also covers receiving the response body', async () => {
  await assert.rejects(createTranscriber()(audioUpload(), 'test-only', {
    fetcher: async () => ({ ok: true, json: async () => { throw new DOMException('timeout', 'AbortError'); } }),
  }), error => error.code === 'timeout');
});

test('real fetch aborts a stalled local response body at the provider deadline', async () => {
  // Local test transport only. No provider request, media, or credits.
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"text":');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await assert.rejects(createTranscriber()(audioUpload(), 'test-only', {
      timeoutMs: 100,
      fetcher: (_url, init) => fetch('http://127.0.0.1:' + server.address().port, {
        method: 'GET', signal: init.signal,
      }),
    }), error => error.code === 'timeout');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
