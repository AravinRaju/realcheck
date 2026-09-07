import { isAbsolute, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

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
  return { origin, host, port, enabled, stateDir: env.REALCHECK_STATE_DIR,
    daily: integer('REALCHECK_DAILY_LIMIT', 20, 100), hourly: integer('REALCHECK_HOURLY_LIMIT', 5, 20) };
}

// Single-instance global admission budget. Counts attempts before reading media;
// failures also consume budget. No IP addresses, filenames, or media are stored.
export function publicUsage(config, { now = Date.now } = {}) {
  if (!config.origin || !config.enabled) return () => ({ allowed: true });
  if (!config.stateDir || !isAbsolute(config.stateDir)) throw new Error('Hosted live scans require an absolute REALCHECK_STATE_DIR on persistent storage.');
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const path = join(config.stateDir, 'usage.json');
  let entries;
  try { entries = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Usage ledger unavailable.'); entries = []; }
  if (!Array.isArray(entries) || entries.length > 100 || !entries.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid usage ledger.');
  let failed = false;
  return () => {
    if (failed) return { allowed: false, status: 503 };
    const time = now();
    entries = entries.filter(value => value > time - 86400000);
    const hourly = entries.filter(value => value > time - 3600000);
    if (entries.length >= config.daily || hourly.length >= config.hourly) return { allowed: false, status: 429 };
    entries.push(time);
    try {
      writeFileSync(path + '.tmp', JSON.stringify(entries), { mode: 0o600, flush: true });
      renameSync(path + '.tmp', path);
    } catch { failed = true; return { allowed: false, status: 503 }; }
    return { allowed: true };
  };
}
