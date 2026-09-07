import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './lib/config.mjs';
import { validateMetadata, withTemporaryUpload, ValidationError } from './lib/media.mjs';
import { analyze } from './lib/analyze.mjs';
import { DETECTION_CONTRACT_VERIFIED } from './lib/providers.mjs';
import { budgets } from './lib/budgets.mjs';

export const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cache-Control': 'no-store',
};
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
]);
export function createServer(env = process.env, dependencies = {}) {
  let active = 0;
  const mode = env.REALCHECK_MODE || 'fixture';
  if (!['fixture', 'live'].includes(mode)) throw new Error('REALCHECK_MODE must be fixture or live.');
  const server = http.createServer(async (request, response) => {
    const json = (body, status = 200) => {
      response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json', ...(status >= 400 ? { Connection: 'close' } : {}) });
      response.end(JSON.stringify(body));
    };
    let path;
    try { path = new URL(request.url, 'http://' + (request.headers.host || 'localhost')).pathname; }
    catch { json({ error: 'Invalid request' }, 400); return; }
    if (request.method === 'GET' && path === '/api/config') {
      json({ mode, clientRequestTimeoutMs: budgets.clientMs, detectionVerified: DETECTION_CONTRACT_VERIFIED,
        detectionConfigured: !!env.REALITY_DEFENDER_API_KEY, transcriptionConfigured: !!env.GROQ_API_KEY }); return;
    }
    if (path === '/api/analyze') {
      if (request.method !== 'POST') { json({ error: 'Method not allowed' }, 405); return; }
      const expectedOrigin = 'http://' + request.headers.host;
      if ((request.headers.origin && request.headers.origin !== expectedOrigin) || request.headers['sec-fetch-site'] === 'cross-site') {
        json({ error: 'Upload from this website only.' }, 403); return;
      }
      if (active >= 3) { json({ error: 'Analysis unavailable', message: 'The prototype is busy. Try again shortly.' }, 503); return; }
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
        const result = await withTemporaryUpload(request, metadata, upload =>
          analyze(upload, { mode, keys: env, detectionFixture, transcriptFixture }, dependencies),
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
  loadLocalEnv();
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/'));
}
