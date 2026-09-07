import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { withTestFile, runProviderWorker } from '../lib/live-test.mjs';
import { wav } from './helpers.mjs';

test('live test uses a temporary copy, preserves original, and cleans after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'realcheck-script-test-'));
  const original = join(directory, 'recording.wav');
  const bytes = wav();
  let copiedPath;
  try {
    await writeFile(original, bytes);
    await assert.rejects(withTestFile(original, 'rd', async upload => {
      copiedPath = upload.filePath;
      assert.notEqual(copiedPath, original);
      assert.deepEqual(upload.bytes, bytes);
      throw new Error('network failure');
    }));
    assert.deepEqual(await readFile(original), bytes);
    await assert.rejects(access(copiedPath));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('worker timeout kills execution once and never retries', async () => {
  let starts = 0, kills = 0;
  const result = await runProviderWorker('rd', { filePath: 'test.wav' }, {
    timeoutMs: 5,
    key: 'test-only-worker-key',
    launch: (_path, args, options) => {
      starts++;
      assert.deepEqual(args, ['rd','test.wav']);
      assert.deepEqual(options.stdio, ['ignore','ignore','ignore','ipc']);
      assert.equal(options.env.REALITY_DEFENDER_API_KEY, 'test-only-worker-key');
      const child = new EventEmitter();
      child.kill = () => { kills++; queueMicrotask(() => child.emit('close', null)); };
      return child;
    },
  });
  assert.equal(starts, 1); assert.equal(kills, 1);
  assert.equal(result.error, 'timeout'); assert.equal(result.retryAttempted, false);
});
test('worker error response remains a failure without fallback or retry', async () => {
  let starts = 0;
  const result = await runProviderWorker('groq', { filePath: 'test.wav' }, {
    launch: () => {
      starts++;
      const child = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.emit('message', { provider: 'groq', outcome: 'failed', error: 'network', retryAttempted: false });
        child.emit('close', 0);
      });
      return child;
    },
  });
  assert.equal(starts, 1); assert.equal(result.error, 'network');
});
