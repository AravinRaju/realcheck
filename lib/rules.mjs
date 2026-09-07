// English-only, deterministic phrase rules. Sources describe warning patterns,
// not this implementation's precision. This is not a scam classifier.
export const rules = [
  {
    id: 'gift-card-payment', title: 'Request involving gift-card payment',
    pattern: /\b(?:buy|purchase|pay(?:\s+me)?(?:\s+with)?|send(?:\s+me)?)\b[^.!?\n]{0,60}\bgift[\s-]+cards?\b/gi,
    guidance: 'Verify an unexpected payment request through a trusted contact method before paying.',
    source: 'https://consumer.ftc.gov/avoiding-reporting-gift-card-scams',
    sourceTitle: 'FTC: Avoiding and Reporting Gift Card Scams',
  },
  {
    id: 'verification-code', title: 'Request for a verification code',
    pattern: /\b(?:send|share|tell|give|read|forward)\b[^.!?\n]{0,45}\b(?:(?:verification|security|one[\s-]time|login|authentication)\s+(?:code|password)|otp)\b/gi,
    guidance: 'Keep account verification codes private. Contact the organization using a known number.',
    source: 'https://consumer.ftc.gov/consumer-alerts/2026/01/how-handle-unexpected-calls-claim-your-money-risk',
    sourceTitle: 'FTC: Unexpected calls claiming your money is at risk',
  },
  {
    id: 'remote-access', title: 'Request for remote access',
    pattern: /\b(?:(?:give|grant|allow|enable)\b[^.!?\n]{0,35}\bremote\s+access|(?:install|download)\s+(?:anydesk|teamviewer))\b/gi,
    guidance: 'Verify who is asking before allowing access to your device.',
    source: 'https://consumer.ftc.gov/articles/how-spot-avoid-and-report-tech-support-scams',
    sourceTitle: 'FTC: How To Spot, Avoid, and Report Tech Support Scams',
  },
  {
    id: 'urgent-transfer', title: 'Pressure to transfer money immediately',
    pattern: /\b(?:send|wire|transfer|pay)\b[^.!?\n]{0,50}(?:\b(?:money|funds|payment|dollars)\b|\$\s*\d+(?:,\d{3})*(?:\.\d{2})?\b)[^.!?\n]{0,40}\b(?:now|immediately|right away|urgent(?:ly)?)\b/gi,
    guidance: 'Pause and independently confirm the request before moving money.',
    source: 'https://consumer.ftc.gov/avoiding-reporting-gift-card-scams',
    sourceTitle: 'FTC: Avoiding and Reporting Gift Card Scams',
  },
];

export function checkTranscript(text, language) {
  if (typeof text !== 'string' || text.length > 100000) throw new TypeError('Invalid transcript.');
  if (!['english', 'en'].includes((language || '').toLowerCase())) {
    return { status: 'not_evaluated', findings: [], message: 'English-language rules only. This transcript was not checked because its language is unsupported or unknown.' };
  }
  if (!text.trim()) return { status: 'not_evaluated', findings: [], message: 'No transcript text is available to check.' };
  const findings = [];
  for (const rule of rules) {
    for (const match of text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      // Suppress common direct negations; quotes and broader context still need
      // human review. Preserve original indices for safe UI highlighting.
      const prefix = text.slice(Math.max(0, match.index - 100), match.index);
      if (/\b(?:do\s+not|never)\s*,?\s*under\s+any\s+circumstances\s*,?\s*$/i.test(prefix)) continue;
      if (/\b(?:do\s+not|don['’]t|never|not\s+to|should\s+not)\s+(?:ever\s+)?$/i.test(prefix)) continue;
      findings.push({ id: rule.id, title: rule.title, start: match.index, end: match.index + match[0].length,
        excerpt: match[0], guidance: rule.guidance, source: rule.source, sourceTitle: rule.sourceTitle });
      if (findings.length >= 30) break;
    }
  }
  findings.sort((a, b) => a.start - b.start);
  return { status: 'checked', findings: findings.slice(0, 30),
    message: findings.length ? 'Matched phrases are warning signs, not a scam verdict. Check the surrounding context.' :
      'No phrases matched these limited rules. This does not establish that the request is safe.' };
}
