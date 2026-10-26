"""Validate metadata only; no image analysis or network access."""

import argparse
import json
from pathlib import Path
import sys

from .evidence import EvidenceError, MAX_DOCUMENT_BYTES, parse_json, read_session


def main() -> int:
    parser = argparse.ArgumentParser(description="ReverseSteps recorded-evidence validator (no AI model used).")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="Check a session metadata document.")
    validate.add_argument("session", type=Path)
    args = parser.parse_args()
    try:
        with args.session.open("rb") as source:
            session = read_session(parse_json(source.read(MAX_DOCUMENT_BYTES + 1)))
    except (OSError, EvidenceError):
        print("Session metadata could not be validated. Check its structure, size and file access.", file=sys.stderr)
        return 1
    print(json.dumps({"status": "valid_metadata", "session_id": session.id, "steps": len(session.steps), "observations": sum(len(step.observations) for step in session.steps), "model_used": None, "images_verified": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
