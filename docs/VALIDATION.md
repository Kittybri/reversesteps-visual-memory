# Validation record — October 26, 2026

## Completed offline checks

- Python evidence, provider and local HTTP tests run by Codex. Provider network calls are mocked: source hash checking, proposal attribution, ambiguity, refusals, incomplete output, malformed JSON, safe errors, host/origin restrictions, file traversal and disabled-provider behavior are exercised.
- DOM interaction checks run by Codex: backup restore and local persistence, reverse playback, corrupt image hashes, invalid regions/duplicate references, clarification and source navigation, inert model text, failed lookups and source deletion.
- JavaScript syntax checked with Node. HTML/CSS/JS formatted for review.

Final checks: **57 Python tests and 13 DOM interaction tests passed**, including multi-view request ordering, original query attribution, sanitized usage reporting, recovery after failed restoration and highlight persistence. No unit-test result is a visual recognition result.

## Not verified yet

- Real browser rendering, touch/pointer drawing, photo decoding/rotation and downloads. Browser automation was disabled in the user's Work settings during this turn. DOM tests intentionally mock layout and image loading; visual quality remains subject to a real browser check.
- Meta account credits/access and Responses strict JSON compatibility with the selected model.
- Recognition accuracy, unknown-part rejection, useful follow-up questions, real latency and API cost.
- Cross-device access: this iteration is loopback only. Phone photos must be transferred/uploaded on the laptop.
- Images are checked by size, hash and file signature on the server; the server does not fully decode every JPEG/PNG. The browser decodes imported photos.

## Next measured experiment

The user selected a chess set as the first test object. See [CHESS_TEST.md](CHESS_TEST.md) for capture order, distinct pieces, identical-pawn ambiguity and foreign-piece cases. The generic repair protocol below remains the broader product evaluation.

Use a simple object the user owns. Capture 5–8 removal steps, with removed parts visible next to the object. Mark relevant regions and label expected answers before lookup. Set aside fresh query photos for: a distinctive piece, two similar pieces, a changed angle, and a foreign part absent from the recorded session. Repeat a small fixed set to assess stability; do not retune prompts on the held-out examples.

Log model/configuration, query and source hashes, expected observation IDs, returned candidates/status, reviewer correctness, useful clarification, elapsed time and actual provider usage. Count **model no-answer**, **wrong match** and **transport/API error** separately. A 502 is not a successful uncertainty judgment. Keep photos and raw results private unless cleared for distribution.

Only claim demonstrated results. Use the winning demo's intended sequence—mystery part → source evidence → ambiguity → useful new view → second-person rebuild—when every step works with actual photographs. Do not equate visually similar fasteners with mechanically interchangeable ones.
