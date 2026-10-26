"""Integrity checks for recorded observations and untrusted match proposals.

These checks establish valid source references, not correct visual recognition.
Image IDs are opaque identifiers; this module never resolves them as file paths.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any

MAX_DOCUMENT_BYTES = 256 * 1024
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
_HASH = re.compile(r"[0-9a-f]{64}")


class EvidenceError(ValueError):
    """A malformed record or a proposal that does not cite its source session."""


def _object(value: Any, fields: set[str], context: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise EvidenceError(f"{context} has missing or unsupported fields.")
    return value


def _text(value: Any, limit: int, context: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise EvidenceError(f"{context} must be a nonempty string of at most {limit} characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise EvidenceError(f"{context} must be valid UTF-8 text.") from None
    return value


def _identifier(value: Any, context: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise EvidenceError(f"{context} must be an opaque identifier, not a path or URL.")
    return value


def _array(value: Any, minimum: int, maximum: int, context: str) -> list:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise EvidenceError(f"{context} must contain {minimum} to {maximum} items.")
    return value


def _unique(values: list[str], context: str) -> None:
    if len(set(values)) != len(values):
        raise EvidenceError(f"{context} contains duplicate identifiers.")


def parse_json(raw: bytes) -> Any:
    """Read bounded strict JSON without duplicate keys or non-finite constants."""
    if not isinstance(raw, bytes) or len(raw) > MAX_DOCUMENT_BYTES:
        raise EvidenceError("JSON document exceeds the 256 KiB limit or is not bytes.")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise EvidenceError("JSON document contains a duplicate key.")
            result[key] = value
        return result

    def reject_constant(_):
        raise EvidenceError("JSON document contains a non-finite number.")

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        if isinstance(exc, EvidenceError):
            raise
        raise EvidenceError("Document must be bounded, valid UTF-8 JSON.") from None


@dataclass(frozen=True)
class ImageRecord:
    id: str
    sha256: str


@dataclass(frozen=True)
class Observation:
    id: str
    label: str
    box: tuple[float, float, float, float]


@dataclass(frozen=True)
class RecordedStep:
    id: str
    position: int
    image_id: str
    note: str
    observations: tuple[Observation, ...]


@dataclass(frozen=True)
class RecordedSession:
    id: str
    title: str
    images: tuple[ImageRecord, ...]
    steps: tuple[RecordedStep, ...]


def read_session(payload: Any) -> RecordedSession:
    data = _object(payload, {"schema_version", "id", "title", "images", "steps"}, "Session")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise EvidenceError("Unsupported session schema version.")
    session_id = _identifier(data["id"], "Session ID")
    title = _text(data["title"], 200, "Session title")
    images = []
    for item in _array(data["images"], 1, 64, "Images"):
        image = _object(item, {"id", "sha256"}, "Image")
        image_id = _identifier(image["id"], "Image ID")
        digest = image["sha256"]
        if not isinstance(digest, str) or not _HASH.fullmatch(digest):
            raise EvidenceError("Image hash must be a lowercase SHA-256 digest.")
        images.append(ImageRecord(image_id, digest))
    _unique([image.id for image in images], "Images")
    image_ids = {image.id for image in images}
    steps = []
    observation_ids = []
    for index, item in enumerate(_array(data["steps"], 1, 64, "Steps"), 1):
        step = _object(item, {"id", "position", "image_id", "note", "observations"}, "Step")
        step_id = _identifier(step["id"], "Step ID")
        if type(step["position"]) is not int or step["position"] != index:
            raise EvidenceError("Step positions must be consecutive and in recorded order, starting at 1.")
        image_id = _identifier(step["image_id"], "Step image ID")
        if image_id not in image_ids:
            raise EvidenceError("A step refers to an image absent from its session.")
        note = _text(step["note"], 2000, "Step note")
        observations = []
        for item_observation in _array(step["observations"], 0, 32, "Observations"):
            observation = _object(item_observation, {"id", "label", "box"}, "Observation")
            observation_id = _identifier(observation["id"], "Observation ID")
            label = _text(observation["label"], 200, "Observation label")
            box = _array(observation["box"], 4, 4, "Normalized region")
            if any(type(number) not in (int, float) or not 0 <= number <= 1 for number in box):
                raise EvidenceError("Region coordinates must be finite numbers.")
            left, top, right, bottom = box
            if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
                raise EvidenceError("Region must have positive area and lie inside the image.")
            observations.append(Observation(observation_id, label, tuple(float(number) for number in box)))
            observation_ids.append(observation_id)
        steps.append(RecordedStep(step_id, index, image_id, note, tuple(observations)))
    _unique([step.id for step in steps], "Steps")
    _unique(observation_ids, "Session observations")
    return RecordedSession(session_id, title, tuple(images), tuple(steps))


@dataclass(frozen=True)
class CandidateReference:
    step_id: str
    image_id: str
    observation_id: str


@dataclass(frozen=True)
class CheckedProposal:
    status: str
    candidates: tuple[CandidateReference, ...]
    rationale: str
    follow_up: str | None


def check_proposal(session: RecordedSession, query_image_id: str, payload: Any) -> CheckedProposal:
    """Check attribution and ambiguity framing; do not assess visual correctness.

    ``session`` must be the immutable snapshot returned by ``read_session`` for
    this request. The trusted caller supplies the expected query image ID.
    """
    expected_query = _identifier(query_image_id, "Expected query image ID")
    data = _object(payload, {"session_id", "query_image_id", "status", "candidates", "rationale", "follow_up"}, "Proposal")
    if data["session_id"] != session.id or data["query_image_id"] != expected_query:
        raise EvidenceError("Proposal belongs to a different session or query image.")
    status = data["status"]
    if not isinstance(status, str) or status not in {"suggested_match", "needs_more_evidence"}:
        raise EvidenceError("Unknown proposal status.")
    raw_candidates = _array(data["candidates"], 0, 3, "Candidates")
    if status == "suggested_match" and len(raw_candidates) != 1:
        raise EvidenceError("A suggested match must cite exactly one recorded observation.")
    follow_up = data["follow_up"]
    if status == "needs_more_evidence":
        follow_up = _text(follow_up, 1000, "Clarification request")
    elif follow_up is not None:
        raise EvidenceError("A suggested match must have a null clarification request.")
    rationale = _text(data["rationale"], 2000, "Proposal rationale")
    steps = {step.id: step for step in session.steps}
    candidates = []
    seen_observations = set()
    for item in raw_candidates:
        candidate = _object(item, {"step_id", "image_id", "observation_id"}, "Candidate")
        step_id = _identifier(candidate["step_id"], "Candidate step ID")
        image_id = _identifier(candidate["image_id"], "Candidate image ID")
        observation_id = _identifier(candidate["observation_id"], "Candidate observation ID")
        step = steps.get(step_id)
        if step is None or step.image_id != image_id or observation_id not in {observation.id for observation in step.observations}:
            raise EvidenceError("Candidate does not identify an observation in its recorded step and image.")
        if observation_id in seen_observations:
            raise EvidenceError("A proposal cannot repeat the same observation.")
        seen_observations.add(observation_id)
        candidates.append(CandidateReference(step_id, image_id, observation_id))
    return CheckedProposal(status, tuple(candidates), rationale, follow_up)
