import { createQuotaStore } from './quota.mjs';

export function hostingConfig(env) {
  const origin = env.REALCHECK_PUBLIC_ORIGIN || null;
  if (origin) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('Invalid REALCHECK_PUBLIC_ORIGIN.'); }
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('REALCHECK_PUBLIC_ORIGIN must be an exact HTTPS origin.');
  }
  if (env.NODE_ENV === 'production' && !origin) throw new Error('Production requires REALCHECK_PUBLIC_ORIGIN.');
  const host = env.HOST || (origin ? '0.0.0.0' : '127.0.0.1');
  if (!origin && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Non-loopback listening requires REALCHECK_PUBLIC_ORIGIN.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const enabled = !origin || env.REALCHECK_PUBLIC_LIVE_ENABLED === 'true';
  const integer = (key, fallback, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid ' + key + '.');
    return value;
  };
  return { origin, host, port, enabled,
    quotaUrl: env.UPSTASH_REDIS_REST_URL, quotaToken: env.UPSTASH_REDIS_REST_TOKEN,
    daily: integer('REALCHECK_DAILY_LIMIT', 20, 20), hourly: integer('REALCHECK_HOURLY_LIMIT', 5, 5) };
}

export function publicUsage(config, options) {
  if (!config.origin) return {
    ready: async () => true,
    admit: async () => ({ allowed: true }),
    guard: async () => true,
    release: async () => true,
  };
  return createQuotaStore(config, options);
}
