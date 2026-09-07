import test from 'node:test';
import assert from 'node:assert/strict';
import { detectionReadiness } from '../lib/readiness.mjs';
test('readiness derives from configured key and installed inspected version', () => {
  assert.equal(detectionReadiness('test-only').sdkVersion, '0.1.19');
  assert.equal(detectionReadiness('test-only').verified, true);
  for (const [key, installedVersion, reason] of [
    ['', () => '0.1.19', 'missing_key'],
    ['   ', () => '0.1.19', 'missing_key'],
    ['test-only', () => '0.1.20', 'sdk_version_unverified'],
    ['test-only', () => { throw new Error('absent'); }, 'sdk_missing'],
  ]) {
    const state = detectionReadiness(key, { installedVersion });
    assert.equal(state.verified, false); assert.equal(state.ready, false); assert.equal(state.reason, reason);
  }
});
