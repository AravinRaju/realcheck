# Live verification checkpoint — 2026-09-07

Project: C:\Users\aravi\realcheck. Both private key variables load. No key values, uploaded media, or raw provider responses are recorded here.

## User-run website end-to-end check — 2026-09-07

The user confirmed that the live website works on port 3001. This is a
user-run end-to-end check of the website and backend, not an accuracy benchmark
or independent agent observation. No new raw provider responses, transcript,
recording, or performance measurements were supplied or recorded.

This supersedes the earlier port-3000 startup blocker for the working website.
Transcription remains unverified and requires user review/correction before
wording checks. Deepfake detection remains separate. Provider model/settings,
fixture isolation, and no automatic retry/fallback behavior are unchanged.
No provider calls were made by the agent to repeat the user's check.

## Current investigation: transcript accuracy and stale server — 2026-09-07

The user reports differing sentences and wording outcomes for the identical
recording. The earlier Groq success is evidence of API connectivity, not accuracy.
Transcription is now explicitly unverified and wording checks require local user
review/correction and confirmation. Detection remains independent and its
user-reported AUTHENTIC verification is retained for SDK 0.1.19.

The user identified port 3000 as PID 14860 and reported /api/config with
mode=fixture, detectionVerified=false, and both providers configured. That is
consistent with an older loaded server or another checkout, not the current
implementation with only its mode changed. The precise running path remains
unconfirmed because Windows denied agent process inspection. Browser permission
was declined; the agent did not bypass it or read the private UI transcript.

Offline interception using the supplied 13,794-byte Ogg recording confirmed
matching SHA-256 hashes for the original, temporary copy, Groq multipart audio,
and bytes passed to the installed SDK's upload transport. Zero external calls
were made and the original was unchanged. This establishes the inspected code
path, not bytes from historical live requests or the inaccessible selected tab.

The inspected checkout has no random/demo selection, live fixture fallback,
scam likelihood/score, automatic upload on refresh, or result cache. The provider
text is returned without rewriting. Previously wording checks ran immediately
on unreviewed text; this is fixed. The current request trace checks a selected
file hash, server upload hash, Groq input hash, raw returned text hash, and exact
rendered text against one request ID. RD also reports the temporary file hash
immediately before calling the pinned SDK. No raw response, transcript, recording
or hash is logged; evidence is request-local and discarded with the result.
The RD hash is an SDK-input check, not packet capture. Offline tests intercepted
the actual SDK upload method to verify that this version reads those bytes unchanged.

Groq settings remain whisper-large-v3-turbo, temperature=0, verbose_json, no prompt,
and no forced language. No local conversion or audio preprocessing occurs.
Ogg pages and Opus identification pass existing validation; full decoding was
not checked because ffmpeg/ffprobe are unavailable. No model/preprocessing changes,
LLM repair, repeated live scans, result caching, or hardcoded verdicts were added.

Read docs/server-restart.md for replacing only PID 14860 and checking the new
process, checkout, mode, and SDK readiness before any further upload.

## Historical connectivity check: user-run verification succeeded — 2026-09-07

The user reported successful manual live checks using the supplied WhatsApp Ogg
recording from Downloads:

- Reality Defender SDK 0.1.19 returned AUTHENTIC, mapped to Unlikely deepfake.
- Groq transcription succeeded with 57 transcript characters and English language.

These are user-reported results from the user's authorized terminal. The agent
did not execute these requests or independently inspect raw provider responses.
This verifies the reported AUTHENTIC path and successful transcription; it does
not establish accuracy or live coverage of other statuses, images, or UI uploads.

The installed adapter is enabled in live mode and both live-verification flags
are true. Fixture remains the default mode, with explicitly authored results,
no provider calls, and no fallback from live failures. The UI no longer says
manual verification is pending. See manual-verification.md for starting the
backend in live mode and testing one website upload. No agent network requests
or push were made. All checkpoints below are historical and superseded where
they describe installation or live verification as incomplete.

## Installation and access

### SDK implementation checkpoint — 2026-09-07

After the user installed the SDK locally, version 0.1.19 and the exact dependency
and lockfile pin were inspected. Its TypeScript result/options/error types and
installed formatter, polling, upload and Axios transport implementations were
reviewed. The user authorized implementing the adapter and deferring live
verification to manual commands. This supersedes the earlier implementation
gate below; it does not establish a successful provider response.

