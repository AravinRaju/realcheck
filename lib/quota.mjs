import { randomUUID } from 'node:crypto';
import { budgets } from './budgets.mjs';

export const QUOTA_KEY = 'realcheck:quota:v1';
export const LEASE_MS = 120000;
export const STORAGE_TIMEOUT_MS = 5000;
export const EMPTY_LEDGER = JSON.stringify({ v: 1, entries: [], owner: '', until: 0, clock: 0 });

export class QuotaError extends Error {
  constructor(stage, detail = '') {
    super('Quota check failed at ' + stage + (detail ? ' (' + detail + ')' : '') + '.');
    this.name = 'QuotaError';
    this.stage = stage;
  }
}

// Inspect upstream text only to select fixed labels; never retain or print it.
function responseError(status, message, command) {
  const http = 'HTTP ' + status;
  if (status === 401 || /^(?:ERR\s+)?(?:WRONGPASS|NOAUTH)\b/i.test(message)) return new QuotaError('request error', http + '; authentication');
  if (/^(?:ERR\s+)?NOPERM\b/i.test(message)) return new QuotaError('request error', http + '; permissions');
  if (/^(?:ERR\s+)?(?:wrong number of arguments|unknown command|invalid (?:command|json|argument)|syntax error)\b/i.test(message)) return new QuotaError('request error', http + '; command or encoding');
  if (/^(?:ERR\s+)?WRONGTYPE\b/i.test(message)) return new QuotaError('ledger validation', http + '; wrong key type');
  if (['EVAL', 'EVAL_RO'].includes(command)) {
    if (/Error compiling script|compile error|compilation error|syntax error.*(?:user_script|\bline\b)|user_script:\d+.*(?:expected|unexpected)/i.test(message)) return new QuotaError('Lua execution', http + '; compile error');
    if (/Error running script|user_script:\d+|runtime error|Write commands are not allowed from read-only scripts/i.test(message)) return new QuotaError('Lua execution', http + '; runtime error');
  }
  return new QuotaError('request error', http + '; unclassified rejection');
}

export function quotaConfiguration(config) {
  return {
    UPSTASH_REDIS_REST_URL: config.quotaUrl?.trim() ? 'configured' : 'missing',
    UPSTASH_REDIS_REST_TOKEN: config.quotaToken?.trim() && config.quotaToken.trim() !== 'PASTE_YOUR_ACTUAL_TOKEN_HERE' ? 'configured' : 'missing',
  };
}

// One key, one atomic EVAL, one final SET. A write failure cannot leave a
// separately acquired lock or partially updated quota. Never expire this key.
// Redis TIME avoids per-process clock skew. No client supplies a timestamp.
export const QUOTA_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  if ARGV[1] == 'check' then return 404 end
  return 503
end
if #raw > 8192 then return 503 end
local ok, s = pcall(cjson.decode, raw)
local function integer(n) return type(n) == 'number' and n >= 0 and n < 9007199254740991 and n == math.floor(n) end
if not ok or type(s) ~= 'table' or s.v ~= 1 or type(s.entries) ~= 'table' or
   type(s.owner) ~= 'string' or (#s.owner ~= 0 and #s.owner ~= 36) or
   not integer(s["until"]) or not integer(s.clock) then return 503 end
if (s.owner == '' and s["until"] ~= 0) or (s.owner ~= '' and s["until"] == 0) then return 503 end
local count = 0
for k, t in pairs(s.entries) do
  if not integer(k) or k < 1 or not integer(t) or t > s.clock then return 503 end
  count = count + 1
end
if count > 20 or count ~= #s.entries then return 503 end
local tm = redis.call('TIME')
local now = tonumber(tm[1]) * 1000 + math.floor(tonumber(tm[2]) / 1000)
if now < s.clock or redis.call('PTTL', KEYS[1]) ~= -1 then return 503 end
local op = ARGV[1]
if op == 'check' then return 200 end
if op == 'guard' then
  if s.owner == ARGV[2] and s["until"] - now >= tonumber(ARGV[3]) then return 200 end
  return 503
end
if op == 'release' then
  if s.owner ~= ARGV[2] then return 503 end
  s.owner = ''; s["until"] = 0
elseif op == 'admit' then
  local hourly, daily = tonumber(ARGV[3]), tonumber(ARGV[4])
  if not integer(hourly) or hourly < 1 or hourly > 5 or not integer(daily) or daily < 1 or daily > 20 or #ARGV[2] ~= 36 then return 503 end
  if s["until"] > now then return 503 end
  local entries, recent = {}, 0
  for _, t in ipairs(s.entries) do
    if t > now - 86400000 then table.insert(entries, t) end
    if t > now - 3600000 then recent = recent + 1 end
  end
  if #entries >= daily or recent >= hourly then return 429 end
  table.insert(entries, now)
  s.entries = entries; s.owner = ARGV[2]; s["until"] = now + ${LEASE_MS}
else return 503 end
s.clock = now
redis.call('SET', KEYS[1], cjson.encode(s))
return 200
`;

export function createQuotaStore(config, { fetcher = fetch, key = QUOTA_KEY, diagnostics = false } = {}) {
  let url;
  try {
    url = new URL(config.quotaUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/.test(url.hostname) ||
        url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        quotaConfiguration(config).UPSTASH_REDIS_REST_TOKEN === 'missing') url = null;
  } catch { url = null; }
  const command = async args => {
    if (!url) throw new QuotaError('configuration');
    let response;
    try {
      response = await fetcher(url.origin, { method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + config.quotaToken.trim(), 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) });
    } catch (error) {
      const code = error?.cause?.code || error?.code || error?.name;
      const safe = ['EACCES', 'EPERM', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'TimeoutError', 'AbortError'].includes(code) ? code : '';
      throw new QuotaError('network', safe);
    }
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new QuotaError('network');
      if (!response.ok) throw responseError(response.status, '', args[0]);
      throw new QuotaError('request error', 'invalid response encoding');
    }
    if (!response.ok || data?.error) throw responseError(response.status, typeof data?.error === 'string' ? data.error : '', args[0]);
    if (!data || !Object.hasOwn(data, 'result')) throw new QuotaError('ledger validation');
    return data.result;
  };
  const run = async (...args) => {
    try {
      const result = await command(['EVAL', QUOTA_SCRIPT, '1', key, ...args.map(String)]);
      if (![200, 404, 429, 503].includes(result)) throw new QuotaError('ledger validation');
      return result;
    }
    catch (error) { if (diagnostics) throw error; return 503; }
  };
  return {
    command, // Private CLI verification only; never exposed as an HTTP route.
    assertConfigured() { if (!url) throw new QuotaError('configuration'); },
    ready: async () => await run('check') === 200,
    async admit() {
      const owner = randomUUID();
      const status = await run('admit', owner, config.hourly, config.daily);
      return status === 200 ? { allowed: true, owner } : { allowed: false, status: status === 429 ? 429 : 503 };
    },
    // Check ownership again after upload/validation, before any provider work.
    guard: async owner => await run('guard', owner, budgets.workerMs + STORAGE_TIMEOUT_MS + 10000) === 200,
    release: async owner => await run('release', owner) === 200,
  };
}
