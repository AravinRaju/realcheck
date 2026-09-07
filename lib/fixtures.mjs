// Deliberately authored UI examples, NOT captured provider responses.
// No scores and no media-dependent claims. Never imported by provider adapters.
export { verdictLabels as fixtureLabels } from './results.mjs';
export const fixtureTranscripts = Object.freeze({
  warning: { text: 'Please buy gift cards and send me the verification code. Transfer the money right away.', language: 'english' },
  ordinary: { text: 'Our meeting is at ten tomorrow. Please bring your notes so we can review the agenda.', language: 'english' },
  nonenglish: { text: 'La reunión es mañana a las diez.', language: 'spanish' },
  empty: { text: '', language: 'english' },
});
