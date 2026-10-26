# Live camera milestone — October 26, 2026

Codex and Claude are implementing live preview with deliberate still-frame capture. This is a local camera feed, not continuous cloud analysis or proven SAM tracking. No microphone, automatic provider requests, clip upload, or claims of identity across occlusion.

## Ownership

Claude owns new `web/camera.js` and `tests/camera.test.cjs`. Codex owns HTML/CSS/app integration, app tests, documentation, and integration verification. Each reviews the other's contribution. Existing evidence/provider interfaces stay unchanged: a camera frame becomes the same normalized JPEG evidence as an uploaded image.

## Camera controller contract

Buildless browser script loaded before app.js. Expose `window.ReverseStepsCamera` with a class constructor taking `{video, onState, onError}`. `video` is a real HTMLVideoElement; callbacks default no-op.

- `async start(deviceId?)`: only explicit user action calls it. Request `getUserMedia` with audio:false and ideal 1920×1080 video; optional exact deviceId, otherwise ideal environment facing camera. Stop prior streams on switch. Play the video, handle autoplay rejection, and report state. Repeated starts and stop during a pending permission prompt must not leak cameras or let stale promises attach streams. After permission resolves, playback and first-frame readiness share an eight-second timeout; permission itself remains controlled by the browser/user.
- `stop(message?)`: immediately release owned tracks, detach video, invalidate pending starts. Idempotent.
- `capture()`: return a JPEG data URL of the actual unmirrored frame, scaled to max dimension 1440, quality .86, with white background; return null and call onError on refusal before live/readiness, zero dimensions, overlarge output, ended tracks. No test/fixture fallback. Same 2 MiB decoded limit as the provider. Codex accepted this explicit null/error callback convention and guards it before any state mutation.
- `async listCameras()`: return available video inputs as `{deviceId,label}`. Do not invoke getUserMedia or start a camera here. Handle errors with an empty list and safe useful message.
- `dispose()`: stop tracks and release listeners.
- `onState({state, message, deviceId})`: state `off`, `starting`, `live`, or `error`. Strings safe and descriptive. Publish on transitions; selected deviceId from settings when available. `onError(message)` for handled start/list/capture failures; do not expose raw devices/stack details.
- When page hidden or pagehide, stop owned stream and cancel pending starts. Browser/OS permissions remain under the user's control. Handle externally ended tracks.

Tests use mocked media devices, tracks/video/canvas. Cover successful lifecycle; disabled or denied camera; no frame; multiple starts; late permission completion after stop/new start; play failure; switching/ended tracks; hidden/pagehide cleanup. They do not establish real camera behavior.

## User workflow

1. Explicit Start camera, select webcam when available.
2. Capture step: current live frame goes into the recorded timeline, with stable IDs and SHA-256, and can be annotated like uploads.
3. Capture mystery part: current frame becomes a query; another-view action appends up to three distinct views, preserving prior evidence. The ordinary Find its story button is the only provider-call action.
4. Compare with recorded step: optionally overlay selected original photo on the camera with opacity control. User aligns camera physically; this is a visual reference, not automatic registration or a placement correctness check.
5. Stop camera visible at all times; show camera unsupported/permission problems without losing upload workflow.

The camera has its own panel so original source photos remain visible and annotatable. At the 12-step/3-view caps, capture controls explain the limit. Boot, upload, import, and lookup busy state must prevent capture mutation. Capture errors must leave session/query unchanged. New-session/import paths reset comparison state and must not silently save camera frames. UI refers to the camera as live only when the controller confirms it.
