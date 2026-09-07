import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPanel } from '../extension/build.mjs';
import { createPanelFetch } from '../extension/client.mjs';
import { createHash, webcrypto } from 'node:crypto';
import { Readable } from 'node:stream';
import { createTranscriptReview } from '../public/review.mjs';
import { createTranscriber } from '../lib/providers.mjs';
import { withTemporaryUpload, validateMetadata } from '../lib/media.mjs';
import { analyze } from '../lib/analyze.mjs';
import { createServer } from '../server.mjs';
import { wav } from './helpers.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Minimal in-memory DOM, executing actual app.js with synthetic inputs only.
// Does not connect to or inspect the user's browser, server, or recordings.
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false; this.attrs = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  set textContent(value) { this.children = []; this.text = value; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(event, handler) { this.events[event] = handler; }
  querySelectorAll(tag) { return this.children.filter(child => child.tag === tag); }
  focus() {} pause() {} load() {}
}
async function harness({ tamper = value => value, responses = ['Send me the verification code.'], panel = false, configReply } = {}) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let requests = 0, lastResponse, sentBytesMatched = false;
  let source;
  if (panel) {
    const output = await mkdtemp(join(tmpdir(), 'realcheck-panel-ui-test-'));
    try { await buildPanel(output); source = await readFile(join(output, 'panel/app.js'), 'utf8'); }
    finally { await rm(output, { recursive: true, force: true }); }
    source = source.replace("import { createPanelFetch } from '../client.mjs';", '');
  } else source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  source = source.replace("import { createTranscriptReview } from './review.mjs';", '');
  const sandbox = {
    createPanelFetch: (_fetcher, origin) => createPanelFetch(sandbox.fetch, origin),
    createTranscriptReview, console: { log() { assert.fail('unexpected logging'); } },
    document: { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) },
    window: { addEventListener() {} }, URL, crypto: webcrypto, TextEncoder, Uint8Array, AbortController, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      if (panel) { assert.ok(url.startsWith('http://127.0.0.1:3001/')); url = new URL(url).pathname; }
      if (url === '/api/config') return configReply ? configReply() : Response.json({ mode: 'live', clientRequestTimeoutMs: 105000, detectionConfigured: true, transcriptionConfigured: true, sidePanel: { protocol: 1, configured: true, authorized: true } });
      assert.equal(url, '/api/analyze');
      assert.equal(init.headers['X-Fixture-Transcript'], undefined);
      const bytes = Buffer.from(await init.body.arrayBuffer());
      const expected = hash(bytes), text = responses[Math.min(requests++, responses.length - 1)];
      lastResponse = await withTemporaryUpload(Readable.from([bytes]), validateMetadata('test.wav', bytes.length), async upload => {
        upload.trace = { requestId: init.headers['X-Request-ID'], uploadSha256: hash(upload.bytes) };
        const result = await analyze(upload, { mode: 'live', keys: { GROQ_API_KEY: 'synthetic' } }, {
          detect: async () => ({ label: 'Unlikely deepfake' }),
          transcribe: (upload, key) => createTranscriber()(upload, key, { fetcher: async (_url, options) => {
            sentBytesMatched = hash(Buffer.from(await options.body.get('file').arrayBuffer())) === expected;
            return Response.json({ text, language: 'english' });
          } }),
        });
        return { ...result, trace: upload.trace };
      });
      return Response.json(tamper(lastResponse));
    },
  };
  await vm.runInNewContext('(async () => {' + source + '; globalThis.testUI = { chooseFiles }; })()', sandbox);
  const choose = async () => {
    sandbox.testUI.chooseFiles([new File([wav()], 'test.wav', { type: 'audio/wav' })]);
    get('media-preview').children[0].events.loadedmetadata();
  };
  return { get, choose, submit: () => get('upload-form').events.submit({ preventDefault() {} }),
    facts: () => ({ requests, lastResponse, sentBytesMatched }) };
}

test('built panel preserves playback and requires review before local wording checks', async () => {
  const ui = await harness({ panel: true });
  assert.equal(ui.facts().requests, 0);
  await ui.choose(); const audio = ui.get('media-preview').children[0];
  await ui.submit();
  assert.equal(ui.facts().requests, 1); assert.equal(ui.facts().sentBytesMatched, true);
  assert.equal(ui.get('transcript').textContent, ui.facts().lastResponse.transcription.text);
  assert.equal(ui.get('check-wording').disabled, true); assert.equal(ui.get('findings').children.length, 0);
  ui.get('review-confirm').checked = true; ui.get('review-confirm').events.change();
  ui.get('check-wording').events.click(); assert.equal(ui.get('findings').children.length, 1);
  ui.get('transcript-edit').value = 'Corrected synthetic wording.'; ui.get('transcript-edit').events.input();
  assert.equal(ui.get('review-confirm').checked, false); assert.equal(ui.get('check-wording').disabled, true);
  assert.equal(ui.get('findings').children.length, 0); assert.equal(ui.facts().requests, 1);
  assert.equal(ui.get('media-preview').children[0], audio); assert.equal(ui.get('auth-label').textContent, 'Unlikely deepfake');
});

