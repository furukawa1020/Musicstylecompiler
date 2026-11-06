import http.client
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.youtube_studio import ClipError, MARKER, StudioHandler, StudioServer, download_clip


class LocalStudioTest(unittest.TestCase):
    def setUp(self):
        self.server = StudioServer(("127.0.0.1", 0), StudioHandler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        self.thread.start()
        self.addCleanup(self.thread.join)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, data=None, **headers):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            connection.close()

    def post(self, data, origin=None):
        return self.request("POST", "/api/youtube-clip", json.dumps(data),
                            **{"Origin": origin or self.origin, "Content-Type": "application/json"})

    def test_studio_enables_exact_recordings_only_on_loopback(self):
        status, _, html = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(MARKER, html)
        status, _, _ = self.request("GET", "/", Host="foreign.test")
        self.assertEqual(status, 403)

    def test_exact_id_and_timestamp_return_wav(self):
        with patch("tools.youtube_studio.download_clip", return_value=b"RIFF example") as download:
            status, mime, data = self.post({"id": "dQw4w9WgXcQ", "offset": 42})
            self.assertEqual((status, mime, data), (200, "audio/wav", b"RIFF example"))
            args = download.call_args.args
            self.assertEqual((args[0], args[2]), ("dQw4w9WgXcQ", 42))

    def test_rejects_cross_origin_arbitrary_url_and_invalid_offset(self):
        with patch("tools.youtube_studio.download_clip") as download:
            self.assertEqual(self.post({"id": "dQw4w9WgXcQ"}, "https://foreign.test")[0], 403)
            self.assertEqual(self.post({"id": "https://example.com/"})[0], 400)
            self.assertEqual(self.post({"id": "dQw4w9WgXcQ", "offset": -1})[0], 400)
            self.assertEqual(self.post({"id": "dQw4w9WgXcQ", "offset": True})[0], 400)
            download.assert_not_called()

    def test_timeout_returns_error_and_releases_slot(self):
        with patch("tools.youtube_studio.download_clip", side_effect=ClipError("timeout")):
            status, _, body = self.post({"id": "dQw4w9WgXcQ"})
            self.assertEqual((status, json.loads(body)), (504, {"error": "timeout"}))
        self.assertTrue(self.server.download_slot.acquire(timeout=1))
        self.server.download_slot.release()

    def test_download_is_bounded_and_uses_exact_watch_url(self):
        def run_command(command, timeout, disconnected):
            if command[0] != "ffmpeg":
                self.assertIn("*35-65", command)
                self.assertEqual(command[-1], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
                path = Path(command[command.index("--output") + 1].replace("%(ext)s", "webm"))
                path.write_bytes(b"example")
            else:
                self.assertEqual(command[command.index("-t") + 1], "30")
                Path(command[-1]).write_bytes(b"RIFF" + b"\0" * 100000)
            return 0, ""

        with patch("tools.youtube_studio.run_command", side_effect=run_command):
            data = download_clip("dQw4w9WgXcQ", lambda: False, 35)
            self.assertTrue(data.startswith(b"RIFF"))
