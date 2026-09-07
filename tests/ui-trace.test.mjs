import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
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
async function harness({ tamper = value => value, responses = ['Send me the verification code.'] } = {}) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  let requests = 0, lastResponse, sentBytesMatched = false;
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace("import { createTranscriptReview } from './review.mjs';", '');
  const sandbox = {
    createTranscriptReview, console: { log() { assert.fail('unexpected logging'); } },
    document: { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) },
    window: { addEventListener() {} }, URL, crypto: webcrypto, TextEncoder, Uint8Array, AbortController, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      if (url === '/api/config') return Response.json({ mode: 'live', clientRequestTimeoutMs: 105000, detectionConfigured: true, transcriptionConfigured: true });
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
test('config route reports this process and real SDK readiness without a listening socket', async () => {
  for (const mode of ['fixture', 'live']) {
    const server = createServer({ REALCHECK_MODE: mode, REALITY_DEFENDER_API_KEY: 'synthetic', GROQ_API_KEY: 'synthetic' });
    const config = await new Promise(resolve => server.emit('request', { method: 'GET', url: '/api/config', headers: { host: 'localhost' } },
      { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }));
    assert.equal(config.server.pid, process.pid);
    assert.ok(config.server.projectPath.toLowerCase().includes('realcheck'));
    assert.equal(config.detection.sdkVersion, '0.1.19'); assert.equal(config.detectionReady, true);
    assert.equal(config.detectionVerified, true); assert.equal(config.detectionEnabled, mode === 'live');
    assert.equal(config.transcriptionVerified, false); assert.equal(config.transcriptionReviewRequired, true);
  }
});
