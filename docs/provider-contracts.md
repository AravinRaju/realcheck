# Provider contract evidence

Reviewed 2026-09-07. This document distinguishes official documentation from an installed SDK contract and from a live response.

## Reality Defender

Official sources:
- https://docs.realitydefender.com/sdks/quickstart
- https://docs.realitydefender.com/api-reference/quickstart
- https://docs.realitydefender.com/api-reference/endpoint/get_media_detail

The documented REST upload flow obtains a signed upload URL, uploads file bytes, and polls the media detail endpoint. Authentication uses X-API-KEY. The documentation recommends ensemble results. Media Detail documents resultsSummary and processing statuses; the SDK documentation also describes normalized SDK values. These are not interchangeable schemas.

Installed SDK: absent. Exact installed TypeScript declarations: not verifiable.
Real scan response: none; backend transport failed with EACCES.

Consequently lib/providers.mjs deliberately has no RD status-to-verdict mapping and no score threshold. Supplying a key or selecting live mode cannot bypass the gate. Analysis unavailable is returned until the integration is verified.

To unblock:
1. Access the actual target repository and install/pin the official package @realitydefender/realitydefender.
2. Run npm run audit:sdk and read the exact installed exported status/result types and polling/error contract.
3. Use one authorized image or audio sample to complete a real SDK scan with bounded timeout. Inspect the actual result, including ensemble status, pending states, and failure handling. Do not print credentials, signed storage URLs, or identity metadata.
4. Implement mapping from the verified status contract to the three permitted authenticity labels. Treat service errors separately. Add tests for every supported terminal state, pending state, missing/malformed response, and timeout; no invented score thresholds.
5. Record the installed package version and a redacted response shape as evidence. Keep media and raw responses ignored.

## Groq

Official sources:
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/api-reference

Uses the documented REST endpoint https://api.groq.com/openai/v1/audio/transcriptions with Bearer authentication and multipart file, model=whisper-large-v3-turbo, response_format=verbose_json, and temperature=0.

This prototype uses native Node fetch/FormData/Blob; it does not install or assume a Groq SDK schema. The adapter requires a string text field and accepts an optional string language field. Missing/unknown language skips English rules. Extra provider fields are discarded. No language is forced and no translation is requested.

The JSON contract and multipart request are covered by stubbed-response tests. No actual Groq transcription completed: key absent and endpoint transport blocked. Live behavior must still be checked with a real audio sample when access is restored.

## Application output

authenticity contains one permitted label, or status=unavailable with label=Analysis unavailable.
transcription independently contains text/language, not_applicable for images, or unavailable.
content contains rule findings with exact spans and source links, or not_evaluated.
fixture=true is mandatory for the authored UI examples. Live mode never returns fixture content.

No authenticity score, scam score, combined risk score, or generated explanation exists.
