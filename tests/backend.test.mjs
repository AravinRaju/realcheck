import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMetadata, validateBytes, withTemporaryUpload } from '../lib/media.mjs';
import { analyze } from '../lib/analyze.mjs';
import { checkTranscript } from '../lib/rules.mjs';
import { transcribeAudio, detectManipulation, ProviderError } from '../lib/providers.mjs';
import { wav, audioUpload } from './helpers.mjs';

test('validation rejects empty, oversized, video, traversal and MIME spoofing', () => {
  for (const [name, size, type] of [
    ['x.wav', 0, ''], ['x.png', 10485761, ''], ['x.wav', 20971521, ''], ['x.mp4', 100, ''],
    ['../x.wav', 100, ''], ['x.wav', 100, 'image/png'], ['x.wav', NaN, ''],
    ['constructor', 999999999, ''], ['x.constructor', 100, ''], ['x.__proto__', 999999999, ''],
  ]) assert.throws(() => validateMetadata(name, size, type));
  assert.equal(validateMetadata('recording.wav', wav().length, 'audio/x-wav').kind, 'audio');
});
test('byte checks reject renamed text and truncated files', () => {
  for (const ext of ['jpg','png','webp','mp3','wav','flac']) {
    assert.throws(() => validateBytes(Buffer.from('not media'), { extension: ext }));
  }
  const bytes = wav();
  assert.doesNotThrow(() => validateBytes(bytes, { extension: 'wav' }));
  assert.throws(() => validateBytes(bytes.subarray(0, 100), { extension: 'wav' }));
});
test('Ogg validation accepts Opus audio and rejects video or truncated pages', () => {
  const page = Buffer.alloc(47);
  page.write('OggS'); page[5] = 2; page.writeUInt32LE(1, 14); page[26] = 1; page[27] = 19;
  page.write('OpusHead', 28);
  assert.doesNotThrow(() => validateBytes(page, { extension: 'ogg' }));
  assert.throws(() => validateBytes(page.subarray(0, 40), { extension: 'ogg' }));
  const video = Buffer.from(page); video.fill(0, 28); video.write('theora', 29);
  assert.throws(() => validateBytes(video, { extension: 'ogg' }));
  assert.throws(() => validateBytes(Buffer.concat([page, video]), { extension: 'ogg' }));
});
test('temporary uploads cleaned after success, provider exception, invalid file and oversize stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-test-'));
  try {
    let retained;
    for (const scenario of ['success', 'provider-error', 'invalid', 'oversize']) {
      const bytes = scenario === 'invalid' ? Buffer.from('invalid') : wav();
      const metadata = { ...validateMetadata('x.wav', bytes.length), expectedSize: bytes.length };
      if (scenario === 'oversize') metadata.limit = 1;
      const work = withTemporaryUpload(Readable.from([bytes]), metadata, async upload => {
        retained = upload.bytes;
        if (scenario === 'provider-error') throw new Error('provider failed');
        assert.match(upload.filePath, /realcheck-upload-/);
        return 'complete';
      }, { tempRoot: root });
      if (scenario === 'success') assert.equal(await work, 'complete');
      else await assert.rejects(work);
      assert.deepEqual(await readdir(root), []);
      if (retained) assert.ok(retained.every(byte => byte === 0));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('cleanup runs after interrupted stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-test-'));
  try {
    const stream = Readable.from((async function* () { yield wav().subarray(0, 20); throw new Error('disconnect'); })());
    await assert.rejects(withTemporaryUpload(stream, { ...validateMetadata('x.wav', 3244), expectedSize: 3244 }, () => {}, { tempRoot: root }));
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a stalled upload times out, removes its partial file, and never calls a provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-timeout-test-'));
  let called = false;
  const stream = new Readable({ read() {} });
  stream.push(wav().subarray(0, 20));
  try {
    await assert.rejects(withTemporaryUpload(stream, validateMetadata('x.wav', 3244), () => {
      called = true;
    }, { tempRoot: root, timeoutMs: 30 }), /Upload timed out/);
    assert.equal(called, false);
    assert.equal(stream.destroyed, true);
    assert.deepEqual(await readdir(root), []);
  } finally { stream.destroy(); await rm(root, { recursive: true, force: true }); }
});

test('invalid metadata is rejected before consuming a body or creating temporary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'realcheck-metadata-test-'));
  const valid = validateMetadata('x.wav', 3244);
  let reads = 0;
  const stream = new Readable({ read() { reads++; this.push(null); } });
  try {
    for (const metadata of [{ ...valid, extension: '__proto__' }, { ...valid, extension: 'constructor' },
      { ...valid, limit: Infinity }, { ...valid, limit: 999999999 }, { ...valid, expectedSize: 999999999 }]) {
      await assert.rejects(withTemporaryUpload(stream, metadata, () => assert.fail('provider called'), { tempRoot: root }), /Invalid upload metadata/);
      assert.equal(reads, 0);
      assert.deepEqual(await readdir(root), []);
    }
  } finally { stream.destroy(); await rm(root, { recursive: true, force: true }); }
});

