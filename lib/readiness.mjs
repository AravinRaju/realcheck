import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);

export const inspectedSdkVersion = '0.1.19';
// User-reported live result for this exact version, not a blanket override.
const userVerifiedSdkVersion = '0.1.19';
export function detectionReadiness(key, { installedVersion = () => {
  const entry = require.resolve('@realitydefender/realitydefender');
  if (typeof require('@realitydefender/realitydefender').RealityDefender !== 'function') throw new Error('SDK entry unavailable');
  return require(join(dirname(entry), '../package.json')).version;
} } = {}) {
  let sdkVersion = null;
  try { sdkVersion = installedVersion(); } catch { /* Absent SDK stays unavailable. */ }
  const configured = typeof key === 'string' && !!key.trim();
  const contractInspected = sdkVersion === inspectedSdkVersion;
  return { sdkVersion, configured, contractInspected,
    ready: configured && contractInspected,
    verified: configured && contractInspected && sdkVersion === userVerifiedSdkVersion,
    verificationSource: contractInspected ? 'user-run AUTHENTIC result, 2026-09-07' : null,
    reason: !sdkVersion ? 'sdk_missing' : !contractInspected ? 'sdk_version_unverified' : !configured ? 'missing_key' : null };
}
