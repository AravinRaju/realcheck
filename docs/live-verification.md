# Live verification checkpoint — 2026-09-07

Project: C:\Users\aravi\realcheck. Both private key variables load. No key values, uploaded media, or raw provider responses are recorded here.

## Installation and access

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