test('English rules return sourced exact spans, not a verdict or score', () => {
  const text = 'Please buy gift cards. Send me the verification code. Give me remote access. Transfer the money right away.';
  const result = checkTranscript(text, 'english');
  assert.equal(result.findings.length, 4);
  for (const finding of result.findings) {
    assert.equal(text.slice(finding.start, finding.end), finding.excerpt);
    assert.ok(finding.source.startsWith('https://consumer.ftc.gov/'));
  }
  assert.equal(result.verdict, undefined); assert.equal(result.score, undefined);
});
test('English rules suppress direct negations and skip non-English or unknown language', () => {
  assert.equal(checkTranscript("Never buy gift cards. Don't send me the verification code.", 'en').findings.length, 0);
  assert.equal(checkTranscript('Send me the verification code.', 'spanish').status, 'not_evaluated');
  assert.equal(checkTranscript('Send me the verification code.', null).status, 'not_evaluated');
  assert.match(checkTranscript('The meeting is tomorrow.', 'english').message, /does not establish/);
  assert.equal(checkTranscript('', 'english').status, 'not_evaluated');
});
test('fixtures never invoke live providers and remain labelled', async () => {
  const fail = () => { throw new Error('live called'); };
  for (const label of ['likely','unlikely','unclear','unavailable']) {
    const result = await analyze(audioUpload(), { mode: 'fixture', detectionFixture: label }, { detect: fail, transcribe: fail, fixtureDelay: 0 });
    assert.equal(result.fixture, true);
    assert.equal(result.transcription.status, 'complete');
    assert.ok(result.content.findings.length > 0);
    assert.equal(result.authenticity.status, label === 'unavailable' ? 'unavailable' : 'complete');
  }
});
test('detection failure preserves successful transcription and warning rules', async () => {
  const result = await analyze(audioUpload(), { mode: 'live' }, {
    detect: () => { throw new ProviderError('timeout'); },
    transcribe: async () => ({ text: 'Send me the verification code.', language: 'english' }),
  });
  assert.equal(result.fixture, false);
  assert.equal(result.authenticity.label, 'Analysis unavailable');
  assert.equal(result.transcription.status, 'complete');
  assert.equal(result.content.findings.length, 1);
});
test('transcription failure preserves detection and does not imply safe content', async () => {
  const result = await analyze(audioUpload(), { mode: 'live' }, {
    detect: async () => ({ label: 'Unclear' }),
    transcribe: () => { throw new ProviderError('http_429'); },
  });
  assert.equal(result.authenticity.label, 'Unclear');
  assert.equal(result.transcription.label, 'Analysis unavailable');
  assert.equal(result.content.status, 'not_evaluated');
});
test('images are never sent to transcription and live never falls back to fixtures', async () => {
  const result = await analyze({ metadata: { kind: 'image' } }, { mode: 'live', detectionFixture: 'unlikely' }, {
    detect: async () => { throw new Error('secret provider response'); },
    transcribe: async () => { assert.fail('image sent to Groq'); },
  });
  assert.equal(result.authenticity.label, 'Analysis unavailable');
  assert.equal(result.transcription.status, 'not_applicable');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('malformed transcription does not erase a valid detection or run request rules', async () => {
  for (const value of [null, [], {}, { text: 42 }, { text: 'hello', language: [] }, { text: 'x'.repeat(100001) }]) {
    const result = await analyze(audioUpload(), { mode: 'live' }, {
      detect: async () => ({ label: 'Unlikely deepfake' }),
      transcribe: async () => value,
    });
    assert.equal(result.authenticity.label, 'Unlikely deepfake');
    assert.equal(result.transcription.status, 'unavailable');
    assert.equal(result.transcription.code, 'invalid_response');
    assert.equal(result.content.status, 'not_evaluated');
    assert.equal(result.fixture, false);
  }
});

test('provider transcript extras cannot override application status or leak to the client', async () => {
  const result = await analyze(audioUpload(), { mode: 'live' }, {
    detect: async () => ({ label: 'Unclear' }),
    transcribe: async () => ({ text: 'Hello', language: 'english', status: 'unavailable', privateMetadata: 'not for client' }),
  });
  assert.deepEqual(result.transcription, { status: 'complete', text: 'Hello', language: 'english' });
});
test('live detection gate blocks unverified SDK contract even when a key exists', async () => {
  await assert.rejects(detectManipulation({}, 'test-only'), error => error.code === 'sdk_contract_unverified');
});
test('Groq sends only audio using documented Whisper multipart options', async () => {
  const result = await transcribeAudio(audioUpload(), 'test-only', {
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
      assert.equal(init.body.get('response_format'), 'verbose_json');
      assert.equal(init.body.has('language'), false);
      assert.equal(init.body.get('file').type, 'audio/wav');
      assert.ok(init.signal);
      return Response.json({ text: 'Good morning.', language: 'english', ignoredPrivateField: 'not returned' });
    },
  });
  assert.deepEqual(result, { text: 'Good morning.', language: 'english' });
});
test('Groq errors and malformed responses produce unavailable, never fabricated text', async () => {
  await assert.rejects(transcribeAudio(audioUpload(), ''), error => error.code === 'missing_key');
  for (const fetcher of [
    async () => new Response('private error', { status: 429 }),
    async () => Response.json({ text: 42 }),
    async () => new Response('not JSON'),
    async () => { throw new DOMException('timed out', 'TimeoutError'); },
  ]) {
    await assert.rejects(transcribeAudio(audioUpload(), 'test-only', { fetcher }), error => {
      assert.equal(error.message, 'Analysis unavailable');
      return true;
    });
  }
});
