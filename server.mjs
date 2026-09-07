import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './lib/config.mjs';
import { validateMetadata, withTemporaryUpload, ValidationError } from './lib/media.mjs';
import { analyze } from './lib/analyze.mjs';
import { TRANSCRIPTION_LIVE_VERIFIED } from './lib/providers.mjs';
import { detectionReadiness } from './lib/readiness.mjs';
import { hostingConfig, publicUsage } from './lib/hosting.mjs';
import { budgets } from './lib/budgets.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { configuredExtensionOrigin, extensionApiAccess } from './extension/server-access.mjs';

export const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
};
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/review.mjs', ['public/review.mjs', 'text/javascript; charset=utf-8']],
  ['/lib/rules.mjs', ['lib/rules.mjs', 'text/javascript; charset=utf-8']],
]);
export function createServer(env = process.env, dependencies = {}) {
  let active = 0;
  const mode = env.REALCHECK_MODE || 'fixture';
  if (!['fixture', 'live'].includes(mode)) throw new Error('REALCHECK_MODE must be fixture or live.');
  const extensionOrigin = configuredExtensionOrigin(env.REALCHECK_EXTENSION_ID);
  const hosting = hostingConfig(env);
  const admit = publicUsage({ ...hosting, enabled: hosting.enabled && mode === 'live' });
  const server = http.createServer(async (request, response) => {
    const json = (body, status = 200) => {
      response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json', ...(status >= 400 ? { Connection: 'close' } : {}) });
      response.end(JSON.stringify(body));
    };
    let path;
    try { path = new URL(request.url, 'http://' + (request.headers.host || 'localhost')).pathname; }
    catch { json({ error: 'Invalid request' }, 400); return; }
    const access = extensionApiAccess(request, path, extensionOrigin, hosting.origin);
    if (access.denied) { json({ error: 'Use this website or the configured RealCheck extension.' }, 403); return; }
    for (const [name, value] of Object.entries(access.headers)) response.setHeader(name, value);
    if (access.preflight) { response.writeHead(204, securityHeaders); response.end(); return; }
    if (['GET', 'POST'].includes(request.method) && path === '/api/config') {
      if (request.method === 'POST' && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0)) {
        json({ error: 'Configuration handshake must not contain a body.' }, 400); return;
      }
      const detection = detectionReadiness(env.REALITY_DEFENDER_API_KEY);
      json({ mode, scansEnabled: mode !== 'live' || hosting.enabled, clientRequestTimeoutMs: budgets.clientMs, detectionVerified: detection.verified,
        sidePanel: { protocol: 1, configured: !!extensionOrigin, authorized: access.trusted },
        transcriptionVerified: TRANSCRIPTION_LIVE_VERIFIED,
        transcriptionReviewRequired: true,
        detectionContractVerified: detection.contractInspected, detectionReady: detection.ready,
        detectionEnabled: mode === 'live' && hosting.enabled && detection.ready,
        detectionConfigured: detection.configured, transcriptionConfigured: !!env.GROQ_API_KEY?.trim() }); return;
    }
    if (path === '/api/analyze') {
      if (request.method !== 'POST') { json({ error: 'Method not allowed' }, 405); return; }
      // Origin checks run above, before either website or extension can upload.
      if (mode === 'live' && !hosting.enabled) { json({ error: 'Analysis unavailable', message: 'Live checks are not enabled.' }, 503); return; }
      if (active >= (hosting.origin ? 1 : 3)) { json({ error: 'Analysis unavailable', message: 'The prototype is busy. Try again shortly.' }, 503); return; }
      if (mode === 'live') {
        const admission = admit();
        if (!admission.allowed) { json({ error: 'Analysis unavailable', message: admission.status === 429 ? 'The demo usage limit has been reached. Try later.' : 'Live checks are temporarily unavailable.' }, admission.status); return; }
      }
      active++;
      try {
        let name;
        try { name = decodeURIComponent(request.headers['x-file-name'] || ''); }
        catch { throw new ValidationError('The filename is invalid.'); }
        const length = request.headers['content-length'];
        const metadata = validateMetadata(name, length === undefined ? 1 : Number(length), request.headers['content-type'] || '');
        metadata.expectedSize = length === undefined ? null : Number(length);
        const detectionFixture = request.headers['x-fixture-detection'] || 'unclear';
        const transcriptFixture = request.headers['x-fixture-transcript'] || 'warning';
        if (mode === 'fixture' && (!['likely','unlikely','unclear','unavailable'].includes(detectionFixture) ||
          !['warning','ordinary','nonenglish','empty','unavailable'].includes(transcriptFixture))) throw new ValidationError('Select a listed fixture scenario.');
        const suppliedId = request.headers['x-request-id'];
        const requestId = typeof suppliedId === 'string' && /^[0-9a-f-]{36}$/i.test(suppliedId) ? suppliedId : randomUUID();
        const result = await withTemporaryUpload(request, metadata, async upload => {
          upload.trace = { requestId, uploadSha256: createHash('sha256').update(upload.bytes).digest('hex') };
          const result = await analyze(upload, { mode, keys: env, detectionFixture, transcriptFixture }, dependencies);
          return { ...result, trace: upload.trace };
        },
          dependencies.tempRoot ? { tempRoot: dependencies.tempRoot } : undefined);
        json(result);
      } catch (error) {
        if (error instanceof ValidationError) json({ kind: 'validation', message: error.message }, 400);
        else json({ error: 'Analysis unavailable', message: 'The upload could not be processed. Try again.' }, 503);
      } finally { active--; }
      return;
    }
    const asset = assets.get(path);
    if (!asset || !['GET','HEAD'].includes(request.method)) { json({ error: 'Not found' }, 404); return; }
    try {
      const bytes = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { ...securityHeaders, 'Content-Type': asset[1] });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { json({ error: 'Analysis unavailable' }, 503); }
  });
  // Node requestTimeout bounds receipt of the request, not provider processing.
  server.requestTimeout = budgets.requestReceiveMs; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.NODE_ENV !== 'production') loadLocalEnv();
  const { port, host } = hostingConfig(process.env);
  const server = createServer();
  server.listen(port, host, () => console.log('RealCheck server listening on configured address and port.'));
}
