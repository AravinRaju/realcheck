// Backend-only origin policy. No provider credentials are exposed to the panel.
export function configuredExtensionOrigin(value = '') {
  const id = value.trim();
  if (!id) return null;
  if (!/^[a-p]{32}$/.test(id)) throw new Error('REALCHECK_EXTENSION_ID must be one 32-letter Chrome extension ID.');
  return 'chrome-extension://' + id;
}
const allowedHeaders = new Set(['content-type', 'x-file-name', 'x-request-id', 'x-fixture-detection', 'x-fixture-transcript']);
export function extensionApiAccess(request, path, extensionOrigin, websiteOrigin = null) {
  if (!['/api/config', '/api/analyze'].includes(path)) return { trusted: false, headers: {} };
  const origin = request.headers.origin;
  const trusted = !!extensionOrigin && origin === extensionOrigin;
  // Config GET remains available to the website/terminal, but cannot authorize
  // a panel without Origin. The panel's POST handshake must authenticate its
  // exact browser-supplied extension origin, even if Sec-Fetch-Site is absent.
  if (path === '/api/config' && request.method === 'POST' && !trusted) {
    return { trusted: false, headers: {}, denied: true };
  }
  if (!trusted) {
    const denied = (websiteOrigin && path === '/api/analyze' && origin !== websiteOrigin) || (origin && origin !== (websiteOrigin || 'http://' + request.headers.host)) || request.headers['sec-fetch-site'] === 'cross-site' || request.method === 'OPTIONS';
    return { trusted: false, headers: {}, denied: !!denied };
  }
  const headers = { 'Access-Control-Allow-Origin': extensionOrigin, Vary: 'Origin' };
  if (request.method !== 'OPTIONS') return { trusted, headers };
  const method = request.headers['access-control-request-method'];
  const requestedHeaders = (request.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const methods = path === '/api/config' ? ['GET', 'POST'] : ['POST'];
  if (!methods.includes(method) || requestedHeaders.some(name => !allowedHeaders.has(name))) {
    return { trusted, headers: {}, denied: true };
  }
  return { trusted, preflight: true, headers: { ...headers,
    'Access-Control-Allow-Methods': method,
    'Access-Control-Allow-Headers': [...allowedHeaders].join(', '),
    ...(request.headers['access-control-request-private-network'] === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
  } };
}
