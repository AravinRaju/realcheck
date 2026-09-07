export const backendOrigin = 'http://127.0.0.1:3001';
export function validateBackendOrigin(value) {
  if (!['http://127.0.0.1:3001', 'https://realchecknow.xyz'].includes(value)) throw new TypeError('Unsupported RealCheck backend origin.');
  return value;
}
const routes = new Map([['/api/config', 'GET'], ['/api/analyze', 'POST']]);

export class PanelConnectionError extends Error {
  constructor(code, message, status) { super(message); this.name = 'PanelConnectionError'; this.code = code; this.status = status; }
}

// Used only by the packaged panel. The website keeps same-origin requests.
export function createPanelFetch(fetcher = globalThis.fetch.bind(globalThis), origin = backendOrigin) {
  validateBackendOrigin(origin);
  return (path, init = {}) => {
    if (!routes.has(path) || (init.method || 'GET').toUpperCase() !== routes.get(path)) {
      throw new TypeError('Unsupported RealCheck request.');
    }
    const handshake = path === '/api/config';
    if (handshake && init.body != null) throw new TypeError('Configuration handshake must not contain media.');
    // A privileged extension GET may omit Origin. Use a body-free POST for
    // authorization: the browser supplies Origin; never spoof it or trust an ID header.
    return (async () => {
      let response;
      try {
        response = await fetcher(origin + path, { ...init, method: 'POST',
          credentials: 'omit', redirect: 'error', cache: 'no-store', mode: 'cors' });
      } catch {
        throw new PanelConnectionError('panel_transport', 'Panel connection failed before receiving an HTTP response.');
      }
      if (!handshake) return response;
      if (!response.ok) throw new PanelConnectionError('panel_http', 'Panel configuration handshake failed with HTTP ' + response.status + '.', response.status);
      let config;
      try { config = await response.clone().json(); }
      catch { throw new PanelConnectionError('panel_json', 'Backend configuration is not valid JSON.'); }
      if (config?.sidePanel?.protocol !== 1) throw new PanelConnectionError('panel_schema', 'Backend configuration lacks the supported side-panel protocol.');
      if (config.sidePanel.configured !== true) throw new PanelConnectionError('panel_unconfigured', 'Backend has no configured extension ID.');
      if (config.sidePanel.authorized !== true) throw new PanelConnectionError('panel_origin', 'Backend did not authorize the exact extension Origin.');
      return response;
    })();
  };
}
