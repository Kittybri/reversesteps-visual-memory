import base64
import hashlib
import http.client
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error

from reversesteps import meta_provider, server

KEY = "test-key-not-real-0123456789"
FRAMES = {"frame-1": b"\xff\xd8\xff\xe0synthetic-frame-one", "frame-2": b"\xff\xd8\xff\xe0synthetic-frame-two"}
QUERY_BYTES = b"\xff\xd8\xff\xe0synthetic-query"
READY = {"MODEL_API_KEY": KEY, "REVERSESTEPS_META_ENABLED": "1"}


def data_url(data, media_type="image/jpeg"):
    return f"data:{media_type};base64," + base64.b64encode(data).decode("ascii")


def session_payload(frames=FRAMES):
    names = list(frames)
    return {
        "schema_version": 1,
        "id": "desk-stand",
        "title": "Synthetic test session",
        "images": [{"id": name, "sha256": hashlib.sha256(data).hexdigest()} for name, data in frames.items()],
        "steps": [
            {"id": "remove-base", "position": 1, "image_id": names[0], "note": "Two short screws.", "observations": [
                {"id": "short-screw-a", "label": "Short screw", "box": [0.1, 0.2, 0.3, 0.4]},
                {"id": "short-screw-b", "label": "Similar short screw", "box": [0.4, 0.2, 0.6, 0.4]},
            ]},
            {"id": "remove-bracket", "position": 2, "image_id": names[1], "note": "Bracket removed.", "observations": [
                {"id": "support-bracket", "label": "Bracket", "box": [0.2, 0.1, 0.8, 0.9]},
            ]},
        ],
    }


SECOND_VIEW = b"\xff\xd8\xff\xe0synthetic-query-threaded-end"


def match_body(frames=FRAMES, query_id="query-loose-1", query_bytes=QUERY_BYTES, views=None):
    query = {"id": query_id, "data_url": data_url(query_bytes)} if views is None else {"id": query_id, "views": views}
    return {
        "session": session_payload(frames),
        "images": {name: data_url(data) for name, data in frames.items()},
        "query": query,
    }


