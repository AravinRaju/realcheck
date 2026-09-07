# Replace the old server and verify readiness without uploading

The reported PID 14860 serves fixture mode and detectionVerified=false. Fixture
mode is a configuration issue; the false verification value also indicates
older loaded code or a different checkout. It is not caused by fixture mode in
the current implementation. A browser refresh does not reload Node's modules.
The working tree remains at HEAD 84c8bf149ba2f06c395e604a8b381e1ce1790b8a with
uncommitted changes; HEAD alone cannot identify which code a process loaded.

In your authorized PowerShell, inspect and stop only that listener:

```powershell
$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop)
if ($listeners.Count -eq 0 -or @($listeners | Where-Object OwningProcess -ne 14860).Count -gt 0) {
    throw 'Port ownership changed. Inspect it before stopping any process.'
}
Get-CimInstance Win32_Process -Filter 'ProcessId = 14860' |
    Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine
Stop-Process -Id 14860 -ErrorAction Stop
```

This stops the specific server you identified; it does not kill all Node/npm
processes. If a watcher starts a different listener, stop here and inspect that
process rather than terminating it automatically.

Then start this exact checkout in the same terminal:

```powershell
Set-Location -LiteralPath 'C:\Users\aravi\realcheck'
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3000 is still occupied. Do not start a second server.'
}
$env:REALCHECK_MODE = 'live'
$env:PORT = '3000'
node .\server.mjs
```

Leave it running. Keys load from the existing private .env; the process mode
overrides .env without modifying it. Do not upload yet.

In a second PowerShell window, check only the local config endpoint:

```powershell
$config = Invoke-RestMethod 'http://127.0.0.1:3000/api/config'
$config | ConvertTo-Json -Depth 5
$listener = @(Get-NetTCPConnection -LocalPort 3000 -State Listen)
if ($config.mode -ne 'live' -or
    $config.server.implementation -ne 'sdk-0.1.19-transcript-review-v1' -or
    $config.server.projectPath.TrimEnd('\') -ine 'C:\Users\aravi\realcheck' -or
    $config.server.commit -ne '84c8bf149ba2f06c395e604a8b381e1ce1790b8a' -or
    $config.server.pid -notin $listener.OwningProcess -or
    $config.detection.sdkVersion -ne '0.1.19' -or
    -not $config.detectionReady -or -not $config.detectionEnabled -or
    -not $config.detectionVerified -or -not $config.transcriptionConfigured -or
    $config.transcriptionVerified -ne $false -or
    -not $config.transcriptionReviewRequired) {
    throw 'Readiness mismatch. Do not upload; share only this config output for review.'
}
'Readiness checks passed. No recording was uploaded.'
```

The response must identify the new PID, this project path, SDK 0.1.19, live mode,
and the current implementation. detectionVerified is conditional on SDK presence,
the inspected version, a loadable SDK entry point, key configuration, and the
recorded user-run verification of that version. It is not an unconditional flag
or a fresh provider-health check. Missing/different SDKs and missing keys report
not ready. Transcription remains unverified because API success is not accuracy.

Share the config output to confirm identity/readiness before another upload.
These commands do not make provider calls. No further live scan is requested
as part of this restart. Keep the existing browser tab/audio available until
you finish reviewing it; refreshing clears its in-memory file selection and
transcript. After readiness is confirmed, a refresh loads the new review UI.