The adapter now maps only SDK overall MANIPULATED and AUTHENTIC, treats pending,
unknown and malformed results as unavailable, and runs RD in the bounded worker.
Fixture mode remains the default. No external network request was made in this
implementation session. Both providers still require manual live verification;
see manual-verification.md. Earlier checkpoints below are preserved as history.

### Continuation from 84c8bf1 — 2026-09-07

The checkout was clean at `84c8bf1`. One unauthenticated transport check per
service (GitHub, npm, Reality Defender, and Groq), each bounded to 8 seconds
with no application retries, failed with `fetch failed` / `EACCES`. No HTTP
response was received. Both private keys were confirmed configured without
printing their values. The supplied WhatsApp Ogg recording exists in Downloads
(13,794 bytes); it was not submitted or modified in this continuation.

The local SDK audit still reports the package absent. In accordance with the
user's instruction to stop after network failure, no npm installation or live
provider request followed these failed checks. No exact installed types or
actual detection/transcription responses are available to inspect; mapping
remains disabled. No secrets were printed, no network retries were made, and
no push was performed. This session's restricted network and approval policy
`never` provide no supported escalation path. Installation and live verification
remain blocked until backend network access is available.

The installation and provider attempts described below belong to the earlier
checkpoint, not this continuation.

One installation attempt, with npm retries disabled:

```powershell
npm.cmd install --save-exact @realitydefender/realitydefender --fetch-retries=0 --fetch-timeout=8000 --ignore-scripts --no-audit --no-fund
```

Exited 1 in approximately 1.1 seconds:

```text
npm error code EACCES
npm error errno EACCES
npm error FetchError: request to https://registry.npmjs.org/@realitydefender%2frealitydefender failed
code: 'EACCES', errno: 'EACCES', type: 'system'
```

Affected network hostname: registry.npmjs.org. The stack references npm's fetch implementation at C:\Program Files\nodejs\node_modules\npm\node_modules\minipass-fetch\lib\index.js:130:14; that is not an installation destination reporting a denied write. Earlier project/cache write checks succeeded and a direct TCP-443 check failed with EACCES on connect. Together with the current fetch failure, this indicates restricted outbound networking, not a project filesystem permission problem. No permissions were modified and no repeated installation attempts were made in this checkpoint.

The current session has approval policy "never" and no supported shell network-approval mechanism available. An app-connector permission request would not grant npm/backend network access. Installation and live verification require a session whose policy permits network access or a user-run terminal with access; this checkpoint cannot lift that restriction.

## Separate outcomes

- SDK installed/version verified: **No**. audit:sdk reports SDK absent; no actual installed TypeScript response types exist to inspect. Mapping remains gated, not approximated from Python or REST.
- Reality Defender live scan: **Not submitted**. The one-off scan command failed locally with sdk_missing. No detection response, verdict, or score exists.
- Groq live transcription: **Failed**. One request to https://api.groq.com/openai/v1/audio/transcriptions returned a transport EACCES, not an HTTP status. No transcript, quota determination, or successful analysis exists.
- Fixture mode: **Enabled**, unchanged. One-off commands explicitly bypass fixture mode to request live verification; failures never return fixtures.

Both commands used the user's authorized WhatsApp Ogg recording from Downloads via validated temporary copies. No retry was attempted and the original was not changed or committed. No further live calls were attempted after the transport failure.

## Verified scope and remaining gate

The 10 MB image cap is unchanged and labelled. Tests cover coordinated client/upload/provider budgets, HTTP 429 wording, numeric/date Retry-After parsing, cooldown without automatic retries, malformed responses, independent results, and temporary cleanup. A local HTTP test confirms a stalled response body is aborted; no external scans are used in tests.

The application boundary rejects missing, malformed, raw processing, and raw error objects as unavailable. This is not a verified SDK mapping. Documented terminal inconclusive statuses cannot be mapped until the exact installed TypeScript contract and first real scan response are inspected. The existing disabled RD adapter is intentionally retained.

No GitHub push was made. Remote history reconciliation and user approval are still required before any push.
