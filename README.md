# RealCheck

A local image/audio hackathon prototype with separate authenticity and suspicious-request panels.

The user confirmed the live website works on port 3001 (2026-09-07). This is
a user-run end-to-end check, not an accuracy benchmark. Transcription remains
unverified; wording checks require review/correction and explicit confirmation.

## Start

Canonical project location: C:\Users\aravi\realcheck. The destination's existing .git was retained. It had no commits or project files; the prototype's three commits were imported through a local Git fetch onto realcheck-consolidated, with prototype-import retaining the imported tip. All tracked files were verified (allowing Git's line-ending normalization), and the ignored .env was privately copied and verified byte-for-byte. C:\Users\aravi\Documents\realcheck is retained as a backup. No push was performed.

Requires Node.js 22.13 or newer. Reality Defender SDK 0.1.19 is installed and pinned in package.json and package-lock.json. On a fresh checkout, install the lockfile dependencies with npm ci in an authorized environment.

    npm start

Open http://127.0.0.1:3000/ . The server binds only to this computer. Stop with Ctrl+C.
Use PORT in the local environment configuration if port 3000 is occupied.

## Private configuration

Open C:\Users\aravi\realcheck\.env privately. Both keys now load; their values have not been printed or committed. A fresh checkout uses these placeholders from .env.example:

    REALITY_DEFENDER_API_KEY=
    GROQ_API_KEY=
    REALCHECK_MODE=fixture
    PORT=3000

Enter keys after the equals signs in that local file, then restart the server. Do not paste keys in chat, source code, screenshots, or Git. The backend loads .env from its own project directory, even when started from a different directory. Existing process environment values take precedence.

.env, .env.local, other actual environment files, uploads, verification artifacts, and media extensions are ignored by Git. Only the placeholder .env.example is committed. For a fresh checkout, copy .env.example to .env only if .env does not already exist; do not overwrite an existing file.

REALCHECK_MODE is chosen on the server. Keep it as fixture during development. Setting live enables the installed SDK adapter and Groq transcription. The user reported successful manual live verification of both providers on 2026-09-07; failed requests never use fixtures.

## What works

- Drag/drop or file selection; one JPG/JPEG, PNG, WebP, MP3, WAV, FLAC, or Ogg (Opus/Vorbis audio).
- Local image or audio preview; keyboard-accessible upload controls.
- Server validation of filename, extension, MIME, byte signatures/headers, and size.
- Images limited to 10 MiB and audio to 20 MiB. PNG dimensions are bounded on the server; browser image previews are limited to 40 million pixels. Header validation is not a complete media decoder.
- Temporary per-request files, generated filenames, and awaited cleanup on success, invalid content, interrupted upload, and provider errors.
- Uploads must finish within 30 seconds; slow connections can still fail. The 105-second client budget includes request receipt (35 seconds), a provider-worker ceiling (60 seconds), and response/cleanup margin (10 seconds). It does not extend the upload cap.
- Explicit fixture mode with independent detection/transcription scenario selectors.
- Separate authenticity, transcription, and English-rule results.
- Independent provider failures, including transcription succeeding when detection fails.
- Fulfilled transcription output is validated before rules run; malformed text/language is independently unavailable. Allowed authenticity labels live in lib/results.mjs, separate from fixtures; the RD adapter maps only the two overall verdict statuses evidenced by the installed SDK.
- Groq Whisper REST adapter using the documented transcription endpoint; covered by stubbed HTTP tests and a user-reported successful live transcription (57 characters, English).
- FTC-sourced phrase rules that show exact matched text, context guidance, and a source link. No scam score or scam verdict.
- Backend environment loading, no-store responses, a restrictive Content Security Policy, same-origin browser uploads, and a strict static-file allowlist.

No accounts, payments, video, or dashboards are included.

## What is mocked or disabled

Default fixture mode uses authored result labels and authored transcripts, explicitly labelled as examples unrelated to the uploaded file. It never contacts either provider. The file still passes real upload validation and temporary-file cleanup.

Reality Defender detection is implemented against the exact installed TypeScript SDK 0.1.19. MANIPULATED maps to Likely deepfake; AUTHENTIC maps to Unlikely deepfake. Pending, unknown, malformed, and error results are unavailable. Scores and individual models never determine the verdict. The user verified AUTHENTIC → Unlikely deepfake live with SDK 0.1.19; fixture remains the default mode.

Groq connectivity was user-verified (57 characters, English), but transcription accuracy is UNVERIFIED following reports of invented sentences. Listen to the original preview, correct only speech you can hear, and explicitly confirm the draft before running wording checks. With live mode, a key, and working network access, audio is submitted to Groq. Missing keys, network failures, provider errors, and malformed responses remain separate from authenticity. Images never go to Groq. A failed live request never uses a fixture.

## Provider contracts and manual live verification

Read docs/provider-contracts.md for the installed contract and docs/manual-verification.md for exact commands using the authorized WhatsApp Ogg recording. Both private keys previously loaded without printing values. No external request was made while implementing this adapter.

    npm run audit:sdk
    npm run check:env

The one-off commands use temporary copies, preserve originals, suppress SDK stdout/stderr, and print sanitized response summaries without keys, signed URLs, request IDs, or transcript text. Reality Defender prints its actual overall status and field types, plus the adapter result. Groq prints language and transcript length. No raw responses are persisted. Each worker has a 60-second ceiling; RD polls at most 10 times at 2-second intervals and stops on the first request error. Polling pending results is not a retry of a failed request.

Only MANIPULATED and AUTHENTIC are mapped. The installed status type is an open string; no terminal inconclusive status is established by this contract. Unknown statuses remain unavailable until their meaning is verified. No score threshold is used. Earlier failed network attempts are preserved in docs/live-verification.md as historical checkpoints.

## Transcript rules

Rules run in the browser only after user review/correction and explicit confirmation of the draft. Every edit clears confirmation and previous findings. The original provider text and selected audio remain available for comparison; no LLM repairs or reconstructs speech. Fixtures require review too and remain labelled as authored examples. Rules look for a limited set of English requests involving gift-card payment, account verification codes, remote access, or an immediate money transfer. Each match links to an FTC source.

The sources describe warning signs; they do not validate this regex implementation. Matches can be false positives (including quoted or educational material), and requests can evade the rules. Common direct negations are suppressed, but context and intent are not inferred. No match does not mean safe. Non-English, unknown-language, and empty transcripts are not evaluated. Transcription mistakes can affect matching. See docs/rule-sources.md.

## Where media goes

- Fixture mode: this local server only. No external provider receives media.
- Live image checks: Reality Defender only, when its key is configured.
- Live audio checks: Groq receives the audio for Whisper transcription when configured. Reality Defender also receives audio when its key is configured.
- Rule checks: local processing of transcript text; no additional provider receives it.

Each upload lives in a generated operating-system temporary directory while that request runs, then is removed in finally. Application byte buffers are cleared afterward. Browser object URLs are revoked on replacement/page exit. There is no upload history or transcript database. An abrupt OS/process termination can prevent finally from running; remove abandoned realcheck-upload-* directories from the OS temporary folder only after confirming no RealCheck process is using them. Provider retention is outside RealCheck's local cleanup.

## Verify

    npm test
    npm run check
    npm run audit:sdk

Tests use generated in-memory media and deterministic service stubs; no scans or transcription credits are consumed. Tests cover validation, cleanup, environmental configuration, independent failures, fixture isolation, rule matches and negations, Groq request shape, malformed responses, and actual local HTTP requests.

npm run audit:sdk reports installed SDK 0.1.19 and its exact declarations. Local tests do not establish live provider success.

The browser automation runtime could not start in this environment (system path not found), so interactive visual verification is not claimed. The HTTP routes, syntax, and frontend element wiring are checked. Manually try a valid image/audio upload, each fixture scenario, file replacement, a non-media file, and a narrow viewport.

## Historical repository and access blockers

The prototype was initially built in an isolated offline repository because the supplied working directory was C:\Users\aravi (not a checkout and not writable for project creation). It is now consolidated into C:\Users\aravi\realcheck without replacing that repository's .git. The destination had an unborn main branch and no history or existing project files. The GitHub repository has not been fetched over the network, so any remote history still needs reconciliation before a push. Do not force-push.

On 2026-09-07, one bounded 8-second transport probe per service returned fetch failed / EACCES for:
- GitHub: github.com/AravinRaju/realcheck.git/info/refs?service=git-upload-pack
- npm: registry.npmjs.org/@realitydefender%2frealitydefender
- Reality Defender: api.prd.realitydefender.xyz/api/files/aws-presigned
- Groq: api.groq.com/openai/v1/audio/transcriptions

Those initial probes preceded key configuration. Both keys are now configured, but the later authenticated Groq attempt still failed with EACCES. Documentation is accessible through the separate documentation browser, which does not provide backend network access. This session disables approvals, so the requested network-approval flow cannot be invoked here. No system permissions were changed.

npm run check:access reruns one bounded transport probe per service, with no credentials and no media. HTTP 401, 403, or 405 means the host is reachable, not that credentials are valid.

Completed milestones are committed locally on realcheck-consolidated. No push has been made. When GitHub access is available, inspect and reconcile remote history and verify again. Ask the user before pushing anything to GitHub. The SDK was subsequently installed by the user and inspected locally; the user then reported successful live detection and transcription from their authorized terminal. The agent did not independently inspect raw responses or make further external requests. No Python SDK schema is substituted.
