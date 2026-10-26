# Focused build plan

## Implemented milestone — October 26

The standalone local workspace now supports source photo upload, manual regions, reverse replay, backups, a guarded Meta adapter and multiple query views. The next implemented slice adds explicit live webcam preview, snapshot capture into the same source/query workflow and a manual recorded-photo overlay. The user selected a chess set for the first real test; follow [CHESS_TEST.md](CHESS_TEST.md). Camera and recognition behavior still need hands-on/provider evaluation. SAM tracking and automatic step detection remain unimplemented; do not imply that the live preview already performs them.

## First useful demonstration

One person records five to eight disassembly steps of a small desk stand. A second person photographs a loose part and receives possible matching observations, linked to the original photographs. Similar or poorly photographed parts produce a request for another view instead of a definite identification.

The initial scope is one simple, unpowered object. Avoid suggesting unobserved fastener specifications or presenting a visual match as proof of safe or mechanically correct assembly.

## Milestones

1. **Foundation (initial commit):** validate recorded-step identities, image asset identifiers, part regions and proposed source references. Reproducible offline checks and explicit provenance.
2. **Capture and review:** new standalone interface for a recorded session, photograph upload, step notes and user-confirmed part regions. Do not reuse the old app source.
3. **Provider experiment:** verify account readiness; make bounded Meta requests with synthetic or explicitly approved photographs. Evaluate SAM 3.1 segmentation and Muse Spark candidate matching. Do not send private local media merely because it is available.
4. **Where did this belong?:** query image → model proposal → validated source references → highlighted candidate photographs → user decision. A valid reference is not evidence of a correct semantic match; measure both separately.
5. **Ambiguity:** deliberately test similar screws, an unrelated part, occlusion and a changed camera angle. Record failures, wrong matches, and abstentions.
6. **Then/Now (only after the core works):** compare a small set of visible assembly states, with evidence-backed difference suggestions. No unsupported claims of general 3D reconstruction.

## Evaluation records

For each case, record object/session identifier, query photograph hash, expected source observation(s), model ID, relevant settings, proposed references, user-reviewed result and latency. Keep actual photographs and private records out of Git; publish only media cleared for distribution and a transparent result summary.

Measure source-reference validity, candidate matching accuracy, wrong-part suggestions, abstentions on unknown/ambiguous parts, latency and confirmed provider usage. Small-case results are not general accuracy guarantees. Keep a few unseen photographs for the final check.

## Demo target — three minutes

- 0:00–0:15: pre-existing versus new-work disclosure and the real problem.
- 0:15–0:45: recorded object and removal steps.
- 0:45–1:45: loose-part query, candidate evidence, original photo/region.
- 1:45–2:20: similar-part ambiguity and a useful request for another view.
- 2:20–3:00: second-person reconstruction result, Meta model roles and measured limitations.

## Submission boundary

Only event-built work belongs in this submitted repository. Keep October 25 preparation separate. The public repository and video must be accessible to judges. The detailed participant guide's deadline is November 4, 2026, 6 PM Pacific. Verify current instructions before submission.
