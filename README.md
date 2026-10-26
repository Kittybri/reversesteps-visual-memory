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

**Repository foundation, not a working vision application.** The new code validates recorded evidence and checks whether a model-produced part-match proposal cites real recorded regions. It does not recognize parts, call models, or establish that a proposed match is correct. There is no user interface or live Meta integration yet.

The example below is a synthetic metadata fixture used to exercise validation. It contains no photographs and is not an AI result.

```powershell
py -m reversesteps validate examples/recorded-session.json
py -m unittest discover -s tests -v
```

Python 3.11+; standard library only. No account, API key or package installation is needed for these checks.

## Planned Meta integration

- **SAM 3.1:** evaluate detection/segmentation and video tracking for recorded parts.
- **Muse Spark:** evaluate visual matching and reasoning over candidate observations.
- Keep provider credentials on the service, outside the client and source control.
- Show suggestions with source evidence; require user review. Numeric model scores are not calibrated probabilities.

Cross-photo part identification and useful assembly comparisons must be measured on real examples. Model availability and account billing readiness must be verified before live API calls. The current code does not claim either capability.

## Project map

- `reversesteps/evidence.py`: new recorded-evidence and match-proposal validation.
- `reversesteps/__main__.py`: metadata validation command.
- `tests/`: evidence integrity, ambiguity and input validation checks.
- `docs/BUILD_PLAN.md`: focused milestones and demo evaluation.
- `PROVENANCE.md`: pre-existing work, event work and AI assistance.
- `AGENTS.md` / `CLAUDE.md`: shared development boundaries.

## Hackathon provenance

Created on **October 26, 2026**, after the organizer announced the start. No code, assets or Git history from the old ReverseSteps app or the October 25 preparation preview have been copied into this repository. The earlier idea and preview are disclosed in [PROVENANCE.md](PROVENANCE.md).

Submission eligibility remains the organizers' decision. The final demo must distinguish pre-existing work from the new event-built module. See the [organizer clarification](https://discord.com/channels/1557169028080869426/1557169028626251802/1564257793945632779).

## License

MIT. Use only media you own or have permission to use. Personal project photographs, credentials and runtime data are excluded from the repository by default.
