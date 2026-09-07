# Hosting preparation: realchecknow.xyz

Prepared offline; not deployed, DNS unchanged, and no hosting/provider network
checks performed. User-run local website verification is not hosting verification
or an accuracy benchmark. Existing transcript review, original playback, hidden
scores, and independent detection/transcription failure states are preserved.

## Runtime requirements

- A long-running Node.js 22.13+ process supporting child processes and writable
  temporary files. Install the lockfile with `npm ci --omit=dev`; start `npm start`.
  Static-only hosting and short-lived edge/serverless functions are unsuitable.
- Exactly ONE process/replica, no cluster workers or overlapping rolling replicas.
  The admission ledger uses one persistent volume. Multi-instance operation needs
  an atomic shared quota store before live scans can be enabled.
- TLS termination for https://realchecknow.xyz and a private upstream to the
  supplied PORT. HOST defaults to 0.0.0.0 with a public origin; set HOST if needed.
  The proxy must preserve Origin and the custom upload headers, allow POST and
  OPTIONS, support 20 MiB request bodies, and allow at least 110 seconds for the
  full response. Application upload receipt is capped at 30 seconds, provider
  processing is bounded, and uploaded temporary files are removed.
- Restrict direct upstream access. Redirect HTTP to canonical HTTPS at the proxy.
  Configure proxy connection/rate limits for static/config traffic too. Do not
  log request/response bodies, filenames, transcripts, or provider credentials.
- Authorized outbound HTTPS for api.prd.realitydefender.xyz, its SDK-issued
  upload destinations, and api.groq.com. Actual hosting egress is not verified.

## Server environment (host settings, not browser/build settings)

```text
NODE_ENV=production
REALCHECK_PUBLIC_ORIGIN=https://realchecknow.xyz
HOST=0.0.0.0
PORT=<provided by host>
REALCHECK_MODE=live
REALCHECK_PUBLIC_LIVE_ENABLED=false
REALCHECK_STATE_DIR=/persistent/realcheck
REALCHECK_DAILY_LIMIT=20
REALCHECK_HOURLY_LIMIT=5
REALCHECK_EXTENSION_ID=lbfnfcfbfiedpcihlklplieolhffpiol
```

Set REALITY_DEFENDER_API_KEY and GROQ_API_KEY privately in the host's secret
manager/environment. Do not put them in build arguments, the extension, source,
or public assets. Production entrypoint does not load .env. Never upload .env,
recordings, verification archives, .git, or node_modules as source.

Hosted live checks are disabled unless REALCHECK_PUBLIC_LIVE_ENABLED is exactly
true. Set it only after HTTPS/config/extension checks and volume setup are done.
When enabled, the defaults admit at most 5 uploads per rolling hour and 20 per
rolling 24 hours, with one active upload/check. Each audio attempt may call both
providers. Rejected/failed admitted attempts consume quota; there is no retry.
Configured ceilings cannot exceed 20/hour or 100/day. Quota state contains only
bounded timestamp entries, survives process restarts, and fails closed on corrupt
or unwritable storage. Preserve usage.json when restarting or moving the app;
do not replace the persistent volume. This is a global demo budget, not a
per-user entitlement or bot defense: another visitor can exhaust it. Proxy abuse
controls and provider-side spending limits remain hosting responsibilities.

Origin checks use the explicit HTTPS origin, not Host or forwarded headers.
Only the one configured extension origin receives CORS access. No wildcard,
credentialed CORS, arbitrary URL proxy, or client-claimed extension ID is added.
Origins are browser isolation controls, not proof of a human user.

/api/config exposes readiness booleans and the panel protocol only; no process
ID, project path, Git state, detailed SDK object, or request-header diagnostics.
Upload response hashes/request IDs remain for client integrity checks, are not
logged, and are no longer displayed. No general diagnostic endpoint is served.

## Extension build and reload

From the project root in PowerShell:

```powershell
$env:REALCHECK_EXTENSION_BACKEND = 'https://realchecknow.xyz'
npm.cmd run build:extension
```

The build generates manifest.json from manifest.template.json and binds the
client, host permission, CSP, and connection notice to this origin. Only this
host is permitted in the hosted build; localhost is not additionally permitted.
No new permission other than the existing sidePanel permission is used.
Reload RealCheck at chrome://extensions, then close/reopen the panel. Keep the
same unpacked folder to retain its ID and confirm the actual ID matches the host.
Distribution/store packaging may produce a different ID: update the server to
that exact ID before testing it. Configuration uses the existing body-free POST
handshake so Chrome supplies Origin. Opening the panel does not upload media.

Return to local development:

```powershell
$env:REALCHECK_EXTENSION_BACKEND = 'http://127.0.0.1:3001'
npm.cmd run build:extension
```

In a fresh local shell with no hosting variables, existing ignored .env continues
to work. Use PORT=3001 for the local panel. Without REALCHECK_PUBLIC_ORIGIN, the
server stays loopback-only and existing local checks are unaffected.

## Release sequence remaining (not performed)

1. Choose a compatible host, one instance and persistent volume. Add server
   secrets and environment above, keeping public live checks disabled.
2. With explicit deployment authorization, release the tested source and set up
   domain/TLS/proxy. DNS and deployment have not been changed here.
3. Check HTTPS website configuration and the rebuilt extension handshake without
   media. Confirm scansEnabled=false; no local paths/diagnostics in config.
4. Configure edge abuse controls and provider spending limits. Enable public live
   checks deliberately. Restart using the same quota volume.
5. Ask for approval for a bounded live upload, then verify file playback, detection,
   transcript review/correction, independent failures, and quota behavior. Record
   this as hosting end-to-end verification, never an accuracy benchmark.
6. Disable REALCHECK_PUBLIC_LIVE_ENABLED to suspend scans without falling back
   to fixtures. Hard refresh clients after a configuration restart.

Offline tests cover local defaults, canonical HTTPS and exact extension origin,
forged/missing origins, disabled public scans, concurrency, persisted hourly/daily
quota, fail-closed storage, reduced config schema, both extension targets, existing
review gating and byte tracing. Host runtime/TLS and actual Chrome hosted behavior
still require manual verification after an authorized deployment.
