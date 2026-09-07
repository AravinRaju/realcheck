import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { loadLocalEnv } from '../lib/config.mjs';
import { transcribeAudio } from '../lib/providers.mjs';
import { formats } from '../lib/media.mjs';
const [provider, path] = process.argv.slice(2);
const respond = message => new Promise(resolve => {
  if (process.send) process.send({ provider, ...message }, resolve);
  else resolve();
});
const safeErrors = new Set(['EACCES','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET','network','timeout','invalid_response',
  'missing_key','unauthorized','server_error','invalid_file','upload_failed','not_found','unknown_error','sdk_missing']);
let bytes;
try {
  loadLocalEnv();
  if (provider === 'rd') {
    const key = process.env.REALITY_DEFENDER_API_KEY?.trim();
    if (!key) throw Object.assign(new Error(), { code: 'missing_key' });
    let sdk;
    try { sdk = await import('@realitydefender/realitydefender'); }
    catch { throw Object.assign(new Error(), { code: 'sdk_missing' }); }
    if (typeof sdk.RealityDefender !== 'function') throw Object.assign(new Error(), { code: 'invalid_response' });
    const client = new sdk.RealityDefender({ apiKey: key });
    // Documented API; one detect invocation (one upload). Normal result polling
    // is bounded. There is no application-level retry after an error.
    const result = await client.detect({ filePath: path }, { maxAttempts: 10, pollingInterval: 2000 });
    const status = typeof result?.status === 'string' && /^[A-Z_]{1,40}$/.test(result.status) ? result.status : null;
    if (!status) throw Object.assign(new Error(), { code: 'invalid_response' });
    const fields = Object.fromEntries(Object.entries(result).filter(([name]) => /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(name))
      .map(([name, value]) => [name, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]));
    await respond({ outcome: 'response_received', providerStatus: status, responseFields: fields,
      note: 'Raw SDK status only; no authenticity mapping or threshold applied.', retryAttempted: false });
  } else if (provider === 'groq') {
    bytes = await readFile(path);
    const extension = extname(path).slice(1);
    const result = await transcribeAudio({ bytes, metadata: { ...formats[extension], extension } }, process.env.GROQ_API_KEY?.trim());
    await respond({ outcome: 'succeeded', transcriptCharacters: result.text.length,
      language: typeof result.language === 'string' && /^[a-zA-Z -]{1,40}$/.test(result.language) ? result.language : null, retryAttempted: false });
  } else throw new Error('invalid_provider');
} catch (error) {
  const candidates = [error.cause?.code, error.code];
  const code = candidates.find(code => safeErrors.has(code) || /^http_\d{3}$/.test(code)) || 'provider_error';
  await respond({ outcome: 'failed', error: code, retryAttempted: false });
} finally {
  bytes?.fill(0);
  process.disconnect?.();
  // Stop SDK timers/background polling before the parent removes the temp file.
  process.exit(0);
}
