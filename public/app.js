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
function serviceLimitDetail(result) {
  return 'Service limit reached; try again later.' +
    (Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds > 0
      ? ' Wait at least ' + result.retryAfterSeconds + ' seconds before trying this provider again.' : '');
}
function clearPreview() {
  for (const audio of $('media-preview').querySelectorAll('audio')) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  $('media-preview').replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null; previewReady = false;
}
function showError(message) { $('file-error').textContent = message; $('file-error').hidden = !message; }
function resetResults() {
  $('auth-empty').hidden = false; $('auth-loading').hidden = true; $('auth-result').hidden = true;
  $('content-card').hidden = true; $('transcript-result').hidden = true; $('transcript-error').hidden = true;
  $('auth-card').removeAttribute('data-state');
}
function updateControls() {
  $('analyze-button').disabled = busy || !file || !previewReady || !mode;
  $('change-file').disabled = busy; $('dropzone').disabled = busy;
  $('detection-fixture').disabled = busy; $('transcript-fixture').disabled = busy;
  $('upload-form').setAttribute('aria-busy', String(busy));
  $('button-label').textContent = busy ? (mode === 'fixture' ? 'Showing test results…' : 'Checking your file…') :
    !mode ? 'Service unavailable' : !file ? 'Choose a file to continue' : !previewReady ? 'Preparing preview…' :
    mode === 'fixture' ? 'Show fixture results' : 'Check this file';
}
function chooseFiles(files) {
  if (busy) return;
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
  $('auth-guidance').textContent = details.guidance;
  $('auth-detail').textContent = fixture ? 'This is the selected example state. No detection scan was used.' :
    result.code === 'sdk_contract_unverified' ? 'Live detection is disabled until the SDK contract and first real scan have been verified.' :
    result.code === 'missing_key' ? 'Detection is not configured for this prototype.' :
    result.code === 'http_429' ? serviceLimitDetail(result) :
    label === 'Analysis unavailable' ? 'A service failure is separate from an inconclusive detection result.' : 'Review authenticity separately from what the message asks you to do.';
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
  $('content-card').hidden = kind !== 'audio';
  $('transcript-loading').hidden = true; $('transcript-result').hidden = true; $('transcript-error').hidden = true;
  if (kind !== 'audio') return;
  if (result.status !== 'complete' || typeof result.text !== 'string') {
    $('transcript-error').hidden = false;
    $('transcript-error-detail').textContent = fixture ? 'TEST FIXTURE — Simulated transcription failure. No audio was sent to Groq.' :
      result.code === 'missing_key' ? 'Transcription is not configured for this prototype.' :
      result.code === 'http_429' ? serviceLimitDetail(result) : 'Groq transcription did not complete. Try again later.';
    return;
  }
  $('transcript-result').hidden = false;
  $('transcript-source').textContent = fixture ? 'TEST TRANSCRIPT · NOT TRANSCRIBED FROM YOUR AUDIO' : 'GROQ WHISPER · ' + (result.language || 'LANGUAGE UNKNOWN').toUpperCase();
  const findings = Array.isArray(content.findings) ? content.findings : [];
  markTranscript(result.text || 'No transcript text was returned.', findings);
  $('content-summary').textContent = content.message;
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
  if (!file || !previewReady || busy || !mode) return;
  busy = true; showError(''); updateControls();
  $('auth-card').removeAttribute('data-state');
  $('auth-empty').hidden = true; $('auth-result').hidden = true; $('auth-loading').hidden = false;
  $('loading-title').textContent = mode === 'fixture' ? 'Preparing a fixture…' : 'Checking authenticity…';
  $('loading-copy').textContent = mode === 'fixture' ? 'No live detection scan is being used.' : 'Detection and transcription run independently.';
  $('content-card').hidden = kind !== 'audio'; $('transcript-result').hidden = true; $('transcript-error').hidden = true; $('transcript-loading').hidden = false;
  $('transcript-loading-text').textContent = mode === 'fixture' ? 'Preparing the selected test transcript…' : 'Groq Whisper is transcribing the audio…';
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), clientRequestTimeoutMs);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST', body: file, signal: activeRequest.signal,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name),
        ...(mode === 'fixture' ? { 'X-Fixture-Detection': $('detection-fixture').value, 'X-Fixture-Transcript': $('transcript-fixture').value } : {}) },
    });
    const result = await response.json();
    if (result.kind === 'validation') { resetResults(); showError(result.message); }
    else if (!response.ok || result.mode !== mode || result.fixture !== (mode === 'fixture') || !result.authenticity || !result.transcription || !result.content) serviceFailure();
    else {
      authenticityResult(result.authenticity, result.fixture);
      transcriptResult(result.transcription, result.content, result.fixture);
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
  $('fixture-controls').hidden = mode !== 'fixture';
  $('mode-banner').classList.toggle('live', mode === 'live');
  $('mode-banner').textContent = mode === 'fixture' ? 'FIXTURE MODE — Authored test results only. No media is sent to Reality Defender or Groq.' :
    'LIVE MODE — Detection verification is pending. Audio transcription ' + (config.transcriptionConfigured ? 'is configured but has not been verified live.' : 'is not configured.');
  $('upload-note').textContent = mode === 'fixture' ? 'Upload validation only. The result and transcript are selected examples.' :
    'Audio may be sent to Groq. Live detection is currently disabled.';
  $('provider-notice').textContent = mode === 'fixture' ? 'Fixture mode: RealCheck receives the file for validation, then deletes its temporary copy. Neither Reality Defender nor Groq receives any media. The selected transcript is an authored example unrelated to your recording.' :
    'Live mode: Groq receives audio for Whisper transcription when configured. Images are never sent to Groq. Reality Defender is the intended image/audio detection provider, but its adapter is currently disabled pending verification, so it receives no uploads yet. Transcript rules run on this server and send no transcript to another provider.';
} catch {
  $('mode-banner').textContent = 'Analysis unavailable — Cannot connect to the prototype. Refresh to try again.';
  serviceFailure();
}
updateControls();
