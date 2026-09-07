import { checkTranscript } from '../lib/rules.mjs';

// Local, deterministic review only. Never calls a provider or rewrites speech.
export function createTranscriptReview(text, language, fixture = false) {
  if (typeof text !== 'string' || text.length > 100000) throw new TypeError('Invalid transcript.');
  let draft = text, confirmed = false;
  return {
    get original() { return text; },
    get draft() { return draft; },
    get confirmed() { return confirmed; },
    edit(value) {
      if (typeof value !== 'string' || value.length > 100000) throw new TypeError('Invalid transcript.');
      draft = value; confirmed = false;
    },
    confirm(value) { confirmed = value === true; },
    check() {
      if (!confirmed) return { status: 'not_evaluated', findings: [], message: 'Review and confirm the wording first.' };
      return { ...checkTranscript(draft, language), reviewed: true, fixture };
    },
  };
}