test('website and built panel display only sanitized transcription failure codes and retain detection', async () => {
  for (const panel of [false, true]) {
    for (const code of ['http_400', 'http_429', 'timeout', 'network', 'invalid_response', 'private transcript <script>']) {
      const ui = await harness({ panel, tamper: result => ({ ...result, transcription: { status: 'unavailable', code } }) });
      await ui.choose(); const audio = ui.get('media-preview').children[0]; await ui.submit();
      const expected = code.startsWith('private') ? 'internal' : code;
      assert.ok(ui.get('transcript-error-detail').textContent.includes('Failure code: ' + expected + '.'));
      assert.doesNotMatch(ui.get('transcript-error-detail').textContent, /private|<script>/);
      assert.equal(ui.get('auth-label').textContent, 'Unlikely deepfake');
      assert.equal(ui.get('check-wording').disabled, true); assert.equal(ui.get('review-confirm').checked, false);
      assert.equal(ui.get('media-preview').children[0], audio); assert.equal(ui.facts().requests, 1);
    }
  }
});
test('panel displays the failed configuration step without leaking raw errors or submitting media', async () => {
  for (const [configReply, expected] of [
    [() => { throw new Error('private diagnostic'); }, /no HTTP response/],
    [() => new Response('private diagnostic', { status: 403 }), /HTTP 403/],
    [() => new Response('private diagnostic'), /invalid configuration JSON/],
    [() => Response.json({}), /missing side-panel protocol/],
    [() => Response.json({ sidePanel: { protocol: 1, configured: false } }), /not configured/],
    [() => Response.json({ sidePanel: { protocol: 1, configured: true, authorized: false } }), /extension Origin/],
  ]) {
    const ui = await harness({ panel: true, configReply });
    assert.match(ui.get('mode-banner').textContent, expected);
    assert.doesNotMatch(ui.get('mode-banner').textContent, /private diagnostic/);
    assert.equal(ui.get('analyze-button').disabled, true); assert.equal(ui.facts().requests, 0);
  }
});

test('selected bytes through Groq and actual UI render match one request; review remains independent', async () => {
  const ui = await harness();
  assert.equal(ui.facts().requests, 0); // Page initialization/refresh cannot scan.
  await ui.choose(); const originalPreview = ui.get('media-preview').children[0];
  await ui.submit();
  assert.equal(ui.facts().sentBytesMatched, true);
  assert.equal(ui.get('transcript').textContent, ui.facts().lastResponse.transcription.text);
  assert.equal(ui.get('transcript-result').dataset.requestId, ui.facts().lastResponse.trace.requestId);
  assert.equal(ui.get('check-wording').disabled, true);
  assert.equal(ui.get('findings').children.length, 0);
  ui.get('review-confirm').checked = true; ui.get('review-confirm').events.change();
  ui.get('check-wording').events.click(); assert.equal(ui.get('findings').children.length, 1);
  ui.get('transcript-edit').value = 'Our meeting is tomorrow.'; ui.get('transcript-edit').events.input();
  assert.equal(ui.get('check-wording').disabled, true); assert.equal(ui.get('findings').children.length, 0);
  assert.equal(ui.get('auth-label').textContent, 'Unlikely deepfake');
  assert.equal(ui.get('media-preview').children[0], originalPreview);
  assert.equal(ui.get('transcript').textContent, ui.facts().lastResponse.transcription.text);
  await ui.choose(); assert.equal(ui.get('transcript').textContent, '');
  assert.equal(ui.get('review-confirm').checked, false);
});
test('wrong request, wrong bytes, text mismatch and fixture contamination are rejected', async () => {
  for (const tamper of [
    value => ({ ...value, trace: { ...value.trace, requestId: 'old-request' } }),
    value => ({ ...value, trace: { ...value.trace, uploadSha256: 'wrong-file' } }),
    value => ({ ...value, trace: { ...value.trace, groqInputSha256: 'wrong-file' } }),
    value => ({ ...value, transcription: { ...value.transcription, text: 'Replaced text.' } }),
    value => ({ ...value, fixture: true }),
  ]) {
    const ui = await harness({ tamper }); await ui.choose(); await ui.submit();
    assert.equal(ui.get('transcript').textContent, '');
    assert.equal(ui.get('check-wording').disabled, true);
    assert.equal(ui.facts().requests, 1);
  }
});
test('separate responses stay separate without caching or invented empty text', async () => {
  const ui = await harness({ responses: ['First synthetic response.', 'Second synthetic response.', ''] });
  await ui.choose();
  for (const expected of ['First synthetic response.', 'Second synthetic response.', '']) {
    await ui.submit(); assert.equal(ui.get('transcript').textContent, expected);
  }
  assert.equal(ui.facts().requests, 3);
});
test('config route reports readiness without process or adapter diagnostics', async () => {
  for (const mode of ['fixture', 'live']) {
    const server = createServer({ REALCHECK_MODE: mode, REALITY_DEFENDER_API_KEY: 'synthetic', GROQ_API_KEY: 'synthetic' });
    const config = await new Promise(resolve => server.emit('request', { method: 'GET', url: '/api/config', headers: { host: 'localhost' } },
      { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }));
    assert.equal(config.server, undefined);
    assert.equal(config.detection, undefined); assert.equal(config.detectionReady, true);
    assert.equal(config.detectionVerified, true); assert.equal(config.detectionEnabled, mode === 'live');
    assert.equal(config.transcriptionVerified, false); assert.equal(config.transcriptionReviewRequired, true);
  }
});


test('public live disablement gates website and panel uploads while preserving privacy notice', async () => {
  for (const panel of [false, true]) {
    const ui = await harness({ panel, configReply: () => Response.json({ mode: 'live', scansEnabled: false,
      clientRequestTimeoutMs: 105000, detectionConfigured: true, transcriptionConfigured: true,
      sidePanel: { protocol: 1, configured: true, authorized: true } }) });
    await ui.choose();
    assert.equal(ui.get('analyze-button').disabled, true);
    assert.equal(ui.get('mode-banner').textContent, 'Live checks are not enabled.');
    assert.match(ui.get('upload-note').textContent, /Images and audio may be sent/);
    await ui.submit(); assert.equal(ui.facts().requests, 0);
  }
});
