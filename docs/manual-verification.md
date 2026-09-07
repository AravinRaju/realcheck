# Manual live verification

**User-run website check succeeded on port 3001 (2026-09-07).** This confirms
the reported end-to-end flow, not detection or transcription accuracy. The UI
marks transcription unverified and requires review/correction before wording
checks. Do not repeat provider calls automatically. The port-3000 restart steps
in server-restart.md are historical troubleshooting, not instructions to stop
the working port-3001 server.

Run these commands yourself in an authorized PowerShell terminal with provider
network access. SDK 0.1.19 is already installed and pinned. Keep both keys in the
existing private .env; do not put them in command arguments. These commands do
not change .env or the website's default fixture mode.

First perform the local checks:

```powershell
Set-Location -LiteralPath 'C:\Users\aravi\realcheck'
npm.cmd run check:env
npm.cmd run audit:sdk
npm.cmd test
npm.cmd run check
```

Run one Reality Defender detection:

```powershell
npm.cmd run scan:rd -- 'C:\Users\aravi\Downloads\WhatsApp Ptt 2026-09-07 at 1.39.05 PM.ogg'
```

Inspect its output before proceeding. `response_received` means a response was
returned, not necessarily a completed analysis. Review `sdkVersion`,
`providerStatus`, `responseFields`, and either `detection` or `error`.
MANIPULATED/AUTHENTIC map to the two supported verdicts. ANALYZING/DOWNLOADING
remain unavailable; an unfamiliar status is not interpreted as Unclear.
An error, malformed response, or unsupported status causes a nonzero exit code.
Do not rerun after a network failure. SDK transport failures can appear as
`unknown_error`; do not assume that code means a scan completed.

If the detection did not report a network/unknown transport failure, run one
Groq transcription as a separate command:

```powershell
npm.cmd run transcribe:groq -- 'C:\Users\aravi\Downloads\WhatsApp Ptt 2026-09-07 at 1.39.05 PM.ogg'
```

Inspect `outcome`, `language`, and `transcriptCharacters`. A succeeded outcome
means Groq returned a transcript accepted by the adapter. Transcript content is
not printed, so this summary does not establish transcription accuracy. Stop
on failure and do not retry. A 429 is a service limit, not proof of exhausted
quota; respect any printed retry delay before a separately authorized future run.

Both commands validate the Ogg audio, use and clean temporary copies, preserve
the original, suppress SDK diagnostics, and omit keys, request IDs, signed URLs,
and transcript text. No raw responses are saved. Each command has a 60-second
worker limit. RD can poll pending results up to 10 times, spaced 2 seconds apart;
it stops at the first failed request and does not re-upload. A timeout stops
local work but cannot undo a scan already submitted to the provider.

Save only redacted summaries as verification evidence. Share those summaries
before expanding the status mapping. The user has reported successful manual
checks: SDK 0.1.19 AUTHENTIC → Unlikely deepfake, and Groq succeeded with 57
characters in English. These user-run results are recorded in live-verification.md;
the agent did not independently inspect raw responses.

## Start live mode and test one website upload

Use your authorized PowerShell terminal. Stop an existing RealCheck server with
Ctrl+C first so the browser connects to the newly started live-mode process.

```powershell
Set-Location -LiteralPath 'C:\Users\aravi\realcheck'
$env:REALCHECK_MODE = 'live'
$env:PORT = '3000'
npm.cmd start
```

The process environment overrides the existing .env values without editing that
file. Keys continue to load privately from .env. Leave the terminal running and
open http://127.0.0.1:3000/ in your browser. Refresh an already open tab.

1. Confirm the banner says LIVE MODE and both providers are configured. Fixture
   scenario controls must be hidden. If the banner says FIXTURE MODE, stop here
   and check which server is running.
2. Select the WhatsApp Ogg recording from Downloads and wait for its preview.
3. Click **Check this file** once. This sends a new real upload to Reality Defender
   and Groq and may consume provider credits. Allow up to 105 seconds.
4. Inspect the separate authenticity and transcription panels. The prior manual
   run returned Unlikely deepfake and an English transcript of 57 characters;
   those are previous observations, not hardcoded or guaranteed website results.
   The sources should read REALITY DEFENDER and GROQ WHISPER, with no test-fixture
   labels. Content-rule findings are independent of authenticity.
5. If either service fails, preserve the displayed error and do not resubmit.
   A failed live request must not show authored fixture results.

Stop with Ctrl+C. For explicit fixture development, set
`$env:REALCHECK_MODE = 'fixture'` before `npm.cmd start` and refresh the page;
confirm FIXTURE MODE and its example selectors. No provider calls occur in that
mode. The environment assignments above affect this PowerShell session only.
