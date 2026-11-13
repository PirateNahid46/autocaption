#!/usr/bin/env python3
"""AutoCaption Transcriber — a local service for the EffectCraft panel.

The AutoCaption panel is a ScriptUI panel: a script may not run programs
(`system.callSystem` is a stub) and it cannot transcribe by itself. But a
script *can* open a TCP socket, so the panel talks to this service instead.

The panel sends the path of a media file; this service transcribes it — with
faster-whisper on your own CPU or through an online provider (see providers.py)
— and writes the word-timing JSON next to the media; the panel then reads that
file and builds the captions.

    transcriber.py [--port 8787] [--host 127.0.0.1]
    transcriber.py --set-key deepgram <key>    # store an API key
    transcriber.py --keys                     # show the providers and their keys

Protocol — one line per message, UTF-8:

    PING                        -> OK autocaption <version>
    PROVIDERS                   -> PROVIDERS <json>
    TRANSCRIBE\\t<request json> -> QUEUED <job id>
    STATUS <job id>             -> RUNNING <percent> <message>
                                   DONE <summary json>
                                   ERR <message>

The request json:

    {"media": "/path/clip.mp4", "out": "/path/clip - word timings.json",
     "provider": "local", "model": "small.en", "language": "",
     "max_words": 7, "max_chars": 38, "pause": 1.0, "lead": 0.05, "hold": 0.7}
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(SKILL / "scripts"))
sys.path.insert(0, str(HERE))

import providers as P  # noqa: E402
import word_timing as wt  # noqa: E402

VERSION = "1.2"
DEFAULT_PORT = 8787
DEFAULT_HOST = "127.0.0.1"

JOBS: dict[str, dict] = {}
JOB_LOCK = threading.Lock()
QUEUE: "queue.Queue[str]" = queue.Queue()


# ----------------------------------------------------------------------- jobs

def set_job(job_id: str, **kw) -> None:
    with JOB_LOCK:
        job = JOBS.setdefault(job_id, {"id": job_id, "state": "queued", "progress": 0,
                                       "message": "", "summary": None})
        job.update(kw)


def get_job(job_id: str):
    with JOB_LOCK:
        return JOBS.get(job_id)


def run_job(job_id: str, req: dict) -> None:
    media = Path(req["media"]).expanduser()
    out = Path(req["out"]).expanduser()
    provider = (req.get("provider") or "local").lower()
    try:
        set_job(job_id, state="running", progress=1, message="Transcribing…")
        duration = 0.0
        try:
            duration = wt.probe(media)["duration"] or 0.0
        except Exception:
            pass
        req["_duration"] = duration

        def report(percent: float, message: str = "") -> None:
            set_job(job_id, progress=int(max(0, min(99, percent))), message=message)

        words, used = P.transcribe_with_provider(media, req, report)
        if not words:
            raise RuntimeError("no speech was found in the audio")
        set_job(job_id, progress=98, message="Grouping the words into caption lines…")

        groups = wt.group_lines(words, int(req.get("max_words") or 7),
                                int(req.get("max_chars") or 38), float(req.get("pause") or 1.0))
        lines = wt.time_lines(groups, float(req.get("lead", 0.05)), float(req.get("hold", 0.7)))
        data = wt.to_panel_json(lines, req.get("fps") or None)

        out.parent.mkdir(parents=True, exist_ok=True)
        wt.write_atomic(out, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        try:
            wt.write_atomic(out.with_suffix(".srt"), wt.srt_string(lines))
        except Exception:
            pass
        summary = {"out": str(out), "lines": len(data),
                   "words": sum(len(l["words"]) for l in data),
                   "duration": round(duration, 2), "provider": provider, "model": used}
        print(f"job {job_id[:8]} done: {summary['lines']} lines, {summary['words']} words "
              f"via {used}", flush=True)
        set_job(job_id, state="done", progress=100, message="Done", summary=summary)
    except Exception as e:
        print(f"job {job_id[:8]} failed: {e}", flush=True)
        set_job(job_id, state="error", message=str(e))


def worker() -> None:
    while True:
        job_id = QUEUE.get()
        req = (get_job(job_id) or {}).get("request") or {}
        run_job(job_id, req)
        QUEUE.task_done()


# --------------------------------------------------------------------- server

def handle(line: str) -> str:
    line = line.strip("\r\n")
    if not line:
        return "ERR empty request"
    if line == "PING":
        return f"OK autocaption {VERSION}"
    if line == "PROVIDERS":
        return "PROVIDERS " + json.dumps(P.provider_info(), ensure_ascii=False)
    if line.startswith("STATUS "):
        job = get_job(line[7:].strip())
        if not job:
            return "ERR unknown job"
        if job["state"] == "done":
            return "DONE " + json.dumps(job.get("summary") or {}, ensure_ascii=False)
        if job["state"] == "error":
            return "ERR " + str(job.get("message", ""))
        return f"RUNNING {job.get('progress', 0)} {job.get('message', '')}"
    if line.startswith("SETKEY "):
        rest = line[7:].strip()
        provider, _, key = rest.partition(" ")
        provider = provider.strip()
        if provider not in P.PROVIDERS:
            return "ERR unknown provider: " + provider
        if provider == "local":
            return "ERR 'local' needs no key"
        try:
            P.set_key(provider, key.strip())
        except Exception as e:
            return "ERR could not save the key: " + str(e)
        print(f"stored the {provider} key", flush=True)
        return "OK"
    if line.startswith("DELKEY "):
        provider = line[7:].strip()
        if provider not in P.PROVIDERS:
            return "ERR unknown provider: " + provider
        try:
            P.set_key(provider, "")
        except Exception as e:
            return "ERR could not clear the key: " + str(e)
        print(f"cleared the {provider} key", flush=True)
        return "OK"
    if line.startswith("TRANSCRIBE\t"):
        try:
            req = json.loads(line.split("\t", 1)[1])
        except Exception as e:
            return "ERR bad request: " + str(e)
        for key in ("media", "out"):
            if not req.get(key):
                return f"ERR missing '{key}'"
        job_id = uuid.uuid4().hex[:12]
        print(f"job {job_id[:8]} queued: {req.get('provider', 'local')} "
              f"{req.get('model', '')} — {req.get('media')}", flush=True)
        set_job(job_id, state="queued", progress=0, message="Queued", request=req)
        QUEUE.put(job_id)
        return "QUEUED " + job_id
    return "ERR unknown command"


def serve_client(conn) -> None:
    try:
        conn.settimeout(60)
        data = b""
        while b"\n" not in data:
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
        line = data.split(b"\n", 1)[0].decode("utf-8", "replace")
        reply = handle(line)
        conn.sendall((reply + "\n").encode("utf-8"))
    except Exception:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main() -> None:
    ap = argparse.ArgumentParser(description="AutoCaption Transcriber — local service for the panel.")
    ap.add_argument("--port", type=int, default=int(os.environ.get("AUTOCAPTION_PORT", DEFAULT_PORT)))
    ap.add_argument("--host", default=os.environ.get("AUTOCAPTION_HOST", DEFAULT_HOST))
    ap.add_argument("--set-key", nargs=2, metavar=("PROVIDER", "KEY"),
                    help="store an API key for a provider (groq, deepgram, assemblyai, openai)")
    ap.add_argument("--keys", action="store_true", help="show the providers and which keys are set")
    args = ap.parse_args()

    if args.set_key:
        provider, key = args.set_key
        if provider not in P.PROVIDERS or provider == "local":
            print("providers: " + ", ".join(p for p in P.PROVIDERS if p != "local"))
            return
        P.set_key(provider, key)
        print(f"stored the {provider} key in {P.KEYS_FILE}")
        return

    if args.keys:
        for name, (env, model, note, _models) in P.PROVIDERS.items():
            state = "no key" if (env and not P.api_key(name)) else ("ready" if env else "built in")
            print(f"  {name:11} {state:8} {model:24} {note}")
        return

    for _ in range(2):
        threading.Thread(target=worker, daemon=True).start()

    import socket
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((args.host, args.port))
    srv.listen(16)
    print(f"AutoCaption Transcriber — {args.host}:{args.port}", flush=True)
    print("The EffectCraft panel can now transcribe. Press Ctrl+C to stop.", flush=True)
    try:
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=serve_client, args=(conn,), daemon=True).start()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)
    finally:
        srv.close()


if __name__ == "__main__":
    main()
