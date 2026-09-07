import { stat, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMetadata, validateBytes, withTemporaryUpload } from './media.mjs';
import { budgets } from './budgets.mjs';

export async function withTestFile(path, provider, action) {
  const resolved = resolve(path);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('not_a_file');
  const metadata = validateMetadata(basename(resolved), info.size);
  if (provider === 'groq' && metadata.kind !== 'audio') throw new Error('audio_required');
  let bytes;
  try {
    bytes = await readFile(resolved);
    validateMetadata(basename(resolved), bytes.length);
    validateBytes(bytes, metadata);
    // SDK receives a temporary copy, never the user's original recording.
    return await withTemporaryUpload(Readable.from([bytes]), { ...metadata, expectedSize: bytes.length }, action);
  } finally { bytes?.fill(0); }
}

export function runProviderWorker(provider, upload, { timeoutMs = budgets.workerMs, launch = fork } = {}) {
  return new Promise(resolveResult => {
    // Child stdout/stderr are not forwarded: SDK diagnostics must not expose
    // credentials, signed URLs, headers, or the transcript.
    const child = launch(fileURLToPath(new URL('../scripts/provider-worker.mjs', import.meta.url)),
      [provider, upload.filePath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
    let result, settled = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('message', message => {
      if (message && typeof message === 'object' && message.provider === provider && ['response_received','succeeded','failed'].includes(message.outcome)) result = message;
    });
    child.on('error', () => { result = { provider, outcome: 'failed', error: 'worker_start_failed' }; });
    child.on('close', () => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolveResult(timedOut ? { provider, outcome: 'failed', error: 'timeout', retryAttempted: false } :
        result || { provider, outcome: 'failed', error: 'worker_failed', retryAttempted: false });
    });
  });
}
