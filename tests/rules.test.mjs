import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTranscript } from '../lib/rules.mjs';

test('OTP and dollar-transfer requests are warnings while protective advice is suppressed', () => {
  for (const [text, id] of [['Send me your OTP', 'verification-code'], ['Transfer $500 now', 'urgent-transfer']]) {
    const result = checkTranscript(text, 'english');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, id);
    assert.equal(result.findings[0].excerpt, text);
    assert.match(result.message, /not a scam verdict/);
  }
  for (const text of ['Do not, under any circumstances, share your verification code.',
    'Do not send me your OTP.', 'Never transfer $500 now.']) {
    assert.equal(checkTranscript(text, 'english').findings.length, 0);
  }
  assert.equal(checkTranscript('Do not panic. Send me your OTP.', 'english').findings.length, 1);
});
