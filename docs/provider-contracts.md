# Provider contract evidence

Reviewed 2026-09-07. This document distinguishes official documentation from an installed SDK contract and from a live response.

## Reality Defender

Official sources:
- https://docs.realitydefender.com/sdks/quickstart
- https://docs.realitydefender.com/api-reference/quickstart
- https://docs.realitydefender.com/api-reference/endpoint/get_media_detail
- https://github.com/Reality-Defender/realitydefender-sdk-typescript

The documented REST upload flow obtains a signed upload URL, uploads file bytes, and polls the media detail endpoint. Authentication uses X-API-KEY. The documentation recommends ensemble results. Media Detail documents resultsSummary and processing statuses; the SDK documentation also describes normalized SDK values. These are not interchangeable schemas.

Installed SDK: **@realitydefender/realitydefender 0.1.19**, exact dependency and lockfile pin verified locally. The following installed files were inspected:

- dist/index.d.ts and dist/types/sdk.d.ts: public constructor, detect and getResult signatures, DetectionResult, GetResultOptions.
- dist/types/api.d.ts and dist/detection/results.js: raw-to-SDK formatting and polling behavior.
- dist/client/index.js, dist/detection/upload.js, dist/index.js, dist/errors.d.ts: transport, upload, error codes and detect flow.

DetectionResult has requestId: string, status: string, score: number | null, models: { name: string; status: string; score: number | null }[], and heatmaps: Record<string, string> | null. Status is an open string, not an enum. GetResultOptions permits maxAttempts and pollingInterval; constructor options are apiKey and optional baseUrl. There is no public HTTP timeout or cancellation option.

The SDK prioritizes resultsSummary.status over overallStatus, normalizes FAKE to MANIPULATED, and divides the overall finalScore by 100. It polls ANALYZING and DOWNLOADING, returning even a pending result when attempts run out. A failed single-result request throws immediately. The separate getResults list method retries failures; RealCheck does not use it or event-based polling.

The adapter maps SDK overall MANIPULATED to Likely deepfake and AUTHENTIC to Unlikely deepfake. It validates the declared result shape before mapping and discards scores, model results, IDs and signed heatmaps. No numeric threshold or model vote is used. Pending results produce processing/unavailable; unknown statuses produce unsupported_status/unavailable. No terminal inconclusive value is established by the installed declarations or implementation, so none is invented for Unclear.

The SDK uses Axios without retry middleware or a configured request timeout in this detect path. RealCheck performs one detect call in a child process, with maxAttempts=10 and pollingInterval=2000. A 60-second parent deadline kills the worker and waits for close before upload cleanup. SDK diagnostics are suppressed. Keys are passed through the worker environment, never argv or logs. The worker checks version 0.1.19 before making a request.

SDK errors expose code and message, with no structured HTTP status or Retry-After. The SDK maps HTTP 429 to server_error and transport failures to unknown_error. RealCheck preserves safe codes, discards messages, and does not infer a quota condition or parse messages for network errors. The RD adapter does not automatically retry.

**User-run live verification reported 2026-09-07:** SDK 0.1.19 returned AUTHENTIC → Unlikely deepfake for the supplied WhatsApp Ogg recording. The agent did not run the request or independently inspect its raw response. Other verdict paths remain covered locally, not verified live. Local tests exercise the actual installed formatter/poller with in-memory responses and the adapter with stubbed workers. They do not prove scan quality. See manual-verification.md for website testing instructions.

## Groq

Current accuracy status: **unverified**. The user subsequently reported varying
and potentially invented sentences. Successful API transport is not verification
of transcript accuracy. Upload analysis returns no wording findings. The browser
requires user review/correction and explicit confirmation before deterministic
wording checks. Corrections never alter the RD result or trigger another provider
request. No model or preprocessing settings were changed during investigation.

Official sources:
- https://console.groq.com/docs/speech-to-text
- https://console.groq.com/docs/api-reference
- https://console.groq.com/docs/rate-limits

Uses the documented REST endpoint https://api.groq.com/openai/v1/audio/transcriptions with Bearer authentication and multipart file, model=whisper-large-v3-turbo, response_format=verbose_json, and temperature=0.

This prototype uses native Node fetch/FormData/Blob; it does not install or assume a Groq SDK schema. The adapter requires a string text field and accepts an optional string language field. Missing/unknown language skips English rules. Extra provider fields are discarded. No language is forced and no translation is requested.

The JSON contract and multipart request are covered by stubbed-response tests. Both keys load. An earlier agent attempt failed with EACCES and was not retried. On 2026-09-07 the user subsequently reported a successful manual live transcription: 57 transcript characters, English. This is user-run verification; the agent has not independently inspected the raw response or transcript content.

Groq documents HTTP 429 for rate limits and Retry-After in seconds. The adapter reports Analysis unavailable plus "Service limit reached; try again later." It does not infer quota exhaustion. Valid Retry-After seconds or HTTP dates establish an in-memory provider cooldown; new user requests during it do not contact Groq. There is no automatic retry or sleeping request queue. The independent detection result is retained. The cooldown is local to this running server and resets on restart; one-off commands are separate processes, so respect their printed retry delay before manually rerunning. RD cannot expose equivalent rate-limit details because installed SDK 0.1.19 discards HTTP status and headers when constructing its errors.

## Timeout budgets

lib/budgets.mjs is the shared source: browser upload reading 30 seconds, Node request receipt 35 seconds, Groq upload plus response/body 50 seconds, one-off worker ceiling 60 seconds, browser request 105 seconds. Providers run concurrently after the browser upload finishes; the client budget covers request receipt plus the provider ceiling plus 10 seconds for response/cleanup. Node requestTimeout concerns request receipt, not provider processing. The client reads its timeout from /api/config. Provider timeouts do not turn into Unclear; cleanup and independent results remain intact. These are prototype latency limits, not provider latency guarantees; a slower genuine analysis can remain unavailable.

## Application output

authenticity contains one permitted label, or status=unavailable with label=Analysis unavailable.
transcription independently contains text/language, not_applicable for images, or unavailable.
content contains rule findings with exact spans and source links, or not_evaluated.
fixture=true is mandatory for the authored UI examples. Live mode never returns fixture content.

No authenticity score, scam score, combined risk score, or generated explanation exists.
