// Application labels, not an SDK status mapping. The RD adapter remains gated.
export const verdictLabels = Object.freeze({
  likely: 'Likely deepfake', unlikely: 'Unlikely deepfake', unclear: 'Unclear',
});

// Bound retained transcript text independently of the uploaded audio size.
const MAX_TRANSCRIPT_CHARACTERS = 100000;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseTranscript(value) {
  if (!isRecord(value) || typeof value.text !== 'string' || value.text.length > MAX_TRANSCRIPT_CHARACTERS ||
      (value.language != null && typeof value.language !== 'string')) return null;
  return { text: value.text, language: value.language || null };
}

export function parseDetectionResult(value) {
  // Only the adapter's normalized label is accepted. A raw provider status or
  // score accompanying a label is not a validated application result.
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'label') ||
      !Object.values(verdictLabels).includes(value.label)) return null;
  return { status: 'complete', label: value.label };
}
