import { detectManipulation, transcribeAudio, ProviderError } from './providers.mjs';
import { fixtureLabels, fixtureTranscripts } from './fixtures.mjs';
import { checkTranscript } from './rules.mjs';

const unavailable = code => ({ status: 'unavailable', label: 'Analysis unavailable', code });
const safeCode = error => error instanceof ProviderError ? error.code : 'internal';
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
      detect(upload, keys.REALITY_DEFENDER_API_KEY),
      audio ? transcribe(upload, keys.GROQ_API_KEY) : Promise.resolve(null),
    ]);
    // A future verified RD adapter must return only an application label.
    authenticity = detectionResult.status === 'fulfilled' && Object.values(fixtureLabels).includes(detectionResult.value?.label)
      ? { status: 'complete', label: detectionResult.value.label } :
        unavailable(detectionResult.status === 'rejected' ? safeCode(detectionResult.reason) : 'invalid_response');
    transcription = !audio ? { status: 'not_applicable' } : transcriptResult.status === 'fulfilled'
      ? { status: 'complete', ...transcriptResult.value } : unavailable(safeCode(transcriptResult.reason));
  }
  const content = transcription.status === 'complete'
    ? checkTranscript(transcription.text, transcription.language)
    : { status: 'not_evaluated', findings: [], message: audio ? 'Content rules were not run because transcription is unavailable.' : 'Transcript checks apply to audio only.' };
  return { mode, fixture: mode === 'fixture', authenticity, transcription, content };
}

