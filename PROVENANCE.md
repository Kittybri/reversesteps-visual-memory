# Provenance and contributions

## Pre-existing material — excluded from this repository

- The ReverseSteps Android app already captured photographs and notes and displayed steps in reverse order.
- On October 25, 2026, a separate preparation preview added a saved-note search screen and local service. That preparation included AI-assisted development and automated tests.
- The concept of visual part matching, source-photo evidence and assembly comparison was discussed before the event.

Those sources, assets, preparation code and their Git history are **not part of this repository**. This is not a renamed copy of the preparation preview. The product idea is its basis.

## New event work

October 26, 2026: created this new repository and authored its evidence-validation foundation, metadata fixture, tests, development instructions, and implementation plan. These files were written after the organizer's start announcement. Dates refer to America/Los_Angeles; Git retains actual commit timestamps. No backdating.

Implementation must continue here as new work. Do not copy the old Android app or preparation implementation into this repository. Record additional milestones with their actual dates and validation evidence.

October 26, 2026, subsequent milestone: Codex and Claude Code collaborated on a newly authored local web application. Codex implemented photo import/normalization, IndexedDB persistence, session backups, manual part-region marking, reverse replay, evidence-result UI and DOM interaction tests. Claude implemented the local HTTP service, Meta Responses adapter and offline provider/server tests. Codex integrated the contributions and ran the tests; Claude then reviewed the interface read-only. The user directed the collaboration and the indie-track goal. No prior app code or assets were imported. No actual Meta call or photographic recognition evaluation was performed during this milestone.

The review led to recovery preservation, persistent source highlights, mutation guards during lookups, request-size preflight and multi-view queries. Claude implemented 1–3 query views and sanitized usage counts in the provider/server; Codex implemented their UI and regression checks. Abriana selected her chess set for the first real test. Both tools assessed it as an initial test of restoring recorded arrangements, with unresolved identical-piece ambiguity disclosed.

October 26, 2026, live camera milestone: at Abriana's request, Claude authored `web/camera.js` and its hardware-mocked lifecycle tests. Codex authored the camera panel, device selection integration, deliberate step/query snapshots, adjustable original-photo reference overlay, and app regression tests. Codex reviewed Claude's startup handling and found a timeout gap while playback was pending; Claude corrected it and added cancellation/late-result regressions. Claude reviewed Codex's interface and identified a mismatch in image proportions for overlay comparison; Codex added compatibility gating, orientation-change handling and tests. The partners agreed on ideal 1080p capture with a 1440-pixel stored-image cap and no mirrored reference view. Codex ran the combined tests and HTTP smoke checks. No real webcam was activated, no continuous clip was recorded, and no Meta request was made during this milestone. Physical camera behavior and real recognition remain unverified.

## People and tools

- Project owner and direction: **Abriana Meazzo (Kittybri)**.
- Codex assisted with planning, coding, documentation, repository setup and verification.
- Claude Code helped build the separate October 25 preparation preview, which remains excluded. It did not author this repository's initial foundation; its October 26 server/adapter implementation and review are recorded above.
- No human teammate is claimed. Any added human contributor must satisfy the event's participant rules.

Development tools and runtime providers are separate: application AI calls use the Meta adapter only when explicitly configured and requested. The initial foundation made no model calls.

## Demo disclosure draft

“ReverseSteps previously recorded disassembly photos and notes. During this hackathon, I built a separate visual-memory module to connect loose parts back to recorded evidence.”

Use that statement only if the final implementation supports it; describe the actual completed functionality and measured limits.

## Source guidance

- [Code-reuse clarification](https://discord.com/channels/1557169028080869426/1557169028626251802/1564257793945632779)
- [Development-tool clarification](https://discord.com/channels/1557169028080869426/1564227933801938964)
- [Official start announcement](https://discord.com/channels/1557169028080869426/1557169028626251801/1564313866383523922)
