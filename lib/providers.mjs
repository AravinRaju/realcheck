export class ProviderError extends Error {
  constructor(code) { super('Analysis unavailable'); this.code = code; }
}
export const DETECTION_CONTRACT_VERIFIED = false;

// Hard gate: no installed SDK was available and no real scan completed.
// An environment flag must not convert a fixture into a live result.
export async function detectManipulation(_upload, key) {
  if (!key) throw new ProviderError('missing_key');
  throw new ProviderError('sdk_contract_unverified');
}

// Direct documented REST integration; no Groq SDK is installed or assumed.
export async function transcribeAudio(upload, key, { fetcher = fetch, timeoutMs = 25000 } = {}) {
  if (!key) throw new ProviderError('missing_key');
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
    throw new ProviderError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network');
  }
  if (!response.ok) throw new ProviderError('http_' + response.status);
  let body;
  try { body = await response.json(); } catch { throw new ProviderError('invalid_response'); }
  if (!body || typeof body.text !== 'string' || body.text.length > 100000 ||
      (body.language != null && typeof body.language !== 'string')) throw new ProviderError('invalid_response');
  return { text: body.text, language: body.language || null };
}

