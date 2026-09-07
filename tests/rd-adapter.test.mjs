import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mapRealityDefenderResult } from '../lib/rd-result.mjs';
import { detectManipulation } from '../lib/providers.mjs';
const require = createRequire(import.meta.url);
const sdkDirectory = dirname(require.resolve('@realitydefender/realitydefender'));
const { formatResult, getDetectionResult } = require(join(sdkDirectory, 'detection/results.js'));
const { RealityDefender, RealityDefenderError } = require('@realitydefender/realitydefender');
const raw = status => ({ requestId: 'test-id', overallStatus: 'ANALYZING',
  resultsSummary: { status, metadata: { finalScore: 99 } }, models: [] });

test('installed SDK and dependency pin match inspected version', () => {
  assert.equal(require(join(sdkDirectory, '../package.json')).version, '0.1.19');
  assert.equal(require('../package.json').dependencies['@realitydefender/realitydefender'], '0.1.19');
  assert.equal(require('../package-lock.json').packages['node_modules/@realitydefender/realitydefender'].version, '0.1.19');
});
test('actual SDK normalizes FAKE and adapter uses overall status regardless of score', () => {
  for (const [status, label] of [['FAKE', 'Likely deepfake'], ['MANIPULATED', 'Likely deepfake'], ['AUTHENTIC', 'Unlikely deepfake']]) {
    for (const score of [0, 1, null]) {
      const result = formatResult(raw(status));
      result.score = score;
      result.models = [{ name: 'opposing-model', status: 'MANIPULATED', score: 1 }];
      result.heatmaps = { private: 'https://example.invalid/private-signed-url' };
      assert.deepEqual(mapRealityDefenderResult(result), { detection: { label } });
    }
  }
});
test('pending, errors, unknown statuses and malformed results never become verdicts', () => {
  for (const status of ['ANALYZING', 'DOWNLOADING']) {
    assert.deepEqual(mapRealityDefenderResult(formatResult(raw(status))), { error: 'processing' });
  }
  for (const status of ['ERROR', 'FAILED', 'NOT_APPLICABLE', 'UNCERTAIN', 'SUSPICIOUS', 'UNABLE_TO_EVALUATE', 'FAKE', 'future-status', '']) {
    assert.equal(mapRealityDefenderResult({ ...formatResult(raw('AUTHENTIC')), status }).error, 'unsupported_status');
  }
  const valid = formatResult(raw('AUTHENTIC'));
  for (const value of [null, [], {}, { status: 'AUTHENTIC' }, { ...valid, requestId: '' },
    { ...valid, score: NaN }, { ...valid, models: [null] }, { ...valid, heatmaps: [] },
    { ...valid, heatmaps: { secret: 42 } }]) {
    assert.equal(mapRealityDefenderResult(value).error, 'invalid_response');
  }
});
test('actual SDK polls pending results within limit and stops on first error', async () => {
  let calls = 0;
  const result = await getDetectionResult({ get: async () => { calls++; return raw('DOWNLOADING'); } },
    'test-id', { maxAttempts: 3, pollingInterval: 0 });
  assert.equal(calls, 3);
  assert.equal(mapRealityDefenderResult(result).error, 'processing');
  calls = 0;
  await assert.rejects(getDetectionResult({ get: async () => {
    calls++; throw new RealityDefenderError('private transport details', 'unknown_error');
  } }, 'test-id', { maxAttempts: 10, pollingInterval: 0 }));
  assert.equal(calls, 1);
});
test('actual SDK detect stops at the first upload request failure without polling', async () => {
  const sdk = new RealityDefender({ apiKey: 'test-only' });
  let calls = 0;
  // Replace the internal transport only in this test; no sockets are opened.
  sdk.client = {
    post: async () => { calls++; throw new RealityDefenderError('private network details', 'unknown_error'); },
    put: () => assert.fail('uploaded after failed presign request'),
    get: () => assert.fail('polled after failed presign request'),
  };
  await assert.rejects(sdk.detect({ filePath: 'temporary.wav' }, { maxAttempts: 10, pollingInterval: 0 }), { code: 'unknown_error' });
  assert.equal(calls, 1);
});
test('adapter runs once, passes configured key privately, and returns only a label', async () => {
  let calls = 0;
  const result = await detectManipulation({ filePath: 'temporary.wav' }, 'test-only', {
    worker: async (provider, upload, options) => {
      calls++; assert.equal(provider, 'rd'); assert.equal(upload.filePath, 'temporary.wav');
      assert.equal(options.key, 'test-only');
      return { outcome: 'response_received', detection: { label: 'Likely deepfake' } };
    },
  });
  assert.equal(calls, 1); assert.deepEqual(result, { label: 'Likely deepfake' });
});
test('adapter preserves failures without retry or leaking worker details', async () => {
  for (const error of ['timeout', 'processing', 'unsupported_status', 'unauthorized', 'server_error', 'unknown_error']) {
    let calls = 0;
    await assert.rejects(detectManipulation({ filePath: 'temporary.wav' }, 'test-only', {
      worker: async () => { calls++; return { outcome: 'failed', error, message: 'secret' }; },
    }), failure => failure.code === error && failure.message === 'Analysis unavailable');
    assert.equal(calls, 1);
  }
  await assert.rejects(detectManipulation({}, '', { worker: () => assert.fail('worker called') }), { code: 'missing_key' });
});
