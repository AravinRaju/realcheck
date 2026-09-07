import { detectManipulation, transcribeAudio, providerFailure } from './providers.mjs';
import { fixtureLabels, fixtureTranscripts } from './fixtures.mjs';
import { parseDetectionResult, parseTranscript } from './results.mjs';

const unavailable = code => ({ status: 'unavailable', label: 'Analysis unavailable', code });
export async function analyze(upload, { mode, keys = {}, detectionFixture = 'unclear', transcriptFixture = 'warning' },
  { detect = detectManipulation, transcribe = transcribeAudio, fixtureDelay = 800 } = {}) {
  if (mode !== 'live' && mode !== 'fixture') throw new Error('Invalid server mode.');
  const audio = upload.metadata.kind === 'audio';
  let authenticity, transcription;
  if (mode === 'fixture') {
    await new Promise(resolve => setTimeout(resolve, fixtureDelay));
    authenticity = Object.hasOwn(fixtureLabels, detectionFixture)
      ? { status: 'complete', label: fixtureLabels[detectionFixture] } : unavailable('fixture_failure');
    transcription = !audio ? { status: 'not_applicable' } : Object.hasOwn(fixtureTranscripts, transcriptFixture)
      ? { status: 'complete', ...fixtureTranscripts[transcriptFixture] } : unavailable('fixture_failure');
  } else {
    // Both services settle independently; one failure never hides the other.
    const [detectionResult, transcriptResult] = await Promise.allSettled([
      Promise.resolve().then(() => detect(upload, keys.REALITY_DEFENDER_API_KEY)),
      audio ? Promise.resolve().then(() => transcribe(upload, keys.GROQ_API_KEY)) : Promise.resolve(null),
    ]);
    authenticity = detectionResult.status === 'rejected' ? providerFailure(detectionResult.reason) :
      parseDetectionResult(detectionResult.value) || unavailable('invalid_response');
    if (!audio) transcription = { status: 'not_applicable' };
    else if (transcriptResult.status === 'rejected') transcription = providerFailure(transcriptResult.reason);
    else {
      const transcript = parseTranscript(transcriptResult.value);
      transcription = transcript ? { status: 'complete', ...transcript } : unavailable('invalid_response');
    }
  }
  if (transcription.status === 'complete') transcription.review = mode === 'fixture' ? 'fixture' : 'unverified';
  // Provider success is not evidence that the words were spoken. Never run
  // wording checks on an upload response, including authored fixture examples.
  const content = { status: 'not_evaluated', findings: [], message: transcription.status === 'complete'
    ? 'Review and correct the transcript against the original audio before running wording checks.'
    : audio ? 'Content rules were not run because transcription is unavailable.' : 'Transcript checks apply to audio only.' };
  return { mode, fixture: mode === 'fixture', authenticity, transcription, content };
}
