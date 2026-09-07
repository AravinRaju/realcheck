import { budgets } from './budgets.mjs';
import { parseTranscript } from './results.mjs';

export class ProviderError extends Error {
  constructor(code, details = {}) {
    super('Analysis unavailable'); this.code = code;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.networkCode = details.networkCode ?? null;
  }
}
export const SERVICE_LIMIT_MESSAGE = 'Service limit reached; try again later.';
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  // HTTP delay-seconds or IMF-fixdate; do not interpret arbitrary numeric dates.
  const seconds = /^\d+$/.test(input) ? Number(input) :
    /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(input)
      ? Math.max(0, Math.ceil((Date.parse(input) - now) / 1000)) : NaN;
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= (Number.MAX_SAFE_INTEGER - now) / 1000 ? seconds : null;
}

export function providerFailure(error) {
  const result = { status: 'unavailable', label: 'Analysis unavailable', code: error instanceof ProviderError ? error.code : 'internal' };
  if (result.code === 'http_429') {
    result.message = SERVICE_LIMIT_MESSAGE;
    if (Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0) result.retryAfterSeconds = error.retryAfterSeconds;
  }
  return result;
}
export const DETECTION_CONTRACT_VERIFIED = false;

// Hard gate: no installed SDK was available and no real scan completed.
// An environment flag must not convert a fixture into a live result.
export async function detectManipulation(_upload, key) {
  if (!key) throw new ProviderError('missing_key');
  throw new ProviderError('sdk_contract_unverified');
}

// Direct documented REST integration; no Groq SDK is installed or assumed.
export function createTranscriber({ now = Date.now } = {}) {
  // Single-server cooldown, not a retry queue. A later user request before the
  // deadline fails locally without sending the audio again. No keys are stored.
  let retryAt = 0;
  return async function transcribeAudio(upload, key, { fetcher = fetch, timeoutMs = budgets.providerMs } = {}) {
    if (!key) throw new ProviderError('missing_key');
    if (now() < retryAt) throw new ProviderError('http_429', { retryAfterSeconds: Math.ceil((retryAt - now()) / 1000) });
    const form = new FormData();
    form.set('file', new Blob([upload.bytes], { type: upload.metadata.mime }), 'audio.' + upload.metadata.extension);
    form.set('model', 'whisper-large-v3-turbo');
    form.set('response_format', 'verbose_json');
    form.set('temperature', '0');
    // Do not force English: preserve the spoken language and skip English rules
    // when the detected language is non-English or missing.
    let response;
    try {
      response = await fetcher('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form,
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const networkCode = [error.cause?.code, error.code].find(code => ['EACCES','EPERM','ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET'].includes(code));
      throw new ProviderError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network', { networkCode });
    }
    if (!response.ok) {
      const retryAfterSeconds = response.status === 429 ? parseRetryAfter(response.headers.get('retry-after'), now()) : null;
      if (retryAfterSeconds !== null) retryAt = Math.max(retryAt, now() + retryAfterSeconds * 1000);
      // Never log or surface raw error bodies (which may contain private data).
      try { await response.body?.cancel(); } catch { /* Preserve the known HTTP failure. */ }
      throw new ProviderError('http_' + response.status, { retryAfterSeconds });
    }
    let body;
    try { body = await response.json(); } catch (error) {
      throw new ProviderError(['TimeoutError','AbortError'].includes(error.name) ? 'timeout' : 'invalid_response');
    }
    const transcript = parseTranscript(body);
    if (!transcript) throw new ProviderError('invalid_response');
    return transcript;
  };
}
export const transcribeAudio = createTranscriber();