def proposal(**changes):
    value = {
        "session_id": "desk-stand",
        "query_image_id": "query-loose-1",
        "status": "suggested_match",
        "candidates": [{"step_id": "remove-bracket", "image_id": "frame-2", "observation_id": "support-bracket"}],
        "rationale": "Mocked provider text for tests; not a model result.",
        "follow_up": None,
    }
    value.update(changes)
    return value


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def meta_reply(payload, usage=None):
    text = json.dumps(payload)
    envelope = {"id": "resp_test", "object": "response", "status": "completed", "error": None, "incomplete_details": None,
                "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}]}
    if usage is not None:
        envelope["usage"] = usage
    return mock.Mock(return_value=FakeResponse(json.dumps(envelope).encode()))


def sent_images(opener):
    sent = json.loads(opener.call_args.args[0].data)
    return [block["image_url"] for block in sent["input"][0]["content"] if block["type"] == "input_image"]


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        web = base / "web"
        web.mkdir()
        (web / "index.html").write_text("<!doctype html><title>ReverseSteps</title>", encoding="utf-8")
        (web / "app.js").write_text("console.log('ok');", encoding="utf-8")
        (web / ".env").write_text("SECRET-HIDDEN", encoding="utf-8")
        (web / "notes.txt").write_text("SECRET-UNLISTED-TYPE", encoding="utf-8")
        (base / "secret.html").write_text("SECRET-OUTSIDE", encoding="utf-8")
        self.environ = dict(READY)
        self.server = server.create_server(0, web_root=web, environ=self.environ)
        self.port = self.server.server_address[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(self, payload, headers=None, raw=None):
        body = raw if raw is not None else json.dumps(payload).encode()
        merged = {"Origin": self.origin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin"}
        merged.update(headers or {})
        status, response_headers, data = self.request("POST", "/api/match", body, merged)
        return status, json.loads(data)

    def assertError(self, result, status, code):
        self.assertEqual(result[0], status, result[1])
        self.assertEqual(set(result[1]), {"error"})
        self.assertEqual(result[1]["error"]["code"], code)
        self.assertIsInstance(result[1]["error"]["message"], str)

    def test_server_binds_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_status_reports_readiness_without_key(self):
        status, headers, body = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["ready"], True)
        self.assertNotIn(KEY.encode(), body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.environ["REVERSESTEPS_META_ENABLED"] = "0"
        status, _, body = self.request("GET", "/api/status")
        self.assertEqual(json.loads(body)["ready"], False)

    def test_static_files_are_served_with_safety_headers(self):
        for path, marker in [("/", b"ReverseSteps"), ("/index.html", b"ReverseSteps"), ("/app.js?v=1", b"console")]:
            with self.subTest(path=path):
                status, headers, body = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertIn(marker, body)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_path_traversal_hidden_and_unlisted_files_are_refused(self):
        for path in ["/../secret.html", "/%2e%2e/secret.html", "/..%2fsecret.html", "/..%5csecret.html", "/%2e%2e%5csecret.html",
                     "/.env", "/notes.txt", "/index.html%00.js", "/C:/Windows/win.ini", "/%ff.html", "//evil.example/index.html",
                     "/missing.html", "/web/../../secret.html"]:
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertIn(status, (400, 404))
                self.assertNotIn(b"SECRET", body)

    def test_unexpected_host_is_rejected(self):
        for host in ["evil.example", f"evil.example:{self.port}", f"127.0.0.1:{self.port + 1}", ""]:
            with self.subTest(host=host):
                status, _, body = self.request("GET", "/api/status", headers={"Host": host})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body)["error"]["code"], "invalid_host")
        status, _, _ = self.request("GET", "/api/status", headers={"Host": f"localhost:{self.port}"})
        self.assertEqual(status, 200)

    def test_cross_origin_and_malformed_posts_are_rejected_before_provider(self):
        opener = mock.Mock()
        body = match_body()
        with mock.patch.object(meta_provider, "_open", opener):
            self.assertError(self.post(body, {"Origin": "http://evil.example"}), 403, "forbidden_origin")
            self.assertError(self.post(body, {"Origin": f"http://localhost:{self.port + 1}"}), 403, "forbidden_origin")
            self.assertError(self.post(body, {"Sec-Fetch-Site": "cross-site"}), 403, "forbidden_origin")
            self.assertError(self.post(body, {"Content-Type": "text/plain"}), 400, "invalid_content_type")
            status, _, raw = self.request("POST", "/api/match", json.dumps(body).encode(), {"Content-Type": "application/json"})
            self.assertEqual((status, json.loads(raw)["error"]["code"]), (403, "forbidden_origin"))
        opener.assert_not_called()

    def test_body_limits_and_json_errors(self):
        self.assertError(self.post(None, {"Content-Length": str(server.MAX_BODY_BYTES + 1)}, raw=b"{}"), 413, "body_too_large")
        self.assertError(self.post(None, raw=b"{not json"), 400, "invalid_json")
        self.assertError(self.post(None, raw=b'{"session":1,"session":2}'), 400, "invalid_json")
        self.assertError(self.post(None, raw=b"[" * 100000), 400, "invalid_json")
        self.assertError(self.post(dict(match_body(), extra=True)), 400, "invalid_request")

    def test_method_and_api_path_restrictions(self):
        status, _, body = self.request("GET", "/api/match")
        self.assertEqual((status, json.loads(body)["error"]["code"]), (405, "method_not_allowed"))
        status, _, body = self.request("POST", "/api/other", b"{}", {"Origin": self.origin, "Content-Type": "application/json"})
        self.assertEqual(status, 404)
        status, _, _ = self.request("PUT", "/index.html", b"x")
        self.assertEqual(status, 405)

    def test_source_hash_must_match_bytes(self):
        body = match_body()
        body["images"]["frame-2"] = data_url(b"\xff\xd8\xff\xe0tampered")
        self.assertError(self.post(body), 422, "source_hash_mismatch")

    def test_image_set_type_and_size_are_enforced(self):
        body = match_body()
        del body["images"]["frame-2"]
        self.assertError(self.post(body), 422, "source_images_mismatch")
        body = match_body()
        body["images"]["extra"] = data_url(b"\xff\xd8\xff")
        self.assertError(self.post(body), 422, "source_images_mismatch")
        body = match_body()
        body["query"]["data_url"] = data_url(b"GIF89a", "image/gif")
        self.assertError(self.post(body), 400, "invalid_image")
        body = match_body()
        body["query"]["data_url"] = "data:image/jpeg;base64,@@@"
        self.assertError(self.post(body), 400, "invalid_image")
        body = match_body()
        body["query"]["data_url"] = data_url(b"\x89PNG\r\n\x1a\nnot-a-jpeg")
        self.assertError(self.post(body), 422, "image_type_mismatch")
        body = match_body(query_bytes=b"\xff\xd8\xff" + b"\0" * server.MAX_IMAGE_BYTES)
        self.assertError(self.post(body), 413, "image_too_large")
        many = {f"frame-{index}": b"\xff\xd8\xff" + bytes([index]) for index in range(13)}
        self.assertError(self.post(match_body(frames=many)), 413, "too_many_images")

    def test_session_and_query_ids_are_validated(self):
        body = match_body()
        body["session"]["steps"][0]["image_id"] = "../photo"
        self.assertError(self.post(body), 422, "invalid_session")
        for query_id in ["loose-1", "query-../x", "frame-1", 7]:
            with self.subTest(query_id=query_id):
                self.assertError(self.post(match_body(query_id=query_id)), 422, "invalid_query")

    def test_provider_disabled_makes_no_network_call(self):
        opener = mock.Mock()
        for environ in [{}, {"MODEL_API_KEY": KEY}, {"REVERSESTEPS_META_ENABLED": "1"}]:
            with self.subTest(environ=environ):
                self.environ.clear()
                self.environ.update(environ)
                with mock.patch.object(meta_provider, "_open", opener):
                    result = self.post(match_body())
                self.assertError(result, 503, "provider_disabled")
                self.assertNotIn(KEY, json.dumps(result[1]))
        opener.assert_not_called()

    def test_valid_round_trip_with_mocked_meta(self):
        opener = meta_reply(proposal())
        with mock.patch.object(meta_provider, "_open", opener):
            status, result = self.post(match_body())
        self.assertEqual(status, 200, result)
        self.assertEqual(set(result), {"proposal", "model", "elapsed_ms"})
        self.assertEqual(result["proposal"], proposal())
        self.assertEqual(result["model"], "muse-spark-1.3")
        self.assertIsInstance(result["elapsed_ms"], int)
        opener.assert_called_once()
        sent = json.loads(opener.call_args.args[0].data)
        urls = [block["image_url"] for block in sent["input"][0]["content"] if block["type"] == "input_image"]
        self.assertEqual(urls, [data_url(FRAMES["frame-1"]), data_url(FRAMES["frame-2"]), data_url(QUERY_BYTES)])

    def test_multiview_round_trip_sends_first_and_second_view_under_original_query_id(self):
        opener = meta_reply(proposal())
        body = match_body(views=[data_url(QUERY_BYTES), data_url(SECOND_VIEW)])
        with mock.patch.object(meta_provider, "_open", opener):
            status, result = self.post(body)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["proposal"]["query_image_id"], "query-loose-1")
        opener.assert_called_once()
        self.assertEqual(sent_images(opener), [data_url(FRAMES["frame-1"]), data_url(FRAMES["frame-2"]),
                                               data_url(QUERY_BYTES), data_url(SECOND_VIEW)])

    def test_single_view_list_matches_legacy_data_url_request(self):
        legacy, listed = meta_reply(proposal()), meta_reply(proposal())
        with mock.patch.object(meta_provider, "_open", legacy):
            self.assertEqual(self.post(match_body())[0], 200)
        with mock.patch.object(meta_provider, "_open", listed):
            self.assertEqual(self.post(match_body(views=[data_url(QUERY_BYTES)]))[0], 200)
        self.assertEqual(legacy.call_args.args[0].data, listed.call_args.args[0].data)

    def test_malformed_query_views_are_rejected_before_provider(self):
        opener = mock.Mock()
        mixed = match_body()
        mixed["query"]["views"] = [data_url(SECOND_VIEW)]
        neither = match_body()
        del neither["query"]["data_url"]
        cases = [
            (mixed, 400, "invalid_request"),
            (neither, 400, "invalid_request"),
            (match_body(views=[]), 422, "invalid_query"),
            (match_body(views=data_url(QUERY_BYTES)), 422, "invalid_query"),
            (match_body(views=[data_url(QUERY_BYTES + bytes([n])) for n in range(4)]), 422, "invalid_query"),
            (match_body(views=[data_url(QUERY_BYTES), data_url(QUERY_BYTES)]), 422, "duplicate_query_view"),
            (match_body(views=[data_url(QUERY_BYTES), None]), 400, "invalid_image"),
            (match_body(views=[data_url(QUERY_BYTES), "data:image/gif;base64,R0lGODlh"]), 400, "invalid_image"),
            (match_body(views=[data_url(QUERY_BYTES), data_url(b"\x89PNG\r\n\x1a\nx")]), 422, "image_type_mismatch"),
            (match_body(views=[data_url(QUERY_BYTES), data_url(b"\xff\xd8\xff" + b"\0" * server.MAX_IMAGE_BYTES)]), 413, "image_too_large"),
            (match_body(query_id="frame-1", views=[data_url(QUERY_BYTES)]), 422, "invalid_query"),
        ]
        with mock.patch.object(meta_provider, "_open", opener):
            for body, status, code in cases:
                with self.subTest(code=code, query=list(body["query"])):
                    self.assertError(self.post(body), status, code)
        opener.assert_not_called()

    def test_twelve_sources_and_three_views_reach_provider_as_fifteen_images(self):
        frames = {f"frame-{index}": b"\xff\xd8\xff" + bytes([index]) for index in range(12)}
        views = [data_url(QUERY_BYTES + bytes([n])) for n in range(3)]
        opener = meta_reply(dict(proposal(), candidates=[{"step_id": "remove-bracket", "image_id": "frame-1", "observation_id": "support-bracket"}]))
        with mock.patch.object(meta_provider, "_open", opener):
            status, result = self.post(match_body(frames=frames, views=views))
        self.assertEqual(status, 200, result)
        self.assertEqual(len(sent_images(opener)), 15)
        self.assertEqual(sent_images(opener)[-3:], views)

    def test_usage_is_returned_only_when_sanitized_counts_exist(self):
        counts = {"input_tokens": 5000, "output_tokens": 300, "total_tokens": 5300}
        with mock.patch.object(meta_provider, "_open", meta_reply(proposal(), dict(counts, cost="ignored"))):
            status, result = self.post(match_body())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["usage"], counts)
        with mock.patch.object(meta_provider, "_open", meta_reply(proposal(), {"input_tokens": -5, "total_tokens": "9"})):
            status, result = self.post(match_body())
        self.assertEqual(status, 200, result)
        self.assertNotIn("usage", result)
        self.assertEqual(result["proposal"], proposal())

    def test_invalid_output_references_return_502(self):
        bad = proposal(candidates=[{"step_id": "remove-base", "image_id": "frame-1", "observation_id": "support-bracket"}])
        with mock.patch.object(meta_provider, "_open", meta_reply(bad)):
            self.assertError(self.post(match_body()), 502, "invalid_proposal")

    def test_provider_errors_are_sanitized(self):
        leaked = f"secret {KEY} raw-provider-body".encode()
        failure = urllib.error.HTTPError(meta_provider.API_URL, 401, "Unauthorized", {}, io.BytesIO(leaked))
        with mock.patch.object(meta_provider, "_open", mock.Mock(side_effect=failure)):
            result = self.post(match_body())
        self.assertError(result, 503, "provider_auth")
        self.assertNotIn(KEY, json.dumps(result[1]))
        self.assertNotIn("raw-provider-body", json.dumps(result[1]))
        with mock.patch.object(meta_provider, "propose_match", mock.Mock(side_effect=RuntimeError(f"boom {KEY}"))):
            result = self.post(match_body())
        self.assertError(result, 500, "internal_error")
        self.assertNotIn(KEY, json.dumps(result[1]))

    def test_concurrent_lookup_is_refused_not_queued(self):
        opener = mock.Mock()
        self.server.match_lock.acquire()
        try:
            with mock.patch.object(meta_provider, "_open", opener):
                self.assertError(self.post(match_body()), 503, "match_in_progress")
        finally:
            self.server.match_lock.release()
        opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
