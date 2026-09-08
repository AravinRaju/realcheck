import { verdictLabels } from './results.mjs';

// Inspected @realitydefender/realitydefender 0.1.19, dist/types/sdk.d.ts
// and dist/detection/results.js. status is string, NOT a closed enum.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const score = value => value === null || (typeof value === 'number' && Number.isFinite(value));
// Diagnostic token only, not a verdict. Reject unsafe/overlong values intact;
// truncating arbitrary text could disclose a private prefix.
export const sanitizedRealityDefenderStatus = value => typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value) ? value : null;
export function mapRealityDefenderResult(result) {
  if (!record(result) || typeof result.requestId !== 'string' || !result.requestId.trim() ||
      typeof result.status !== 'string' || !score(result.score) || !Array.isArray(result.models) ||
      !result.models.every(model => record(model) && typeof model.name === 'string' &&
        typeof model.status === 'string' && score(model.score)) ||
      !(result.heatmaps === null || (record(result.heatmaps) && Object.values(result.heatmaps).every(url => typeof url === 'string')))) {
    return { error: 'invalid_response' };
  }
  // Use only the SDK's overall status. Never threshold scores or vote models.
  if (result.status === 'MANIPULATED') return { detection: { label: verdictLabels.likely } };
  if (result.status === 'AUTHENTIC') return { detection: { label: verdictLabels.unlikely } };
  if (['ANALYZING', 'DOWNLOADING'].includes(result.status)) return { error: 'processing' };
  // No inconclusive status is established by this installed contract.
  return { error: 'unsupported_status' };
}
