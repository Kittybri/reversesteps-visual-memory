# Codex and Claude: first working slice

October 26, 2026. Shared goal: a real capture → lookup → recorded evidence loop, with an exceptional visual demo grounded in actual performance.

Codex owns `web/`, browser validation, documentation and integration. Claude owns new `reversesteps/server.py`, `reversesteps/meta_provider.py`, and their tests. Neither changes `evidence.py` without discussing the interface first. No old project source is reused. No live model calls until account readiness and suitable photos are established.

## Local HTTP contract

Run `py -m reversesteps.server --port 8765`. Bind 127.0.0.1; serve `web/` at `/`. No external runtime dependencies. Store photographs in the browser's IndexedDB; server does not persist them. Server sends media to Meta only on an explicit lookup action and when configured. Support JPEG/PNG only; browser normalizes uploads to JPEG.

- `GET /api/status` → `{ "provider": "meta", "model": "muse-spark-1.3", "ready": boolean, "message": string }`. Ready requires `MODEL_API_KEY` and `REVERSESTEPS_META_ENABLED=1`. Never expose the key.
- `POST /api/match` body `{ "session": <existing evidence schema>, "images": { "<image_id>": "data:image/jpeg;base64,..." }, "query": { "id": "query-...", "views": ["data:image/jpeg;base64,..."] } }`. Maximum 12 source images and 1–3 distinct query views, 16 MiB total JSON, 2 MiB decoded per image. The legacy query `data_url` field remains accepted instead of `views`. Source hash must match bytes. Validate all source metadata and proposal references; provider sees the exact normalized images behind the source hashes.
- Success → `{ "proposal": <existing check_proposal input>, "model": "muse-spark-1.3", "elapsed_ms": number, "usage"?: {"input_tokens"?: integer,"output_tokens"?: integer,"total_tokens"?: integer} }`. Usage is sanitized provider-reported counts, not a billing total.
- Error → HTTP 400/403/404/405/413/422/500/502/503 and `{ "error": { "code": string, "message": string } }`; safe useful messages, no provider credentials/raw response leaks. Extra HTTP status codes and exact image-set/query-prefix validation were accepted by Codex after Claude's review.

The server must enforce same-origin requests, reject unexpected Host headers and cross-origin POST, avoid path traversal, bound requests/timeouts, and never silently substitute sample results. Provider output is untrusted. No retry that doubles paid usage. Invalid visual identification can still cite valid IDs: make that limitation explicit.

## Product slice

Dark workshop aesthetic, lime evidence markings, large real photographs and a horizontal step strip. Capture/upload, note and mark a part region; local saved sessions; reverse playback; query upload; source highlights; specific follow-up question for ambiguity. Empty state is useful and honest. No fabricated model result or confidence percentage. Export/import lets users back up the local session including images.

## Strategy gates

Real recognition is not validated by passing unit tests. Before demo claims: two simple owned objects; distinctive part, similar fasteners, unrelated part, changed angle; label expected outcomes before calls and hold out query photos. Measure wrong matches, useful abstentions, latency and cost. SAM-based automatic regions and then/now comparison follow measured benefit, not feature count.
