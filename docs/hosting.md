# Hosted demo: Render Free + Upstash Redis Free

Repository: AravinRaju/realcheck, branch realcheck-consolidated. Starting local HEAD
was 70fa7c9f959da1e9cc485f17fbedab6e2fc9bf68 and Git was clean. The user reports
that commit deployed at https://realcheck-nx9y.onrender.com, with the custom domain
https://realchecknow.xyz working. Do not change DNS or TLS. This quota change has
not been pushed or deployed. Hosted provider calls remain unverified.

The user has now run init:quota successfully against real Upstash Redis and
check:quota confirmed the production ledger is reachable and valid. This covers
the real Redis verification suite from the user's terminal; Render runtime
connectivity and hosted provider calls remain pending. Do not initialize again
as part of deployment.

The last user-reported hosted config has mode=live, scansEnabled=false,
detectionReady=true, detectionEnabled=false, detectionConfigured=true,
transcriptionConfigured=true, transcriptionReviewRequired=true.

## Storage decision (official documentation checked 2026-09-07)

Use **Upstash Redis Free**, via Node's built-in fetch and the Redis REST API.
No application dependency is added. [Render Free](https://render.com/docs/free)
has ephemeral files, cannot attach persistent disks, and its free Key Value
service also loses data on restart.

Upstash's [current pricing](https://upstash.com/pricing/redis) lists one Free
database, 256 MB data, 500,000 commands/month and 10 GB/month bandwidth. Normal
demo usage is small, but rejected requests and internal Lua commands also consume
service budget. Exhaustion must block scans, not trigger a paid upgrade. The older
FAQ still mentions 10,000 requests/day; confirm the current pricing in your console.

[Persistence](https://upstash.com/docs/redis/features/durability) is always enabled:
writes go to memory and cloud block storage. Free lacks paid replica redundancy.
The [FAQ](https://upstash.com/docs/redis/help/faq) says free databases are archived
after at least 30 idle days, with warning emails and backed-up data that can be
restored. This is persistent demo storage, not an uptime SLA. Unavailable storage
blocks scans. Restore existing data; never silently reset a missing budget.

Keep [eviction](https://upstash.com/docs/redis/features/eviction) disabled (default).
Do not delete, expire, flush, rename or manually edit `realcheck:quota:v1`.
Every process and both clients must use the same database and key.

## Quota behavior

- One [atomic Lua EVAL](https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http)
  checks quota and grants the lease. One JSON key and one final SET avoid partial
  lock/quota commits. [Upstash script locking](https://upstash.com/docs/redis/features/key-locking)
  serializes concurrent callers. No separate GET/SET admission or local fallback.
- Global ceilings: **5 admitted attempts per rolling hour, 20 per rolling 24 hours**.
  Environment settings may lower these limits, never raise them. Redis TIME avoids
  per-process clock skew. State holds only bounded timestamps and lease metadata.
- One active scan receives a **120-second lease**. Busy, over-quota and unauthorized
  requests do not consume attempts. Admitted invalid uploads, provider failures,
  disconnects and crashes do. No refunds and no automatic retries.
- After upload validation, a second EVAL requires the same owner and at least
  75 seconds remaining before providers start. Upload receipt is capped at
  30 seconds, the SDK worker at 60 seconds and Groq at 50 seconds. The SDK worker
  also exits on parent disconnect and has its own watchdog. A crashed lease
  recovers after at most two minutes; its attempt remains counted. This gates
  application work, not cancellation of requests already received by providers.
- Release follows awaited cleanup and matches the owner, so stale requests cannot
  release a replacement lease. Failed release leaves the lease until its deadline.
  REST calls have five-second timeouts, no redirects and no retries. An ambiguous
  admission reply blocks provider dispatch even if the attempt committed.
- Missing, malformed, expiring, clock-inconsistent or unavailable state fails closed.
  The server never initializes storage on startup/admission. Old usage.json and
  REALCHECK_STATE_DIR are no longer used; they are not migrated or deleted.
- The existing /api/config schema stays unchanged. Enabled hosted live mode checks
  storage readiness; failed readiness makes scansEnabled/detectionEnabled false.
  With the public switch false, config stays disabled without contacting Redis.
  Admission independently checks storage on every request.

No media, filenames, transcripts, IPs or secrets enter the ledger. Temporary uploads
still use temporary disk and awaited cleanup. Exact-origin authorization, separate
provider results and mandatory transcript review remain intact.

## 1. Create the free database in your dashboard

No resources were created by this code change. These are user-run setup steps.

1. Sign in to [Upstash Console](https://console.upstash.com), select **Redis**, click
   **Create Database**, and name it `realcheck-quota`.
2. Select the **Primary Region** nearest your existing Render service's region.
   Add no read regions. Click **Next**, select **Free ($0)** and create it. If Free
   is unavailable, stop; do not select paid resources or add a card for an upgrade.
   Do not use the temporary anonymous database API.
3. In **Details / Connect**, choose **REST / HTTPS**. Privately copy
   UPSTASH_REDIS_REST_URL and the full read/write UPSTASH_REDIS_REST_TOKEN.
   Use neither the Readonly Token nor the redis:// TCP URL. The REST URL must be
   an exact `https://<database>.upstash.io` origin.
4. Confirm Free and eviction disabled. Keep auto-upgrade disabled if shown.

Official [creation steps](https://upstash.com/docs/redis/overall/getstarted) and
[REST connection fields](https://upstash.com/docs/redis/features/restapi).

## 2. Verify and initialize from your PowerShell

Use a fresh terminal. Local quota commands now load the repository .env (even
from another working directory); existing process variables take precedence.
Production never loads .env. These commands do not edit .env, contact providers,
push or deploy. If real credentials are already saved privately in .env, run
`node scripts/verify-quota.mjs configuration` for a network-free configured/missing
report, then `npm.cmd run check:quota` for a read-only ledger check. A placeholder
token is reported as missing. To supply credentials temporarily instead, use:

```powershell
Set-Location C:\Users\aravi\realcheck
$env:REALCHECK_PUBLIC_LIVE_ENABLED = 'false'
$env:UPSTASH_REDIS_REST_URL = Read-Host 'Upstash REST HTTPS URL'
$quotaSecret = Read-Host 'Upstash read/write REST token' -AsSecureString
$env:UPSTASH_REDIS_REST_TOKEN = [System.Net.NetworkCredential]::new('', $quotaSecret).Password
npm.cmd run init:quota
if ($LASTEXITCODE -ne 0) { throw 'Quota setup failed; keep scans disabled.' }
npm.cmd run check:quota
if ($LASTEXITCODE -ne 0) { throw 'Quota check failed; keep scans disabled.' }
```

init:quota first runs the actual Lua on a random verification key: eight concurrent
clients, hourly/daily windows, new-client continuity, crash recovery, stale release,
guard expiry, corruption, missing state, unexpected TTL and clock rollback. It
cleans only its test key. Forced termination may leave a small
`realcheck:verify:<uuid>` key; remove only that key when no verifier is using it.

Only after the real tests pass does it **SET NX** the production ledger; rerunning
preserves existing attempts and leases. check:quota checks production state without
admitting an attempt. verify:quota repeats the isolated suite without initializing
production. These commands import no providers. Never use init to recover lost
production usage: restore data, or keep scans disabled for at least 24 hours after
the last possible admission before explicitly initializing a replacement.

Close this terminal afterward or clear its temporary credentials:

```powershell
Remove-Item Env:UPSTASH_REDIS_REST_TOKEN, Env:UPSTASH_REDIS_REST_URL, Env:REALCHECK_PUBLIC_LIVE_ENABLED -ErrorAction SilentlyContinue
Remove-Variable quotaSecret -ErrorAction SilentlyContinue
```

The agent shell's probe to https://registry.npmjs.org/fengari failed with
`fetch failed / EACCES`; separate documentation browsing worked. No package was
installed. After the configuration and Lua fixes, the user ran init:quota and
check:quota successfully from normal PowerShell. The agent has not independently
run that external verification. Offline stub tests alone do not establish live
storage correctness.

Quota CLI failures report only a sanitized stage: configuration, network (with
allowlisted error code), request error (HTTP number and fixed category), Lua
execution (compile/runtime), missing ledger, or ledger validation.
No token, header, raw response, assertion payload or endpoint is
printed. A missing production ledger fails validation; check:quota never resets
or initializes it. Keep public scans disabled while diagnosing failures.

### Read-only HTTP 400 diagnosis

The quota script used `s.until`, which is invalid Lua because `until` is a reserved
keyword. It now uses `s["until"]`, preserving the existing JSON field/data format.
See [Lua lexical conventions](https://www.lua.org/manual/5.1/manual.html#2.1).
The previous HTTP handler also discarded error envelopes before classification;
it now reads them privately and maps recognized errors to fixed labels only.

The request matches [Upstash's REST contract](https://upstash.com/docs/redis/features/restapi):
POST to the HTTPS origin root, application/json, one JSON array in the body,
and bearer authorization in the header. No command or token is added to the URL.
Runtime checks use `["EVAL", script, "1", "realcheck:quota:v1", "check"]`:
numkeys is 1, KEYS[1] is the ledger key, ARGV[1] is check. The original check
branch returned before SET, but compilation parses the entire script first.
The CLI check now uses EVAL_RO with the same arguments so Redis enforces no writes.
Runtime admission/guard/release remain EVAL for atomic leader-side coordination.
EVAL_RO checks are point-in-time reads, not proof of write permission or a
replacement for the separately authorized real admission test suite.

In normal PowerShell, with the existing private .env:

```powershell
Set-Location C:\Users\aravi\realcheck
$env:REALCHECK_PUBLIC_LIVE_ENABLED = 'false'
npm.cmd run diagnose:quota
```

This performs at most four requests, stopping on the first failure: PING,
EVAL_RO key/argument echo, EVAL_RO full quota-script compilation with an early
return before ledger access, then EVAL_RO existing-ledger validation. Only fixed
pass/failure messages are printed. No SET, DEL, initialization or provider call
is performed. An absent ledger returns a distinct internal result mapped to
`missing ledger`; the CLI does not suggest or perform an automatic reset.
HTTP 400 alone cannot distinguish syntax, unsupported command or execution
failure; unknown upstream errors are labelled unclassified request rejections.

## 3. Prepare Render variables without deploying

Open the existing realcheck service in [Render Dashboard](https://dashboard.render.com),
choose **Environment**, then **Edit / Add Environment Variable**. Set the following
and choose the dropdown **Save only**. Do not choose either deploy option.
[Save only does not deploy](https://render.com/docs/configure-environment-variables).

```text
NODE_ENV=production
REALCHECK_PUBLIC_ORIGIN=https://realchecknow.xyz
HOST=0.0.0.0
REALCHECK_MODE=live
REALCHECK_PUBLIC_LIVE_ENABLED=false
REALCHECK_DAILY_LIMIT=20
REALCHECK_HOURLY_LIMIT=5
REALCHECK_EXTENSION_ID=lbfnfcfbfiedpcihlklplieolhffpiol
UPSTASH_REDIS_REST_URL=<your exact HTTPS REST origin>
UPSTASH_REDIS_REST_TOKEN=<your private read/write REST token>
```

Keep REALITY_DEFENDER_API_KEY and GROQ_API_KEY privately in the server environment;
do not expose or unnecessarily re-enter them. Leave PORT supplied by Render.
Remove obsolete REALCHECK_STATE_DIR from saved settings; no persistent disk is
needed. Keep the service Free. Leave DNS/custom-domain/TLS settings alone.
Save only does not change the running service until a later authorized deploy.

Keep Node 22.13+ and one service instance. For the first hosted release use the
read-only verification start command below. Local `npm start` is unchanged. Shared quota
also coordinates overlapping new-code processes. Never overlap enabled old disk
ledger code with enabled new code. Do not upload .env, media or private archives.

## 4. Hosted extension build (no upload or deployment)

```powershell
Set-Location C:\Users\aravi\realcheck
$env:REALCHECK_EXTENSION_BACKEND = 'https://realchecknow.xyz'
npm.cmd run build:extension
Remove-Item Env:REALCHECK_EXTENSION_BACKEND
```

At chrome://extensions, reload the existing unpacked extension at
`C:\Users\aravi\realcheck\extension`, then close/reopen the panel. Keep the same
folder to preserve its ID and verify **lbfnfcfbfiedpcihlklplieolhffpiol**. Allow the
selected site's access if Chrome asks. Only the selected hosted backend is included
in the generated manifest, CSP and client. Provider keys are never build inputs.
Opening the panel sends only a body-free config POST, not media. Keep scans disabled.
A terminal GET config cannot verify Chrome's actual extension authorization.

Return the same extension to the existing local backend:

```powershell
$env:REALCHECK_EXTENSION_BACKEND = 'http://127.0.0.1:3001'
npm.cmd run build:extension
Remove-Item Env:REALCHECK_EXTENSION_BACKEND
```

Reload Chrome. In a fresh shell, existing ignored .env and `npm start` remain
available; no Redis is required without a public origin. Do not start a second
server on an occupied port. Preparation left generated extension assets on localhost.

## Deployment and hosted verification (no push or deploy performed here)

1. Obtain push/deployment authorization. Keep public scans false for the first
   release of this code and retain the same Upstash database/key.
2. In the existing Render service's Settings, use Build Command
   `npm ci --omit=dev` and Start Command
   `npm run diagnose:quota && npm start`. Keep NODE_ENV=production,
   REALCHECK_MODE=live and REALCHECK_PUBLIC_LIVE_ENABLED=false in Environment,
   with the existing private Upstash variables. Do this only for the authorized
   release; no dashboard setting has been changed here. The start command runs
   in the deployed service runtime, not the build environment. A failed check
   prevents that new instance starting; it never enables scans or resets data.
   [Render start command](https://render.com/docs/deploys#start-command).
   [Render Free has no dashboard shell](https://render.com/docs/ssh).
   The diagnostic executes PING and EVAL_RO only, without admitting any scan.
   Do not use init:quota or verify:quota in the deploy command.
   In the deploy/runtime logs for this commit, require these messages followed
   by the normal server-listening message:

   ```text
   REST connection: passed.
   Read-only Lua and EVAL argument mapping: passed.
   Quota script compilation: passed.
   Existing ledger validation: passed. No writes or attempts admitted.
   RealCheck server listening on configured address and port.
   ```

3. Check HTTPS configuration and the rebuilt Chrome panel handshake without media.
   Expect scansEnabled=false and transcriptionReviewRequired=true. PowerShell:
   `Invoke-RestMethod https://realchecknow.xyz/api/config`.
   Confirm Render's deployed commit matches the prepared commit. Disabled config
   alone is not evidence of Redis connectivity: it intentionally skips Redis.
4. Only after local and Render storage verification passes, authorize enabling
   REALCHECK_PUBLIC_LIVE_ENABLED=true and the resulting deployment. Confirm config
   scansEnabled=true. This is not evidence of hosted provider success.
5. Separately authorize bounded hosted image/audio tests. Verify original playback,
   independent results, review/correction before wording checks and quota continuity
   across restart. All admitted checks count, including failures.
6. Disable the public switch to suspend scans, retain the ledger and reload clients.

## Local verification

### Provider failure diagnostics

The user subsequently reported RD unsupported_status and Groq http_401, with
Redis verification passing. The RD worker already carried providerStatus, but
the parent adapter discarded it. Unsupported statuses now retain only an exact
1-40 character uppercase/underscore token in the API response, structured RD
failure log and authenticity panel. Unsafe or overlong values are omitted, never
truncated. No additional verdict mapping is introduced; unsupported stays
unavailable. A future authorized hosted request is needed to observe the actual
SDK status; synthetic test statuses are not evidence of the hosted status.

The UI previously manufactured an unavailable result without a code after
transport errors, timeouts, invalid JSON or integrity/response-matching failures,
then displayed its fallback code internal. It also used internal for unknown
or missing provider codes. Those paths now use explicit client_timeout,
client_request_failed, response_invalid, request_rejected, response_mismatch,
integrity_mismatch, missing_failure_code or unknown_failure_code. A trusted
http_401 remains http_401, and an explicit server internal stays internal.
Offline tests reproduce simultaneous provider failures and the fallback paths;
the available hosted logs do not identify which client fallback was taken.
Reload the website and rebuild/reload the hosted extension to use the new UI.

The user reports hosted detection succeeded but Groq transcription failed. The
cause is not yet established. Groq failures already returned a sanitized code in
the transcription result; the UI now displays that code (for example http_400,
http_429, timeout or invalid_response) in both website and rebuilt side panel.
Successful detection remains visible and wording checks remain blocked when
transcription is unavailable.

Live analysis logs one JSON record per failed provider to server stderr, with
event=provider_failure, provider (groq or reality_defender), sanitized code,
stage, httpStatus, timeoutCode and networkCode. Groq stages distinguish
configuration, request, response_headers, response_body, response_validation and
local cooldown. HTTP status is null when no status was received; a body timeout
can have httpStatus=200. A local cooldown has null status, because it sent no new
HTTP request. Timeout and network codes are allowlisted; unknown values are null.
Unexpected exceptions use internal/unknown. Fixture mode emits no provider logs.

No tokens, headers, URLs, filenames, media, hashes, transcripts, exception objects
or raw provider responses are logged. Logs never trigger a retry. Logging failures
do not replace independent provider results. After deploying this change, inspect
Render runtime logs for provider_failure when an authorized check fails; logs
cannot reconstruct previous failures. Rebuild/reload the extension for its UI
change. No provider calls were made while testing this diagnostics change.

`npm test` uses stub storage responses/providers and synthetic media: REST contract
and failures, HTTP admission/lease/release/cleanup, origins, transcript review and
independent results. `npm run check` checks syntax and wiring; existing tests build
both extension targets. The separate real Redis suite is required to establish
Lua execution/atomicity on Upstash. Offline success proves neither that nor hosted
provider success.
