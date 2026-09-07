import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptReview } from '../public/review.mjs';

test('wording checks require review; corrections revoke consent and preserve original', () => {
  const original = 'Send me the verification code.';
  const review = createTranscriptReview(original, 'english');
  assert.equal(review.check().status, 'not_evaluated');
  review.confirm(true);
  assert.equal(review.check().findings.length, 1);
  review.edit('Our meeting is tomorrow.');
  assert.equal(review.confirmed, false);
  assert.equal(review.check().status, 'not_evaluated');
  assert.equal(review.original, original);
  review.confirm(true);
  assert.equal(review.check().findings.length, 0);
  review.confirm(false);
  assert.equal(review.check().status, 'not_evaluated');
});
test('empty and unknown-language drafts are not evaluated even after confirmation', () => {
  for (const [text, language] of [['', 'english'], ['Send me the verification code.', null]]) {
    const review = createTranscriptReview(text, language);
    review.confirm(true);
    assert.equal(review.check().status, 'not_evaluated');
  }
});
test('fixture review remains labelled and new transcripts never inherit consent', () => {
  const example = createTranscriptReview('Send me the verification code.', 'english', true);
  example.confirm(true);
  assert.equal(example.check().fixture, true);
  const next = createTranscriptReview('Buy gift cards.', 'english');
  assert.equal(next.check().status, 'not_evaluated');
});
