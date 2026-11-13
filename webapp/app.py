#!/usr/bin/env python3
"""AutoCaption Web — a local web app for word-timing JSON files.

    app.py [--port 8765] [--host 127.0.0.1]

Open the printed URL, drop an audio or video file on the page, and it comes back
as the word-timing JSON the EffectCraft AutoCaption panel reads (plus an SRT).

Everything runs on this machine: ffmpeg decodes the audio, faster-whisper
transcribes it, and the same grouping/timing code the CLI tool uses turns the
words into caption lines. Standard library only — no web framework needed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(SKILL / "scripts"))

import word_timing as wt  # noqa: E402
import providers as P  # noqa: E402

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
TMPDIR = Path(tempfile.gettempdir()) / "autocaption-web"
TMPDIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------- helpers

def set_job(jid: str, **kw) -> dict:
    with JOBS_LOCK:
        job = JOBS.setdefault(jid, {"id": jid, "state": "queued", "progress": 0, "message": ""})
        job.update(kw)
        return job


def get_job(jid: str) -> dict | None:
    with JOBS_LOCK:
        return JOBS.get(jid)


def srt_text(lines: list[dict]) -> str:
    return wt.srt_string(lines)


def run_job(jid: str, media: Path, opts: dict) -> None:
    try:
        media_info = wt.probe(media)
        duration = media_info["duration"] or 0.0
        opts["_duration"] = duration

        def report(percent: float, message: str = "") -> None:
            set_job(jid, progress=int(max(0, min(99, percent))), message=message)

        set_job(jid, state="running", message="Decoding the audio…", progress=1)
        words, used = P.transcribe_with_provider(media, opts, report)
        result = {
            "json": wt.to_panel_json(
                wt.time_lines(wt.group_lines(words, opts["max_words"], opts["max_chars"], opts["pause"]),
                              opts["lead"], opts["hold"]),
                opts.get("fps")),
        }
        result["srt"] = wt.srt_string(wt.time_lines(
            wt.group_lines(words, opts["max_words"], opts["max_chars"], opts["pause"]),
            opts["lead"], opts["hold"]))
        result["lines"] = len(result["json"])
        result["words"] = sum(len(l["words"]) for l in result["json"])
        result["duration"] = round(duration, 2)
        result["model"] = used
        result["provider"] = opts.get("provider", "local")
        print(f"job {jid[:8]} done: {result['lines']} lines, {result['words']} words "
              f"via {used}", flush=True)
        set_job(jid, state="done", progress=100, message="Done", result=result)
    except Exception as e:  # the page shows the message
        print(f"job {jid[:8]} failed: {e}", flush=True)
        set_job(jid, state="error", message=str(e))
    finally:
        try:
            media.unlink(missing_ok=True)
        except Exception:
            pass


def convert_text(text: str) -> dict:
    """Parse a pasted JSON or SRT into the panel format — no transcription."""
    t = str(text or "").strip()
    if not t:
        raise ValueError("Nothing to read.")
    if t[0] in "[{":
        lines = wt.normalize_lines(json.loads(t))
        kind = "json"
    else:
        lines = wt.parse_srt_text(t)
        kind = "srt"
    data = wt.to_panel_json(lines)
    nwords = sum(len(l["words"]) for l in data)
    return {"json": data, "srt": wt.srt_string(lines), "lines": len(data),
            "words": nwords, "kind": kind}


# ------------------------------------------------------- the panel's service

TRANSCRIBER_HOST = "127.0.0.1"
TRANSCRIBER_PORT = 8787
TRANSCRIBER = None


def transcriber_running() -> bool:
    import socket
    try:
        with socket.create_connection((TRANSCRIBER_HOST, TRANSCRIBER_PORT), 1):
            return True
    except OSError:
        return False


def start_transcriber() -> tuple[bool, str]:
    """Start the transcriber service (the panel asks for this over HTTP)."""
    global TRANSCRIBER
    if transcriber_running():
        return True, "The transcriber is already running."
    script = HERE / "transcriber.py"
    if not script.exists():
        return False, "transcriber.py is missing next to the app."
    try:
        TRANSCRIBER = subprocess.Popen(
            [sys.executable, str(script), "--port", str(TRANSCRIBER_PORT)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, start_new_session=True)
    except Exception as e:
        return False, "could not start the transcriber: " + str(e)
    for _ in range(30):
        time.sleep(0.2)
        if transcriber_running():
            return True, "The transcriber is running."
    return False, "the transcriber did not come up — run run-transcriber.sh by hand."


# --------------------------------------------------------------------- server

class Handler(BaseHTTPRequestHandler):
    server_version = "AutoCaptionWeb/1.0"

    def log_message(self, fmt, *args):  # keep the console quiet
        if os.environ.get("AUTOCAPTION_VERBOSE"):
            super().log_message(fmt, *args)

    # -- helpers
    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    # -- routes
    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            html = (HERE / "index.html").read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        if path.startswith("/") and "/" not in path[1:]:
            # the page's own files (caption-core.js, whisper-worker.js, …)
            name = path[1:]
            if re.fullmatch(r"[A-Za-z0-9._-]+\.(html|js|css|json|svg|png|ico|webmanifest)", name):
                f = HERE / name
                if f.is_file():
                    ctype = {"html": "text/html; charset=utf-8",
                             "js": "text/javascript; charset=utf-8",
                             "css": "text/css; charset=utf-8",
                             "json": "application/json; charset=utf-8",
                             "svg": "image/svg+xml", "png": "image/png",
                             "ico": "image/x-icon",
                             "webmanifest": "application/manifest+json"}[name.rsplit(".", 1)[1]]
                    self._send(200, f.read_bytes(), ctype)
                    return
        if path == "/api/health":
            self._json({"ok": True, "providers": P.provider_info()})
            return
        if path == "/api/transcriber":
            self._json({"running": transcriber_running(),
                        "host": TRANSCRIBER_HOST, "port": TRANSCRIBER_PORT})
            return
        if path == "/api/job":
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            jid = (q.get("id") or [""])[0]
            job = get_job(jid)
            if not job:
                self._json({"error": "unknown job"}, 404)
                return
            self._json(job)
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        from urllib.parse import parse_qs, urlparse
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/transcribe":
            name = (q.get("name") or ["media"])[0]
            safe = "".join(c for c in name if c.isalnum() or c in "._- ") or "media"
            media = TMPDIR / (uuid.uuid4().hex + "_" + safe)
            try:
                media.write_bytes(self._body())
            except Exception as e:
                self._json({"error": str(e)}, 500)
                return
            opts = {
                "model": (q.get("model") or ["small.en"])[0],
                "provider": (q.get("provider") or ["local"])[0].lower(),
                "language": (q.get("language") or [""])[0] or None,
                "max_words": int((q.get("max_words") or ["7"])[0]),
                "max_chars": int((q.get("max_chars") or ["38"])[0]),
                "pause": float((q.get("pause") or ["1.0"])[0]),
                "lead": float((q.get("lead") or ["0.05"])[0]),
                "hold": float((q.get("hold") or ["0.7"])[0]),
                "fps": float((q.get("fps") or ["0"])[0]) or None,
            }
            jid = uuid.uuid4().hex
            set_job(jid, state="queued", progress=0, message="Waiting…",
                    name=name, options=opts)
            threading.Thread(target=run_job, args=(jid, media, opts), daemon=True).start()
            self._json({"job": jid})
            return
        if u.path == "/api/start-transcriber":
            running, message = start_transcriber()
            self._json({"ok": running, "message": message}, 200 if running else 200)
            return
        if u.path == "/api/convert":
            text = self._body().decode("utf-8", "replace")
            try:
                self._json(convert_text(text))
            except Exception as e:
                self._json({"error": str(e)}, 400)
            return
        self._json({"error": "not found"}, 404)


def main() -> None:
    ap = argparse.ArgumentParser(description="AutoCaption Web — word-timing JSON in the browser.")
    ap.add_argument("--port", type=int, default=int(os.environ.get("AUTOCAPTION_PORT", "8765")))
    ap.add_argument("--host", default=os.environ.get("AUTOCAPTION_HOST", "127.0.0.1"))
    ap.add_argument("--open", action="store_true", help="open the page in a browser")
    args = ap.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"AutoCaption Web — {url}", flush=True)
    if not os.environ.get("AUTOCAPTION_NO_AUTOSTART"):
        ok, message = start_transcriber()
        print("  " + message, flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if args.open:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
