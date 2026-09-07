# RealCheck browser side panel

Uses the shared website UI, review module, and deterministic rules. Only files
chosen by the user are submitted after a click. Original audio remains playable;
transcription is unverified and requires explicit review. Editing revokes consent.
No page reading, automatic uploads, result cache, or provider keys in the panel.

## Build and install

Local development (PowerShell from the project root):

```powershell
$env:REALCHECK_EXTENSION_BACKEND = 'http://127.0.0.1:3001'
npm.cmd run build:extension
```

For the prepared hosted site, select `https://realchecknow.xyz` instead. These
are the only allowed targets. See [hosting instructions](../docs/hosting.md).
The build generates panel/, lib/, and manifest.json; do not edit those outputs.
Manifest source is manifest.template.json. Host permissions and connect-src CSP
are generated for only the selected backend. The only API permission is sidePanel.
Local Chrome host patterns cover ports, but the client/CSP enforce port 3001.

Open chrome://extensions, enable Developer mode, Load unpacked, and choose this
extension directory. For existing installs click Reload, then close/reopen the
panel. Confirm the displayed extension ID equals REALCHECK_EXTENSION_ID on the
server. The expected current unpacked ID is lbfnfcfbfiedpcihlklplieolhffpiol.
Do not assume another directory/store package retains that ID.

Local backend: set PORT=3001, REALCHECK_MODE=live, and REALCHECK_EXTENSION_ID to
the exact ID. Keep provider keys in the ignored backend .env locally or server
secret environment on hosting. Start with npm start. Never run a second server
on an occupied port; stop the existing one in its terminal first.

## Authorization and verification

The panel requests config at the selected backend with a body-free POST; Chrome
supplies Origin. A privileged GET can omit Origin and cannot authorize a panel.
The server accepts only the configured exact chrome-extension:// origin.
GET /api/config from the website/terminal intentionally reports authorized:false.
It reports provider readiness booleans but no local paths or process diagnostics.

Offline tests use stubbed providers. No hosted browser or provider verification
has been performed. Permission changes may require confirming site access when
reloading. Check configuration before asking a user to upload. Provider keys stay
server-side; permissions never include provider hosts or all sites.
