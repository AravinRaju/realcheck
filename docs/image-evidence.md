# Image evidence inspection ? 2026-09-07

Inspected locally: installed @realitydefender/realitydefender 0.1.19,
dist/types/sdk.d.ts, dist/types/api.d.ts, and dist/detection/results.js.
No new scans, remote requests, or API additions. No actual image heatmap response
was available for this inspection; SDK support does not establish account availability.

## Available fields and current mapping

DetectionResult contains requestId, status, score, models (name, status, score),
and heatmaps (model name to signed URL, or null). There is no narrative explanation,
visual-defect description, bounding box, or heatmap legend in this contract.
The SDK retains heatmaps only for IMAGE media and non-ensemble models with
MANIPULATED status and nonempty URL strings. It normalizes FAKE to MANIPULATED.
This filtering does not validate URL safety, image contents, or their interpretation.

lib/rd-result.mjs validates the result shape but emits only the normalized verdict
label. Provider request ID, scores, model results, and heatmaps are discarded from
the application result. The worker retains field-type diagnostics, not evidence
values. lib/results.mjs deliberately accepts only a label. Scores remain hidden;
no score thresholds or model voting determine the verdict.

## Implemented scope

Shared app.js supplies a plain-language definition for completed live image
verdicts and explicitly states: ?The detector returned this assessment without a
detailed explanation for this image.? This describes the absence of a detailed
explanation in the inspected contract; it does not claim that the provider has
no heatmaps. Fixture copy, audio behavior, and processing/error states stay separate.
No visual defects are inferred. No LLM is used. Extension assets are rebuilt from
shared sources. The backend and adapter response schema remain unchanged.

## Heatmap display assessment ? deferred

A future implementation could retain validated heatmap metadata through the
worker/adapter/parser and offer an explicit user-triggered view. First establish
the actual provider hosts and returned raster formats from an authorized response.
Do not load arbitrary returned URLs or broaden extension host permissions/CSP.

Use an exact HTTPS host allowlist, block redirects and private/local destinations
(including DNS resolution checks), and bound download time, bytes, decoded image
dimensions, and raster MIME/signature. Reject SVG/HTML. A backend download route
must preserve the existing exact-origin policy, be bound to the current request,
and not accept arbitrary user URLs. Keep signed URL query credentials out of UI,
logs, browser history, and persistent storage. Return validated image bytes for
local blob display with cleanup, keeping provider keys server-side.

Label each view ?Provider-supplied indicator? with its model name as text, explain
that it is not proof or a detailed explanation, and show it beside the original.
Do not invent a color legend or overlay alignment without verified semantics.
Missing, expired, rejected, or failed heatmaps must not change the verdict or
trigger rescanning/retries. Preserve score suppression and explicit fixtures.
