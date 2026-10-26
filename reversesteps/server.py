"""Local ReverseSteps web server: serves web/ and forwards explicit lookups to Meta.

Binds 127.0.0.1 only, accepts same-origin requests with an expected Host header,
and stores nothing. Photographs reach Meta only through POST /api/match when the
provider is enabled. Run with ``py -m reversesteps.server --port 8765``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socketserver
import sys
import threading
import time
from typing import Any, Mapping
from urllib.parse import unquote, urlsplit

from . import meta_provider
from .evidence import EvidenceError, read_session
from .meta_provider import ImageInput, ProviderError, QueryInput

WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
MAX_BODY_BYTES = 16 * 1024 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_SOURCE_IMAGES = 12
MAX_QUERY_VIEWS = meta_provider.MAX_QUERY_VIEWS  # 12 sources + 3 views = at most 15 images per lookup
MAX_STATIC_BYTES = 8 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 30

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
_QUERY_ID = re.compile(r"query-[A-Za-z0-9._-]{1,74}")
_DATA_URL = re.compile(r"data:(image/jpeg|image/png);base64,([A-Za-z0-9+/]*={0,2})")
_MAX_ENCODED = (MAX_IMAGE_BYTES + 2) // 3 * 4
_SIGNATURES = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
_STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _strict_json(raw: bytes) -> Any:
    try:
        return meta_provider._strict_loads(raw)
    except (UnicodeError, ValueError, RecursionError):
        raise RequestError(400, "invalid_json", "Request body must be valid UTF-8 JSON without duplicate keys.") from None


def decode_image(image_id: str, value: Any) -> ImageInput:
    """Decode a JPEG/PNG data URL within the per-image limit, checking its file signature."""
    if not isinstance(value, str):
        raise RequestError(400, "invalid_image", f"Image {image_id} must be a data URL string.")
    if len(value) > _MAX_ENCODED + 40:
        raise RequestError(413, "image_too_large", f"Image {image_id} exceeds the 2 MiB limit.")
    match = _DATA_URL.fullmatch(value)
    if not match:
        raise RequestError(400, "invalid_image", f"Image {image_id} must be a base64 JPEG or PNG data URL.")
    media_type, encoded = match.groups()
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError:
        raise RequestError(400, "invalid_image", f"Image {image_id} has invalid base64 data.") from None
    if len(data) > MAX_IMAGE_BYTES:
        raise RequestError(413, "image_too_large", f"Image {image_id} exceeds the 2 MiB limit.")
    if not data.startswith(_SIGNATURES[media_type]):
        raise RequestError(422, "image_type_mismatch", f"Image {image_id} content does not match {media_type}.")
    return ImageInput(image_id, media_type, data)


def parse_match_request(body: Any):
    """Validate a /api/match body; return (session, sources, QueryInput) with verified source hashes."""
    if not isinstance(body, dict) or set(body) != {"session", "images", "query"}:
        raise RequestError(400, "invalid_request", "Request must contain exactly session, images and query.")
    try:
        session = read_session(body["session"])
    except EvidenceError as exc:
        raise RequestError(422, "invalid_session", str(exc)) from None
    if len(session.images) > MAX_SOURCE_IMAGES:
        raise RequestError(413, "too_many_images", f"A lookup supports at most {MAX_SOURCE_IMAGES} source images.")
    images = body["images"]
    if not isinstance(images, dict):
        raise RequestError(400, "invalid_request", "images must be an object keyed by image ID.")
    expected = {image.id for image in session.images}
    if set(images) != expected:
        raise RequestError(422, "source_images_mismatch", "images must contain exactly the session's recorded image IDs.")
    sources = {}
    for record in session.images:
        image = decode_image(record.id, images[record.id])
        if hashlib.sha256(image.data).hexdigest() != record.sha256:
            raise RequestError(422, "source_hash_mismatch", f"Image {record.id} does not match its recorded SHA-256 hash.")
        sources[record.id] = image
    return session, sources, parse_query(body["query"], expected)


def parse_query(query: Any, recorded_ids: set[str]) -> QueryInput:
    """Accept {id, views: [1-3 data URLs]} or the legacy {id, data_url}; never both."""
    if not isinstance(query, dict) or set(query) not in ({"id", "views"}, {"id", "data_url"}):
        raise RequestError(400, "invalid_request", "query must contain exactly id and views (or the legacy id and data_url).")
    query_id = query["id"]
    if not isinstance(query_id, str) or not _QUERY_ID.fullmatch(query_id) or not _ID.fullmatch(query_id):
        raise RequestError(422, "invalid_query", "query.id must be an identifier starting with 'query-'.")
    if query_id in recorded_ids:
        raise RequestError(422, "invalid_query", "query.id must differ from recorded image IDs.")
    if "data_url" in query:
        return QueryInput(query_id, (decode_image(query_id, query["data_url"]),))
    views = query["views"]
    if not isinstance(views, list) or not 1 <= len(views) <= MAX_QUERY_VIEWS:
        raise RequestError(422, "invalid_query", f"query.views must list 1 to {MAX_QUERY_VIEWS} photographs of the same part.")
    decoded = tuple(decode_image(f"{query_id} view {number}", view) for number, view in enumerate(views, 1))
    if len({view.data for view in decoded}) != len(decoded):
        raise RequestError(422, "duplicate_query_view", "Each query view must be a different photograph.")
    return QueryInput(query_id, decoded)


class ReverseStepsServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, port: int, web_root: Path, environ: Mapping[str, str]):
        super().__init__(("127.0.0.1", port), Handler)
        bound = self.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{bound}", f"localhost:{bound}"}
        self.allowed_origins = {f"http://{host}" for host in self.allowed_hosts}
        self.web_root = Path(web_root).resolve()
        self.environ = environ
        self.match_lock = threading.Lock()

    def server_bind(self):
        # Skip HTTPServer's reverse-DNS lookup (socket.getfqdn), which can stall on Windows.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class Handler(BaseHTTPRequestHandler):
    server: ReverseStepsServer
    server_version = "ReverseSteps"
    sys_version = ""
    timeout = SOCKET_TIMEOUT_SECONDS

    def log_message(self, format, *args):
        # Request lines only; bodies and headers are never logged.
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))

    def _common_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, code: str, message: str) -> None:
        self.close_connection = True
        self._send_json(status, {"error": {"code": code, "message": message}})

    def _path(self) -> str:
        target = urlsplit(self.path)
        if not self.path.startswith("/") or target.scheme or target.netloc:
            raise RequestError(400, "invalid_path", "Request target must be a path.")
        return target.path

    def _check_host(self) -> None:
        if (self.headers.get("Host") or "").lower() not in self.server.allowed_hosts:
            raise RequestError(400, "invalid_host", "Unexpected Host header.")

    def _handle(self, method: str) -> None:
        try:
            self._check_host()
            path = self._path()
            if path == "/api/status":
                if method != "GET":
                    raise RequestError(405, "method_not_allowed", "Use GET for /api/status.")
                self._send_json(200, meta_provider.provider_status(self.server.environ))
            elif path == "/api/match":
                if method != "POST":
                    raise RequestError(405, "method_not_allowed", "Use POST for /api/match.")
                self._match()
            elif path.startswith("/api/"):
                raise RequestError(404, "not_found", "Unknown API path.")
            elif method == "GET":
                self._static(path)
            else:
                raise RequestError(405, "method_not_allowed", "Only GET is supported for static files.")
        except RequestError as exc:
            self._send_error(exc.status, exc.code, exc.message)
        except ProviderError as exc:
            self._send_error(exc.status, exc.code, exc.message)
        except Exception:
            self._send_error(500, "internal_error", "The server could not complete the request.")

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")

    def _static(self, path: str) -> None:
        try:
            relative = unquote(path, errors="strict")
        except UnicodeError:
            raise RequestError(404, "not_found", "File not found.") from None
        if relative.endswith("/"):
            relative += "index.html"
        parts = relative.split("/")[1:]
        if any(not part or part.startswith(".") or any(c in part for c in '\\:\x00') for part in parts):
            raise RequestError(404, "not_found", "File not found.")
        target = self.server.web_root.joinpath(*parts)
        content_type = _STATIC_TYPES.get(target.suffix.lower())
        try:
            resolved = target.resolve(strict=True)
        except (OSError, RuntimeError):
            raise RequestError(404, "not_found", "File not found.") from None
        if content_type is None or not resolved.is_relative_to(self.server.web_root) or not resolved.is_file():
            raise RequestError(404, "not_found", "File not found.")
        with resolved.open("rb") as source:
            body = source.read(MAX_STATIC_BYTES + 1)
        if len(body) > MAX_STATIC_BYTES:
            raise RequestError(404, "not_found", "File not found.")
        self.send_response(200)
        self._common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        origin = self.headers.get("Origin")
        if origin is None or origin.lower() not in self.server.allowed_origins:
            raise RequestError(403, "forbidden_origin", "Lookups must come from this local page.")
        fetch_site = self.headers.get("Sec-Fetch-Site")
        if fetch_site is not None and fetch_site != "same-origin":
            raise RequestError(403, "forbidden_origin", "Lookups must come from this local page.")
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            raise RequestError(400, "invalid_content_type", "Content-Type must be application/json.")
        if self.headers.get("Transfer-Encoding") is not None:
            raise RequestError(400, "length_required", "Send a Content-Length; chunked bodies are not accepted.")
        length = self.headers.get("Content-Length")
        if length is None or not length.isdigit():
            raise RequestError(400, "length_required", "A valid Content-Length is required.")
        if int(length) > MAX_BODY_BYTES:
            raise RequestError(413, "body_too_large", "Request body exceeds the 16 MiB limit.")
        try:
            body = self.rfile.read(int(length))
        except TimeoutError:
            raise RequestError(400, "request_timeout", "Request body was not received in time.") from None
        if len(body) != int(length):
            raise RequestError(400, "incomplete_body", "Request body was shorter than its Content-Length.")
        return body

    def _match(self) -> None:
        session, sources, query = parse_match_request(_strict_json(self._read_body()))
        status = meta_provider.provider_status(self.server.environ)
        if not status["ready"]:
            raise RequestError(503, "provider_disabled", status["message"])
        if not self.server.match_lock.acquire(blocking=False):
            raise RequestError(503, "match_in_progress", "Another lookup is already running; wait for it to finish.")
        usage: dict = {}
        try:
            started = time.monotonic()
            proposal = meta_provider.propose_match(
                session, sources, query, self.server.environ["MODEL_API_KEY"].strip(), usage=usage)
            elapsed_ms = round((time.monotonic() - started) * 1000)
        finally:
            self.server.match_lock.release()
        result = {"proposal": proposal, "model": meta_provider.MODEL, "elapsed_ms": elapsed_ms}
        if usage:
            result["usage"] = usage
        self._send_json(200, result)


def create_server(port: int = 8765, *, web_root: Path = WEB_ROOT, environ: Mapping[str, str] | None = None) -> ReverseStepsServer:
    return ReverseStepsServer(port, web_root, os.environ if environ is None else environ)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ReverseSteps local web server (127.0.0.1 only).")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535.")
    server = create_server(args.port)
    ready = meta_provider.provider_status(server.environ)
    print(f"ReverseSteps at http://127.0.0.1:{args.port}/ - {ready['message']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
