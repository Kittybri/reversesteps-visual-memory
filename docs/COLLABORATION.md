# Working together

Codex and Claude Code jointly authored this milestone at Abriana's request. Codex coordinates integration, visual interaction, documentation and executed verification. Claude implements explicitly assigned server/provider work and reviews the integrated experience. Both can question the plan. This does not guarantee a competition placing.

## Decisions from the first implementation and review

- Keep the physical-memory idea; evaluate recognizability and unknown-part rejection before expanding features.
- Make source-region attribution visible at the moment of a suggestion. Store highlight state so image loading and resizing cannot erase it.
- Preserve existing local data when restoration fails. Save a recovery copy before replacing it, or pause writes if that fails.
- Retain up to three views of the same queried part. More images do not prove individual identity; compare multi-view behavior with single-view behavior on held-out photos.
- Keep errors distinct from semantic uncertainty. A failed API request is not a successful model abstention.
- Measure actual Meta calls before claiming a useful capability. Unit tests establish data handling and integration logic only.
- Try user-marked region crops against full photographs/boxes before assuming SAM will improve matching. SAM's first potential benefit is automatic part regions; it has not been implemented.
- Use chess as the user's available first test set. Distinctive pieces exercise retrieval; identical pawns test honest uncertainty. Prove broader value with an actual assembly/repair example before choosing the final demo.
- Claude identified answer leakage in piece labels/notes. The chess evaluation now uses neutral labels and a separate answer sheet, plus opposite-color rooks to test similar but distinguishable shapes. Codex rejected inferring functional interchangeability from appearance, and refined the model instructions so truly indistinguishable pieces can remain unresolved without pointless requests for more photos.

## Current ownership

| Area | Implementation | Review / verification |
| --- | --- | --- |
| Source evidence validation | Codex | Automated Python checks |
| Local photo workspace and reverse timeline | Codex | Claude review; Codex DOM checks |
| Meta adapter and local HTTP service | Claude | Codex review; Python tests executed by Codex |
| Multi-view lookup | Both, across the agreed interface | Backend and DOM regression checks |
| Camera lifecycle and JPEG capture | Claude; Codex integration review | Mocked hardware lifecycle tests executed by Codex |
| Live panel, snapshot workflow and reference overlay | Codex; Claude integration review | DOM and real-controller integration checks with mocked hardware |
| Product/demo strategy | Codex + Claude + Abriana | Real-object evaluation pending |

## Live camera strategy and cross-review

The partners chose live local preview plus deliberate snapshots as the next working feature. It uses the existing evidence and Meta lookup path without assuming a continuous video inference service or automatic identity recovery. Short-clip/SAM experiments remain a later measured step.

Codex found that Claude's initial frame timeout began after `video.play()` completed, leaving pending playback unbounded. Claude replaced it with a single eight-second playback/readiness deadline and immediate cancellation of the startup waiter. Claude identified overlay aspect-ratio mismatch in Codex's interface; Codex gated the reference by compatible proportions and added camera resize handling. Additional tests cover null capture refusal, stale device enumeration and the real controller integrated into the app with simulated hardware.

The overlay is a manual reference, with no placement validation or automatic registration. The continuous feed is not recorded, no microphone is requested, no model call is automatic, and page hiding stops the camera. Actual webcam and browser rendering checks remain outstanding because browser automation is disabled in the user's Work settings.

No autonomous background collaboration is implied after a chat turn ends. Further work continues when this chat is active; live recognition experiments await account readiness and the user's actual photographs.
