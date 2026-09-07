import { createTranscriptReview } from './review.mjs';
const $ = id => document.getElementById(id);
const formats = { jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio' };
const labels = {
  'Likely deepfake': { state: 'likely', icon: '!', guidance: 'Pause before sharing. Check the original source and look for independent confirmation.' },
  'Unlikely deepfake': { state: 'unlikely', icon: '✓', guidance: 'Check the source and context before sharing. This result does not prove the file is authentic.' },
  'Unclear': { state: 'unclear', icon: '?', guidance: 'Hold off on sharing. Try an original, clearer image or a clean recording, and verify the source.' },
  'Analysis unavailable': { state: 'unavailable', icon: '—', guidance: 'No authenticity analysis is available. Try again later. This says nothing about whether the file is manipulated.' },
};
let file = null, kind = null, previewUrl = null, previewReady = false, busy = false, mode = null, activeRequest = null;
let clientRequestTimeoutMs = null;
let scansEnabled = true;
let review = null, selectionRevision = 0, activeResultId = null;
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function resetReview() {
  review = null; activeResultId = null;
  $('transcript-edit').value = ''; $('review-confirm').checked = false;
  $('check-wording').disabled = true; $('transcript').replaceChildren();
  $('findings').replaceChildren(); $('content-summary').textContent = ''; $('content-summary').hidden = true; $('trace-status').textContent = '';
}
function serviceLimitDetail(result) {
  return 'Service limit reached; try again later.' +
    (Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds > 0
      ? ' Wait at least ' + result.retryAfterSeconds + ' seconds before trying this provider again.' : '');
}
function transcriptionFailureCode(code) {
  return typeof code === 'string' && (['missing_key', 'timeout', 'network', 'invalid_response', 'internal', 'provider_error'].includes(code) || /^http_[45]\d{2}$/.test(code)) ? code : 'internal';
}
function clearPreview() {
  for (const audio of $('media-preview').querySelectorAll('audio')) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  $('media-preview').replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; previewReady = false;
}
function showError(message) { $('file-error').textContent = message; $('file-error').hidden = !message; }
function resetResults() {
  resetReview();
  $('auth-card').hidden = true;
  $('auth-empty').hidden = false; $('auth-loading').hidden = true; $('auth-result').hidden = true;
  $('content-card').hidden = true; $('transcript-result').hidden = true; $('transcript-error').hidden = true;
  $('auth-card').removeAttribute('data-state');
}
function updateControls() {
  $('analyze-button').disabled = busy || !file || !previewReady || !mode || !scansEnabled;
  $('change-file').disabled = busy; $('dropzone').disabled = busy;
  $('detection-fixture').disabled = busy; $('transcript-fixture').disabled = busy;
  $('upload-form').setAttribute('aria-busy', String(busy));
  $('button-label').textContent = busy ? (mode === 'fixture' ? 'Showing test results…' : 'Checking your file…') :
    !mode || !scansEnabled ? 'Service unavailable' : !file ? 'Choose a file to continue' : !previewReady ? 'Preparing preview…' :
    mode === 'fixture' ? 'Show fixture results' : 'Check this file';
}
function chooseFiles(files) {
  if (busy) return;
  selectionRevision++;
  resetResults(); showError(''); clearPreview(); file = null; kind = null;
  $('preview').hidden = true; $('dropzone').hidden = false; $('audio-fixture-row').hidden = true;
  if (files.length !== 1) { showError('Choose one image or audio file at a time.'); updateControls(); return; }
  const candidate = files[0], extension = candidate.name.split('.').pop().toLowerCase();
  const candidateKind = Object.hasOwn(formats, extension) ? formats[extension] : null;
  if (!candidateKind) showError('Choose JPG, PNG, WebP, MP3, WAV, FLAC, or Ogg audio. Video is not supported.');
  else if (!candidate.size) showError('The file is empty. Choose another file.');
  else if (candidate.name.length > 180 || /[\\/\x00-\x1f]/.test(candidate.name)) showError('Use a plain filename of 180 characters or fewer.');
  else if (candidate.size > (candidateKind === 'image' ? 10 : 20) * 1024 * 1024) showError(candidateKind === 'image' ? 'Images must be 10 MB or smaller.' : 'Audio must be 20 MB or smaller.');
  else {
    file = candidate; kind = candidateKind; previewUrl = URL.createObjectURL(candidate);
    const localUrl = previewUrl;
    const preview = document.createElement(kind === 'image' ? 'img' : 'audio');
    if (kind === 'image') preview.alt = 'Preview of your selected image';
    else { preview.controls = true; preview.preload = 'metadata'; preview.setAttribute('aria-label', 'Preview of your selected audio'); }
    preview.addEventListener(kind === 'image' ? 'load' : 'loadedmetadata', () => {
      if (previewUrl !== localUrl) return;
      if (kind === 'image' && preview.naturalWidth * preview.naturalHeight > 40000000) {
        file = null; clearPreview(); $('preview').hidden = true; $('dropzone').hidden = false;
        showError('Use an image with no more than 40 million pixels.');
      } else previewReady = true;
      updateControls();
    });
    preview.addEventListener('error', () => {
      if (previewUrl !== localUrl) return;
      file = null; clearPreview(); $('preview').hidden = true; $('dropzone').hidden = false;
      showError('This browser cannot preview the file. Export a fresh copy in a supported format.'); updateControls();
    });
    preview.src = previewUrl; $('media-preview').append(preview);
    $('file-name').textContent = candidate.name;
    $('file-size').textContent = (kind === 'image' ? 'Image' : 'Audio') + ' · ' +
      (candidate.size < 1048576 ? Math.ceil(candidate.size / 1024) + ' KB' : (candidate.size / 1048576).toFixed(1) + ' MB');
    $('preview').hidden = false; $('dropzone').hidden = true;
    $('audio-fixture-row').hidden = kind !== 'audio';
  }
  updateControls();
}
function authenticityResult(result, fixture) {
  const label = result.status === 'complete' && Object.hasOwn(labels, result.label) && result.label !== 'Analysis unavailable'
    ? result.label : 'Analysis unavailable';
  const details = labels[label];
  $('auth-empty').hidden = true; $('auth-loading').hidden = true; $('auth-result').hidden = false;
  $('auth-card').dataset.state = details.state;
  $('auth-label').textContent = label; $('auth-icon').textContent = details.icon;
  $('auth-source').textContent = fixture ? 'TEST FIXTURE · NOT AN ANALYSIS OF YOUR FILE' : label === 'Analysis unavailable' ? 'REALITY DEFENDER · NO VERDICT' : 'REALITY DEFENDER';
  const imageMeaning = {
    'Likely deepfake': 'Reality Defender assessed this image as likely manipulated.',
    'Unlikely deepfake': 'Reality Defender assessed this image as unlikely to be manipulated. This does not prove it is authentic.',
    'Unclear': 'The assessment does not establish whether this image was manipulated.',
  };
  // Verdict definitions only: never infer image defects from a label or score.
  $('auth-guidance').textContent = !fixture && kind === 'image' && imageMeaning[label]
    ? imageMeaning[label] + ' ' + details.guidance : details.guidance;
  $('auth-detail').textContent = fixture ? 'This is the selected example state. No detection scan was used.' :
    result.code === 'processing' ? 'The provider is still processing this file. No verdict is available within the polling budget.' :
    result.code === 'unsupported_status' ? 'The provider returned a status this prototype cannot interpret.' :
    result.code === 'missing_key' ? 'Detection is not configured for this prototype.' :
    result.code === 'http_429' ? serviceLimitDetail(result) :
    label === 'Analysis unavailable' ? 'A service failure is separate from an inconclusive detection result.' :
    kind === 'image' ? 'The detector returned this assessment without a detailed explanation for this image.' :
    'Review authenticity separately from what the message asks you to do.';
}
function markTranscript(text, findings) {
  const target = $('transcript'); target.replaceChildren();
  const ranges = findings.filter(f => Number.isInteger(f.start) && Number.isInteger(f.end) && f.start >= 0 && f.end > f.start && f.end <= text.length).sort((a,b) => a.start - b.start);
  let position = 0;
  for (const range of ranges) {
    if (range.start < position) continue;
    target.append(document.createTextNode(text.slice(position, range.start)));
    const mark = document.createElement('mark'); mark.textContent = text.slice(range.start, range.end); target.append(mark);
    position = range.end;
  }
  target.append(document.createTextNode(text.slice(position)));
}
function transcriptResult(result, content, fixture) {
  resetReview();
  $('content-card').hidden = kind !== 'audio';
  $('transcript-loading').hidden = true; $('transcript-result').hidden = true; $('transcript-error').hidden = true;
  if (kind !== 'audio') return;
  if (result.status !== 'complete' || typeof result.text !== 'string') {
    $('transcript-error').hidden = false;
    $('transcript-error-detail').textContent = fixture ? 'TEST FIXTURE — Simulated transcription failure. No audio was sent to Groq.' :
      result.code === 'missing_key' ? 'Transcription is not configured for this prototype.' :
      result.code === 'http_429' ? serviceLimitDetail(result) : 'Groq transcription did not complete. Try again later.';
    if (!fixture) $('transcript-error-detail').textContent += ' Failure code: ' + transcriptionFailureCode(result.code) + '.';
    return;
  }
  $('transcript-result').hidden = false;
  $('transcript-source').textContent = fixture ? 'TEST TRANSCRIPT · NOT TRANSCRIBED FROM YOUR AUDIO' : 'GROQ WHISPER · ' + (result.language || 'LANGUAGE UNKNOWN').toUpperCase();
  // Display provider text exactly. No filler sentence for an empty response.
  markTranscript(result.text, []);
  review = createTranscriptReview(result.text, result.language, fixture);
  $('transcript-edit').value = result.text;
  $('transcript-status').textContent = 'Listen and correct any errors before checking the wording.';
  $('review-confirm-label').textContent = 'I reviewed this transcript.';
  renderFindings({ findings: [], message: '' });
}
function renderFindings(content) {
  const findings = Array.isArray(content.findings) ? content.findings : [];
  $('content-summary').textContent = content.message;
  $('content-summary').hidden = !content.message;
  $('findings').replaceChildren();
  for (const finding of findings) {
    const item = document.createElement('li');
    const title = document.createElement('h3'); title.textContent = finding.title;
    const excerpt = document.createElement('p'); excerpt.className = 'excerpt'; excerpt.textContent = '“' + finding.excerpt + '”';
    const guidance = document.createElement('p'); guidance.textContent = finding.guidance;
    const source = document.createElement('a');
    try {
      const url = new URL(finding.source);
      if (url.origin !== 'https://consumer.ftc.gov') continue;
      source.href = url.href;
    } catch { continue; }
    source.textContent = finding.sourceTitle; source.target = '_blank'; source.rel = 'noopener noreferrer';
    item.append(title, excerpt, guidance, source); $('findings').append(item);
  }
}
$('transcript-edit').addEventListener('input', () => {
  if (!review) return;
  review.edit($('transcript-edit').value); $('review-confirm').checked = false; $('check-wording').disabled = true;
  renderFindings({ findings: [], message: '' });
});
$('review-confirm').addEventListener('change', () => {
  if (!review) return;
  review.confirm($('review-confirm').checked);
  $('check-wording').disabled = !review.confirmed;
  if (!review.confirmed) renderFindings({ findings: [], message: '' });
});
$('check-wording').addEventListener('click', () => {
  if (!review || !review.confirmed || !activeResultId || busy) return;
  // Rules run locally on the user's draft, never re-upload or alter detection.
  renderFindings(review.check());
});
function serviceFailure() {
  authenticityResult({ status: 'unavailable' }, false);
  transcriptResult({ status: 'unavailable' }, {}, false);
}
for (const id of ['dropzone', 'change-file']) $(id).addEventListener('click', () => { $('file-input').value = ''; $('file-input').click(); });
$('file-input').addEventListener('change', event => { if (event.target.files.length) chooseFiles(event.target.files); });
for (const eventName of ['dragenter','dragover']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('drag-over'); });
for (const eventName of ['dragleave','drop']) $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.remove('drag-over'); });
$('dropzone').addEventListener('drop', event => chooseFiles(event.dataTransfer.files));
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('detection-fixture').addEventListener('change', resetResults);
$('transcript-fixture').addEventListener('change', resetResults);
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!file || !previewReady || busy || !mode || !scansEnabled) return;
  resetReview();
  const selectedFile = file, revision = selectionRevision, requestId = crypto.randomUUID();
  busy = true; showError(''); updateControls();
  $('auth-card').hidden = false;
  $('auth-card').removeAttribute('data-state');
  $('auth-empty').hidden = true; $('auth-result').hidden = true; $('auth-loading').hidden = false;
  $('loading-title').textContent = mode === 'fixture' ? 'Preparing a fixture…' : 'Checking authenticity…';
  $('loading-copy').textContent = mode === 'fixture' ? 'No live detection scan is being used.' : 'Detection and transcription run independently.';
  $('content-card').hidden = kind !== 'audio'; $('transcript-result').hidden = true; $('transcript-error').hidden = true; $('transcript-loading').hidden = false;
  $('transcript-loading-text').textContent = mode === 'fixture' ? 'Preparing the selected test transcript…' : 'Groq Whisper is transcribing the audio…';
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), clientRequestTimeoutMs);
  try {
    const selectedBytes = await selectedFile.arrayBuffer();
    const selectedSha256 = await sha256(selectedBytes);
    new Uint8Array(selectedBytes).fill(0);
    const response = await fetch('/api/analyze', {
      method: 'POST', body: selectedFile, signal: activeRequest.signal,
      headers: { 'Content-Type': selectedFile.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(selectedFile.name), 'X-Request-ID': requestId,
        ...(mode === 'fixture' ? { 'X-Fixture-Detection': $('detection-fixture').value, 'X-Fixture-Transcript': $('transcript-fixture').value } : {}) },
    });
    const result = await response.json();
    if (revision !== selectionRevision || file !== selectedFile) return;
    if (!response.ok && [429, 503].includes(response.status) && !result.authenticity) {
      serviceFailure();
      showError(response.status === 429 ? 'The demo usage limit has been reached. Try later.' : 'Checks are temporarily unavailable. Try later.');
    }
    else if (result.kind === 'validation') { resetResults(); showError(result.message); }
    else if (!response.ok || result.mode !== mode || result.fixture !== (mode === 'fixture') || !result.authenticity || !result.transcription || !result.content ||
      result.trace?.requestId !== requestId || result.trace?.uploadSha256 !== selectedSha256) {
      serviceFailure(); showError('The response could not be matched to this upload. No wording checks were run.');
    }
    else {
      authenticityResult(result.authenticity, result.fixture);
      if (!result.fixture && result.trace.rdInputSha256 && result.trace.rdInputSha256 !== selectedSha256) authenticityResult({ status: 'unavailable' }, false);
      let transcriptMatches = true;
      if (!result.fixture && result.transcription.status === 'complete') {
        transcriptMatches = result.trace.groqInputSha256 === selectedSha256 && typeof result.transcription.text === 'string' &&
          result.trace.groqTextSha256 === await sha256(new TextEncoder().encode(result.transcription.text));
      }
      transcriptResult(transcriptMatches ? result.transcription : { status: 'unavailable' }, result.content, result.fixture);
      if (review) {
        const displayMatches = $('transcript').textContent === result.transcription.text;
        if (!displayMatches) { resetReview(); $('transcript-status').textContent = 'Text mismatch. Wording checks are disabled.'; }
        else {
          activeResultId = requestId;
          $('transcript-result').dataset.requestId = requestId;
          $('trace-status').textContent = result.fixture ? 'Fixture example; no provider comparison applies.' :
            'The selected file and displayed transcript match this response. Matching text does not establish that the words were spoken.';
        }
      }
      $('auth-result').focus();
    }
  } catch { serviceFailure(); }
  finally { clearTimeout(timeout); activeRequest = null; busy = false; updateControls(); }
});
window.addEventListener('pagehide', () => { activeRequest?.abort(); clearPreview(); });
try {
  const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error();
  const config = await response.json();
  if (!['fixture','live'].includes(config.mode)) throw new Error();
  if (!Number.isInteger(config.clientRequestTimeoutMs) || config.clientRequestTimeoutMs < 1000 || config.clientRequestTimeoutMs > 120000) throw new Error();
  clientRequestTimeoutMs = config.clientRequestTimeoutMs;
  mode = config.mode;
  scansEnabled = config.scansEnabled !== false;
  $('fixture-controls').hidden = mode !== 'fixture';
  $('mode-banner').classList.toggle('live', mode === 'live');
  $('mode-banner').textContent = mode === 'fixture' ? 'FIXTURE MODE — Authored test results only. No media is sent to Reality Defender or Groq.' :
    'LIVE MODE — Reality Defender detection ' + (config.detectionConfigured ? 'is configured.' : 'is not configured.') +
    ' Groq audio transcription ' + (config.transcriptionConfigured ? 'is configured.' : 'is not configured.');
  if (!scansEnabled) $('mode-banner').textContent = 'Live checks are not enabled.';
  $('upload-note').textContent = mode === 'fixture' ? 'Upload validation only. The result and transcript are selected examples.' :
    'Images and audio may be sent to Reality Defender; audio may also be sent to Groq.';
  $('provider-notice').textContent = mode === 'fixture' ? 'Fixture mode: RealCheck receives the file for validation, then deletes its temporary copy. Neither Reality Defender nor Groq receives any media. The selected transcript is an authored example unrelated to your recording.' :
    'Live mode: Reality Defender receives images and audio for detection when configured. Groq receives audio for Whisper transcription when configured. Images are never sent to Groq. Wording checks run in this browser only after you review and confirm the transcript; corrections are not sent to any provider.';
} catch (error) {
  // Display only allowlisted diagnostics; never raw bodies, credentials or errors.
  const steps = {
    panel_transport: 'Panel connection: no HTTP response. Check the configured backend connection and extension site permission.',
    panel_http: 'Panel connection: backend rejected the configuration handshake. Check the exact extension ID and restart the current backend.',
    panel_json: 'Panel connection: backend returned invalid configuration JSON.',
    panel_schema: 'Panel connection: backend configuration has an unsupported or missing side-panel protocol. Restart the current backend.',
    panel_unconfigured: 'Panel connection: REALCHECK_EXTENSION_ID is not configured on the backend. Set the exact extension ID and restart it.',
    panel_origin: 'Panel connection: backend did not authorize this extension Origin. Check the exact extension ID and restart the backend.',
  };
  const status = error?.code === 'panel_http' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? ' HTTP ' + error.status + '.' : '';
  $('mode-banner').textContent = Object.hasOwn(steps, error?.code) ? steps[error.code] + status :
    'Analysis unavailable — Cannot connect to the prototype. Refresh to try again.';
  serviceFailure();
}
updateControls();
