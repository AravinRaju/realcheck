# RealCheck

A local image/audio hackathon prototype with separate authenticity and suspicious-request panels.

## Start

Requires Node.js 22.13 or newer. There are no npm dependencies or install step for the offline prototype.

    npm start

Open http://127.0.0.1:3000/ . The server binds only to this computer. Stop with Ctrl+C.
Use PORT in the local environment configuration if port 3000 is occupied.

## Private configuration

Open the .env file at the root of this project. It already contains blank placeholders:

    REALITY_DEFENDER_API_KEY=
    GROQ_API_KEY=
    REALCHECK_MODE=fixture
    PORT=3000

Enter keys after the equals signs in that local file, then restart the server. Do not paste keys in chat, source code, screenshots, or Git. The backend loads .env from its own project directory, even when started from a different directory. Existing process environment values take precedence.

.env, .env.local, other actual environment files, uploads, verification artifacts, and media extensions are ignored by Git. Only the placeholder .env.example is committed. For a fresh checkout, copy .env.example to .env only if .env does not already exist; do not overwrite an existing file.

REALCHECK_MODE is chosen on the server. Keep it as fixture during development. Setting live does not enable the blocked Reality Defender adapter and does not substitute fixtures for failed requests.

## What works

- Drag/drop or file selection; one JPG/JPEG, PNG, WebP, MP3, WAV, or FLAC.
- Local image or audio preview; keyboard-accessible upload controls.
- Server validation of filename, extension, MIME, byte signatures/headers, and size.
- Images limited to 10 MiB and audio to 20 MiB. PNG dimensions are bounded on the server; browser image previews are limited to 40 million pixels. Header validation is not a complete media decoder.
- Temporary per-request files, generated filenames, and awaited cleanup on success, invalid content, interrupted upload, and provider errors.
- Explicit fixture mode with independent detection/transcription scenario selectors.
- Separate authenticity, transcription, and English-rule results.
- Independent provider failures, including transcription succeeding when detection fails.
- Groq Whisper REST adapter using the documented transcription endpoint; request/response handling verified with stubbed HTTP responses only.
- FTC-sourced phrase rules that show exact matched text, context guidance, and a source link. No scam score or scam verdict.
- Backend environment loading, no-store responses, a restrictive Content Security Policy, same-origin browser uploads, and a strict static-file allowlist.

No accounts, payments, video, or dashboards are included.

## What is mocked or disabled

Default fixture mode uses authored result labels and authored transcripts, explicitly labelled as examples unrelated to the uploaded file. It never contacts either provider. The file still passes real upload validation and temporary-file cleanup.

Reality Defender LIVE DETECTION IS DISABLED. No SDK could be installed or inspected in this environment, and no real scan completed. The detection adapter returns Analysis unavailable; it does not map REST statuses, SDK statuses, model scores, or invented thresholds.

Groq live transcription is implemented but NOT live-verified. With live mode, a key, and working network access, audio is submitted to Groq. Missing keys, network failures, provider errors, and malformed responses remain separate from authenticity. Images never go to Groq. A failed live request never uses a fixture.

## Provider contracts and first live verification

Read docs/provider-contracts.md for official sources and the exact unresolved verification gate.

    npm run audit:sdk

This prints the installed Reality Defender package version and relevant declaration files, or clearly reports that no SDK is installed. It does not enable detection. When npm access is restored, install and pin the official SDK, inspect those exact declarations, and verify one real scan before implementing the status mapping. Save only a redacted verification note in source control; raw responses and uploaded files stay in the ignored verification directory.

No Gemini schema, score threshold, synthetic confidence percentage, or generated forensic explanation is used.

## Transcript rules

Rules run locally on the Groq transcript. They look for a limited set of English requests involving gift-card payment, account verification codes, remote access, or an immediate money transfer. Each match links to an FTC source.

The sources describe warning signs; they do not validate this regex implementation. Matches can be false positives (including quoted or educational material), and requests can evade the rules. Common direct negations are suppressed, but context and intent are not inferred. No match does not mean safe. Non-English, unknown-language, and empty transcripts are not evaluated. Transcription mistakes can affect matching. See docs/rule-sources.md.

## Where media goes

- Fixture mode: this local server only. No external provider receives media.
- Live image checks: intended for Reality Defender only, but no image leaves this prototype while its detection adapter is disabled.
- Live audio checks: Groq receives the audio for Whisper transcription when configured. Reality Defender will also receive audio only after its adapter is verified and enabled.
- Rule checks: local processing of transcript text; no additional provider receives it.

Each upload lives in a generated operating-system temporary directory while that request runs, then is removed in finally. Application byte buffers are cleared afterward. Browser object URLs are revoked on replacement/page exit. There is no upload history or transcript database. An abrupt OS/process termination can prevent finally from running; remove abandoned realcheck-upload-* directories from the OS temporary folder only after confirming no RealCheck process is using them. Provider retention is outside RealCheck's local cleanup.

## Verify

    npm test
    npm run check
    npm run audit:sdk

Tests use generated in-memory media and deterministic service stubs; no scans or transcription credits are consumed. Tests cover validation, cleanup, environmental configuration, independent failures, fixture isolation, rule matches and negations, Groq request shape, malformed responses, and actual local HTTP requests.

npm run audit:sdk currently reports an expected blocker because the SDK is absent.

The browser automation runtime could not start in this environment (system path not found), so interactive visual verification is not claimed. The HTTP routes, syntax, and frontend element wiring are checked. Manually try a valid image/audio upload, each fixture scenario, file replacement, a non-media file, and a narrow viewport.

## Repository and access blockers

This is an isolated offline Git repository because the supplied working directory was C:\Users\aravi (not a checkout and not writable for project creation). The requested GitHub repository could not be cloned. Its origin is recorded as https://github.com/AravinRaju/realcheck.git, but its existing files/history have NOT been fetched or reconciled. Do not force-push this branch over an existing repository.

On 2026-09-07, one bounded 8-second transport probe per service returned fetch failed / EACCES for:
- GitHub: github.com/AravinRaju/realcheck.git/info/refs?service=git-upload-pack
- npm: registry.npmjs.org/@realitydefender%2frealitydefender
- Reality Defender: api.prd.realitydefender.xyz/api/files/aws-presigned
- Groq: api.groq.com/openai/v1/audio/transcriptions

Neither key was configured when checked. Documentation was accessible through the separate documentation browser, which does not provide backend network access.

npm run check:access reruns one bounded transport probe per service, with no credentials and no media. HTTP 401, 403, or 405 means the host is reachable, not that credentials are valid.

Completed milestones are committed locally. No push has been made. Once an actual checkout is available, reconcile/cherry-pick the source changes against its history and verify again. Ask the user before pushing anything to GitHub.
