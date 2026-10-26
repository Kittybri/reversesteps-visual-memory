# Use the live workbench

Run `py -m reversesteps.server --port 8765` from this checkout and open `http://127.0.0.1:8765/` on this laptop. If the side-panel browser cannot provide camera access, open that same address in a current Chrome or Edge browser. Use the same browser/address to return to saved local work; Export/Import transfers a workspace between browsers.

## Record a step

1. Choose **Start camera** and allow camera access in the browser prompt. Choose a webcam from the Camera list if more than one is available. The microphone is not requested.
2. Keep the camera steady and your hands clear. Photograph the arrangement **before** moving the piece.
3. Choose **Save this step**. The frame becomes a real source photo in the timeline below, with its own identity and SHA-256 hash. It uses the same local save/backup path as a photo upload.
4. Give the step a note and mark the visible part in that saved photo. Repeat up to 12 steps. See [CHESS_TEST.md](CHESS_TEST.md) for the neutral-label evaluation protocol.

## Ask about a loose piece

1. Hold the piece in view and choose **Use as mystery piece**.
2. If useful, turn the **same physical piece** and choose **Another view of this piece**. Up to three distinct captured/uploaded views are kept together.
3. Choose **Find its story** when Meta is configured. Camera capture by itself does not send a model request. Results cite recorded steps/regions; uncertain matches must remain uncertain.
4. **Use as a different piece** starts a fresh query and replaces its temporary query views. The recorded timeline is kept.

## Compare with an earlier arrangement

Select a recorded step in the timeline, enable **Overlay recorded step**, and adjust **Reference strength**. Move the physical camera to line the live view up with the original photo. Both views are unmirrored. The overlay follows the selected step; starting another object/importing a backup, adding source photos, or stopping/switching cameras clears it.

The overlay is disabled when the recorded image's proportions differ from the camera's by more than 2%, or while the source dimensions are still loading. This avoids overlaying mismatched portrait/landscape frames. Matching proportions alone does not establish alignment: the camera position and angle still need manual adjustment.

This is a manual visual reference. It does not register the board, check piece placement, prove a correct assembly, or track objects through a hand covering them. Captures always use the original video pixels; overlay graphics never become part of the saved evidence.

## Stop and resume

Choose **Stop camera** at any time, including while another action is busy. **Cancel camera** cancels a pending start; if a browser permission grant arrives afterward, the acquired stream is immediately released. Hiding/leaving the page stops the camera. Returning to the page requires choosing Start camera again. Saved source photos remain available; the continuous feed is not recorded.

## Verification boundary

Automated tests mock camera hardware, browser permission UI, video frames and image encoding. The controller and integration checks cover lifecycle races, capture errors, stored evidence, query limits, no automatic model requests and reference overlay state. Real webcam permission behavior, actual preview appearance, capture sharpness, hardware switching and live Meta recognition require a hands-on run.

## Hands-on acceptance check

- Allow the camera and verify a moving, unmirrored preview. Reject camera access once and confirm photo uploads still work.
- Save one step and compare the saved image with what the camera saw. Mark a piece, refresh and confirm the photo/region persists.
- Capture a mystery piece and two new angles; verify all three are visible. Confirm there is no model request until Find its story.
- Toggle the original-photo overlay, change its opacity and select another step. It should follow the selected source, and a new capture must contain no overlay graphics.
- Stop, switch cameras if available, hide/return to the page and close/reopen it. Check the browser's camera-use indicator goes off when stopped/hidden.
- Only after account readiness: test actual matching with held-out photos and log failures separately from useful ambiguity.
