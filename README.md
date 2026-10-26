# ReverseSteps Visual Memory

**Find where a loose part belonged, using the history you recorded.**

A new, standalone visual-memory module for the Meta Global AI Developer Hackathon indie track. It grows out of the ReverseSteps product idea: preserve the evidence of taking something apart so another person can understand how it goes back together.

## The experience we are building

1. Photograph a simple object as its parts are removed.
2. Photograph a loose part during reassembly.
3. Suggest its possible appearances in the recorded steps, with source photographs and highlighted regions.
4. Ask for another view when the recorded evidence does not distinguish similar parts.
5. Compare a current assembly state with a recorded state as a later milestone.

## Current status

**Local photo workspace and Meta adapter implemented; real recognition not yet evaluated.** Capture up to 12 photographs, add notes and mark parts, replay steps in reverse, and export/import a complete backup. The workspace saves in this browser's IndexedDB. Browser storage can be cleared; export to keep an independent copy. Query photographs are temporary and are not included in backups.

The Python service can send an explicit lookup to Muse Spark when configured. It verifies source-image hashes and validates the answer's evidence references. No live provider request has been made in development so far. Automated checks use test doubles; they do not establish recognition accuracy or live API compatibility. SAM and automatic part-region detection are not implemented.

## Open the local app

From this checkout, with Python 3.11+:

```powershell
py -m reversesteps.server --port 8765
```

Open `http://127.0.0.1:8765/`. Keep this server running while using the app. It binds to this computer only, so a phone cannot reach it over Wi-Fi. No Python dependencies are required. Source files are served directly from `web/`; no frontend build is needed. Use the same address and browser each time to return to the saved workspace.

1. Name the object and add photos in removal order.
2. Select each step, write a note and name a visible part. Choose **Mark a part**, then drag a box around it.
3. Choose **Rebuild in reverse** to walk back through the original photographs.
4. When Meta is configured, upload a loose-part photo and choose **Find its story**. Inspect any suggestion in the source photo; similar parts should request more evidence.

Only an explicit lookup sends the source and query photos to Meta. The service does not save photos or model responses. Use **Same part, another view** to retain the first query photo and add up to two more. Selecting **Choose a different part** starts a fresh query. Multiple views are the user's assertion of the same physical piece, not verified identity. Failed local restores preserve a recovery copy or pause saving, and a recovery download is available when the previous record could be read.

## Enable Meta after confirming account readiness

Configure `MODEL_API_KEY` in the server process environment and set `REVERSESTEPS_META_ENABLED=1`, then restart the server. Never put a key in browser code, source control or a screenshot. The app's readiness indicator means these settings exist; it does not prove credits or model access. Confirm those in your Meta account first.

The adapter uses Meta's Responses endpoint and documented JSON schema fields. Strict structured output with this model still needs a live compatibility check. Calls have no automatic retry; upstream errors produce an honest no-result state. The 120-second provider timeout is a socket timeout, not a guaranteed whole-request deadline.

The example below is a synthetic metadata fixture used to exercise validation. It contains no photographs and is not an AI result.

```powershell
py -m reversesteps validate examples/recorded-session.json
py -m unittest discover -s tests -v
```

Python 3.11+; standard library only. No account, API key or package installation is needed for these Python checks. For DOM interaction checks, install Node.js 22+, run `npm install`, then `npm test`. DOM tests mock image decoding, canvas and layout: they are not a substitute for browser rendering tests.

## Planned Meta integration

- **SAM 3.1:** evaluate detection/segmentation and video tracking for recorded parts.
- **Muse Spark:** evaluate visual matching and reasoning over candidate observations.
- Keep provider credentials on the service, outside the client and source control.
- Show suggestions with source evidence; require user review. Numeric model scores are not calibrated probabilities.

Cross-photo part identification and useful assembly comparisons must be measured on real examples. Model availability and account billing readiness must be verified before live API calls. The current code does not claim either capability.

## Project map

- `reversesteps/evidence.py`: new recorded-evidence and match-proposal validation.
- `reversesteps/__main__.py`: metadata validation command.
- `reversesteps/server.py`: local-only static and lookup service.
- `reversesteps/meta_provider.py`: Meta Responses adapter with validated references.
- `web/`: photo workspace, local persistence, reverse timeline and lookup interface.
- `tests/`: evidence integrity, ambiguity and input validation checks.
- `docs/BUILD_PLAN.md`: focused milestones and demo evaluation.
- `docs/WORKING_CONTRACT.md`: Codex/Claude ownership and integration contract.
- `docs/VALIDATION.md`: completed checks and remaining verification.
- `docs/CHESS_TEST.md`: the user's chosen first real-object test protocol.
- `PROVENANCE.md`: pre-existing work, event work and AI assistance.
- `AGENTS.md` / `CLAUDE.md`: shared development boundaries.

## Hackathon provenance

Created on **October 26, 2026**, after the organizer announced the start. No code, assets or Git history from the old ReverseSteps app or the October 25 preparation preview have been copied into this repository. The earlier idea and preview are disclosed in [PROVENANCE.md](PROVENANCE.md).

Submission eligibility remains the organizers' decision. The final demo must distinguish pre-existing work from the new event-built module. See the [organizer clarification](https://discord.com/channels/1557169028080869426/1557169028626251802/1564257793945632779).

## License

MIT. Use only media you own or have permission to use. Personal project photographs, credentials and runtime data are excluded from the repository by default.
