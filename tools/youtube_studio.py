#!/usr/bin/env python3
"""Serve the studio and an on-demand YouTube audio input on loopback."""

import argparse
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DIST = Path(__file__).resolve().parents[1] / "dist"
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
MARKER = b'<meta name="music-style-input" content="local-youtube">'
CLIP_SECONDS = 30
RATE = 24000
MAX_WAV_BYTES = RATE * CLIP_SECONDS * 2 + 4096


class ClipError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def run_command(command, timeout, disconnected):
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryFile() as stderr:
        with subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=stderr, start_new_session=os.name != "nt",
        ) as process:
            try:
                while process.poll() is None:
                    if disconnected():
                        raise ClipError("canceled")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ClipError("timeout")
                    try:
                        process.wait(timeout=min(remaining, 0.25))
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                            capture_output=True, check=False,
                        )
                        process.kill()
                    else:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            stderr.seek(max(0, stderr.tell() - 16384))
            return process.returncode, stderr.read().decode("utf-8", errors="replace")


def download_clip(video_id, disconnected, offset=0):
    with tempfile.TemporaryDirectory(prefix="music-style-") as folder:
        work = Path(folder)
        command = [
            sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist",
            "--no-cache-dir", "--no-progress", "--no-part", "--no-mtime",
            "--retries", "1", "--extractor-retries", "1", "--socket-timeout", "8",
            "--match-filters", "!is_live", "--max-filesize", "64M",
            "--format", "bestaudio/best",
            "--download-sections", f"*{offset}-{offset + CLIP_SECONDS}",
            "--output", str(work / "input.%(ext)s"),
        ]
        if shutil.which("node"):
            command.extend(["--js-runtimes", "node"])
        command.extend(["--", "https://www.youtube.com/watch?v=" + video_id])
        code, error = run_command(command, 50, disconnected)
        inputs = [file for file in work.glob("input.*") if file.is_file()]
        if code or len(inputs) != 1:
            print(error.strip()[-1800:], file=sys.stderr)
            raise ClipError("unavailable")

        wav = work / "clip.wav"
        code, error = run_command(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
             "-protocol_whitelist", "file", "-i", str(inputs[0]),
             "-t", str(CLIP_SECONDS), "-vn", "-ac", "1", "-ar", str(RATE),
             "-c:a", "pcm_s16le", "-f", "wav", str(wav)],
            10, disconnected,
        )
        if code or not wav.is_file():
            print(error.strip()[-1800:], file=sys.stderr)
            raise ClipError("invalid-audio")
        if not RATE * 2 * 2 <= wav.stat().st_size <= MAX_WAV_BYTES:
            raise ClipError("invalid-audio")
        return wav.read_bytes()


class StudioServer(ThreadingHTTPServer):
    daemon_threads = False

    def __init__(self, address, handler):
        super().__init__(address, handler)
        self.stopping = threading.Event()
        self.download_slot = threading.BoundedSemaphore()


class StudioHandler(SimpleHTTPRequestHandler):
    # Bound reads as well as subprocesses, including a partial HTTP request.
    timeout = 8

    def __init__(self, *args, directory=DIST, **kwargs):
        super().__init__(*args, directory=str(directory), **kwargs)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def allowed_host(self):
        return self.headers.get("Host") == self.origin.removeprefix("http://")

    def send_data(self, status, content_type, content, *, head=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        if not head:
            self.wfile.write(content)

    def send_api_error(self, status, code):
        self.send_data(status, "application/json", json.dumps({"error": code}).encode())

    def serve_page(self, head=False):
        if not self.allowed_host():
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            page = (Path(self.directory) / "index.html").read_bytes()
            page = page.replace(b"</head>", MARKER + b"\n</head>", 1)
            self.send_data(200, "text/html; charset=utf-8", page, head=head)
        elif head:
            super().do_HEAD()
        else:
            super().do_GET()

    def do_GET(self):
        self.serve_page()

    def do_HEAD(self):
        self.serve_page(head=True)

    def disconnected(self):
        if self.server.stopping.is_set():
            return True
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and not self.connection.recv(1, socket.MSG_PEEK)
        except OSError:
            return True

    def do_POST(self):
        if urlsplit(self.path).path != "/api/youtube-clip":
            self.send_api_error(404, "not-found")
            return
        if not self.allowed_host() or self.headers.get("Origin") != self.origin:
            self.send_api_error(403, "forbidden")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 128 or self.headers.get_content_type() != "application/json":
                raise ValueError
            data = json.loads(self.rfile.read(length))
            video_id = data.get("id") if isinstance(data, dict) else None
            offset = data.get("offset", 0) if isinstance(data, dict) else None
            if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
                raise ValueError
            if type(offset) is not int or not 0 <= offset <= 8 * 60 * 60:
                raise ValueError
        except (ValueError, OSError):
            self.send_api_error(400, "invalid-input")
            return
        if not self.server.download_slot.acquire(timeout=0.75):
            self.send_api_error(409, "busy")
            return
        try:
            try:
                wav = download_clip(video_id, self.disconnected, offset)
            except ClipError as error:
                if error.code != "canceled":
                    status = 504 if error.code == "timeout" else 422
                    self.send_api_error(status, error.code)
            except OSError as error:
                print(error, file=sys.stderr)
                self.send_api_error(502, "invalid-audio")
            else:
                self.send_data(200, "audio/wav", wav)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.server.download_slot.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not all(shutil.which(tool) for tool in ("ffmpeg", "ffprobe")):
        parser.exit(1, "ffmpeg and ffprobe must be installed and on PATH.\n")
    check = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True)
    if check.returncode:
        parser.exit(1, 'Install yt-dlp using python -m pip install -U "yt-dlp[default]".\n')
    with StudioServer(("127.0.0.1", args.port), StudioHandler) as server:
        print(f"Music Style Compiler: http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.stopping.set()


if __name__ == "__main__":
    main()
