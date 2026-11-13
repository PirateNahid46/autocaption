#!/usr/bin/env python3
"""Transcription providers shared by the AutoCaption web app and the panel's service.

Every provider returns the same thing: a list of words with their times

    [{"w": "Your", "s": 0.1, "e": 0.33}, ...]

so the rest of the pipeline (grouping → line times → the panel's JSON) is identical
whichever engine produced them.

    local        faster-whisper on this machine — no key, nothing is uploaded
    groq         https://api.groq.com        whisper-large-v3-turbo   free tier
    deepgram     https://api.deepgram.com    whisper-large            $200 free credit
    assemblyai   https://api.assemblyai.com  best                     free tier
    openai       https://api.openai.com      whisper-1                paid

API keys live in ~/.config/autocaption/keys.json (mode 600) or in the environment
(GROQ_API_KEY, DEEPGRAM_API_KEY, ASSEMBLYAI_API_KEY, OPENAI_API_KEY).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(SKILL / "scripts"))

import word_timing as wt  # noqa: E402

KEYS_FILE = Path.home() / ".config" / "autocaption" / "keys.json"

# provider → (environment variable, default model, note, available models)
PROVIDERS = {
    "local": (None, "small.en", "faster-whisper on this machine — no key, nothing is uploaded",
              ["small.en", "small", "medium", "large-v3"]),
    "groq": ("GROQ_API_KEY", "whisper-large-v3-turbo", "Groq — free tier, very fast",
             ["whisper-large-v3-turbo"]),
    "deepgram": ("DEEPGRAM_API_KEY", "whisper-large", "Deepgram — $200 free credit, word times",
                 ["whisper-large", "nova-3"]),
    "assemblyai": ("ASSEMBLYAI_API_KEY", "best", "AssemblyAI — free tier, word times",
                   ["best", "nano"]),
    "openai": ("OPENAI_API_KEY", "whisper-1", "OpenAI — paid", ["whisper-1"]),
}

TITLES = {
    "local": "This machine",
    "groq": "Groq",
    "deepgram": "Deepgram",
    "assemblyai": "AssemblyAI",
    "openai": "OpenAI",
}


# ------------------------------------------------------------------- api keys

def load_keys() -> dict:
    try:
        return json.loads(KEYS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def api_key(provider: str) -> str:
    entry = PROVIDERS.get(provider)
    env = entry[0] if entry else None
    if env:
        value = os.environ.get(env)
        if value:
            return value.strip()
    return str(load_keys().get(provider, "")).strip()


def set_key(provider: str, key: str) -> None:
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    keys = load_keys()
    keys[provider] = key
    tmp = KEYS_FILE.with_name(KEYS_FILE.name + ".part")
    tmp.write_text(json.dumps(keys, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, KEYS_FILE)
    try:
        KEYS_FILE.chmod(0o600)
    except OSError:
        pass


def provider_info() -> dict:
    """What the page shows: the providers, their models and whether a key is set."""
    out = {}
    for name, (env, model, note, models) in PROVIDERS.items():
        out[name] = {"title": TITLES.get(name, name), "env": env, "model": model,
                     "note": note, "models": list(models),
                     "ready": (not env) or bool(api_key(name))}
    return out


# ---------------------------------------------------------------------- http

USER_AGENT = "AutoCaption/1.0 (word-timing JSON tool)"


def http(url: str, data: bytes | None = None, headers: dict | None = None,
         method: str = "POST", timeout: int = 45) -> dict:
    h = dict(headers or {})
    # some providers sit behind a bot filter that blocks the default urllib agent
    h.setdefault("User-Agent", USER_AGENT)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {e.code} from the provider: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"cannot reach the provider: {e.reason}") from e
    except (TimeoutError, OSError) as e:
        raise RuntimeError("the provider timed out") from e
    print(f"    provider {url.split('?')[0]} answered in {time.time() - started:.1f} s", flush=True)
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception as e:
        raise RuntimeError("the provider sent an answer we could not read") from e


def request_with_retry(url: str, data: bytes | None = None, headers: dict | None = None,
                       method: str = "POST", attempts: int = 3, timeout: int = 45) -> dict:
    """Some providers stall on the first call; a timeout is worth another try."""
    last = None
    for attempt in range(attempts):
        try:
            return http(url, data, headers, method, timeout)
        except RuntimeError as e:
            last = e
            message = str(e)
            if "timed out" not in message and "cannot reach" not in message:
                raise                       # a real API error — do not retry
            print(f"    retrying ({attempt + 1}/{attempts}): {message}", flush=True)
            time.sleep(1 + attempt)
    raise last


def multipart(fields: dict, files: dict, boundary: str | None = None) -> tuple[bytes, str]:
    boundary = boundary or ("----AutoCaption" + uuid.uuid4().hex)
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n"
                     f"{value}\r\n".encode("utf-8"))
    for key, (name, blob, ctype) in files.items():
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"; "
                f"filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n").encode("utf-8")
        parts.append(head + blob + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# ------------------------------------------------------------------ providers

def need_key(provider: str) -> str:
    env, _model, note, _models = PROVIDERS[provider]
    key = api_key(provider)
    if not key:
        raise RuntimeError(
            f"No API key for {provider}. Set {env} in the environment or run: "
            f"run-transcriber.sh --set-key {provider} <key>   ({note})")
    return key


def words_from_openai_style(data: dict) -> list[dict]:
    words = []
    for w in data.get("words") or []:
        text = str(w.get("word") or "").strip()
        if not text:
            continue
        s = float(w.get("start", 0) or 0)
        e = float(w.get("end", s) or s)
        words.append({"w": text, "s": s, "e": max(s, e)})
    if not words and data.get("text"):
        # no word timings: spread the text over the clip
        words = wt.approximate_words({"start": 0.0, "end": float(data.get("duration") or 1.0),
                                      "text": data["text"]})
    return words


def provider_local(path: Path, opts: dict, report) -> list[dict]:
    duration = float(opts.get("_duration") or 0)

    def on_segment(sec: float) -> None:
        pct = int(min(97, (sec / duration) * 100)) if duration else 50
        report(pct, f"Transcribing… {pct}%")

    return wt.transcribe(path, opts.get("model") or "small.en",
                         opts.get("language") or None, progress=on_segment)


def provider_groq(path: Path, opts: dict, report) -> list[dict]:
    key = need_key("groq")
    fields = {
        "model": opts.get("model") or "whisper-large-v3-turbo",
        "response_format": "verbose_json",
        "timestamp_granularities[]": "word",
        "temperature": "0",
    }
    if opts.get("language"):
        fields["language"] = opts["language"]
    body, ctype = multipart(fields, {"file": (path.name, path.read_bytes(), "audio/mpeg")})
    data = request_with_retry("https://api.groq.com/openai/v1/audio/transcriptions", body,
                              {"Authorization": "Bearer " + key, "Content-Type": ctype})
    return words_from_openai_style(data)


def provider_openai(path: Path, opts: dict, report) -> list[dict]:
    key = need_key("openai")
    fields = {
        "model": opts.get("model") or "whisper-1",
        "response_format": "verbose_json",
        "timestamp_granularities[]": "word",
    }
    if opts.get("language"):
        fields["language"] = opts["language"]
    body, ctype = multipart(fields, {"file": (path.name, path.read_bytes(), "audio/mpeg")})
    data = request_with_retry("https://api.openai.com/v1/audio/transcriptions", body,
                              {"Authorization": "Bearer " + key, "Content-Type": ctype})
    return words_from_openai_style(data)


def provider_deepgram(path: Path, opts: dict, report) -> list[dict]:
    key = need_key("deepgram")
    url = ("https://api.deepgram.com/v1/listen?model=" +
           (opts.get("model") or "whisper-large") +
           "&smart_format=true&punctuate=true&words=true&detect_language=false")
    if opts.get("language"):
        url += "&language=" + opts["language"]
    data = request_with_retry(url, path.read_bytes(),
                              {"Authorization": "Token " + key, "Content-Type": "audio/*"})
    try:
        alt = data["results"]["channels"][0]["alternatives"][0]
    except Exception:
        return []
    words = []
    for w in alt.get("words") or []:
        text = str(w.get("punctuated_word") or w.get("word") or "").strip()
        if not text:
            continue
        s = float(w.get("start", 0) or 0)
        e = float(w.get("end", s) or s)
        words.append({"w": text, "s": s, "e": max(s, e)})
    return words


def provider_assemblyai(path: Path, opts: dict, report) -> list[dict]:
    key = need_key("assemblyai")
    headers = {"Authorization": key, "Content-Type": "application/octet-stream"}
    upload = request_with_retry("https://api.assemblyai.com/v2/upload", path.read_bytes(), headers)
    body = json.dumps({"audio_url": upload["upload_url"], "punctuate": True,
                       "format_text": True, "speech_model": opts.get("model") or "best"}).encode()
    res = request_with_retry("https://api.assemblyai.com/v2/transcript", body,
                             {"Authorization": key, "Content-Type": "application/json"})
    tries = 0
    while res.get("status") in ("queued", "processing") and tries < 120:
        tries += 1
        report(0, "waiting for AssemblyAI…")
        time.sleep(3)
        res = http("https://api.assemblyai.com/v2/transcript/" + res["id"], None,
                   {"Authorization": key}, method="GET")
    if res.get("status") != "completed":
        raise RuntimeError("AssemblyAI returned: " + str(res.get("status")) + " " + str(res.get("error")))
    words = []
    for w in res.get("words") or []:
        text = str(w.get("text") or "").strip()
        if not text:
            continue
        s = float(w.get("start", 0) or 0) / 1000.0
        e = float(w.get("end", 0) or 0) / 1000.0
        words.append({"w": text, "s": s, "e": max(s, e)})
    return words


# ------------------------------------------------------------------- chunking

def extract_audio(media: Path, out: Path) -> Path:
    """16 kHz mono mp3 — small enough for the online providers."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is needed to prepare the audio for the provider")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(media), "-vn", "-ac", "1",
                        "-ar", "16000", "-b:a", "32k", str(out)], capture_output=True)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError("ffmpeg could not read the media: " + r.stderr.decode("utf-8", "replace")[:300])
    return out


def split_audio(audio: Path, max_bytes: int) -> list[tuple[Path, float]]:
    """Split into pieces of at most max_bytes; returns (file, start seconds)."""
    size = audio.stat().st_size
    if size <= max_bytes:
        return [(audio, 0.0)]
    # ~32 kbit/s mp3 → about 4000 bytes per second
    seconds = max(30, int((max_bytes - 64 * 1024) / 4000))
    outdir = audio.parent / (audio.stem + "_chunks")
    outdir.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(audio), "-f", "segment",
                        "-segment_time", str(seconds), "-c", "copy", str(outdir / "part%03d.mp3")],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg could not split the audio: " + r.stderr.decode("utf-8", "replace")[:300])
    parts = sorted(outdir.glob("part*.mp3"))
    return [(p, i * seconds) for i, p in enumerate(parts)]


# ----------------------------------------------------------------- the engine

def transcribe_with_provider(media: Path, opts: dict, report) -> tuple[list[dict], str]:
    """media → (words, "what was used"). `report(percent, message)` shows the progress."""
    provider = (opts.get("provider") or "local").lower()
    if provider not in PROVIDERS:
        raise RuntimeError("unknown provider: " + provider)
    if provider == "local":
        words = provider_local(media, opts, report)
        return words, "faster-whisper " + (opts.get("model") or "small.en")

    report(0, "preparing the audio…")
    tmp = Path(tempfile.mkdtemp(prefix="autocaption-"))
    try:
        audio = extract_audio(media, tmp / "audio.mp3")
        pieces = split_audio(audio, 18 * 1024 * 1024)
        words = []
        for i, (piece, offset) in enumerate(pieces):
            report(int(i * 90 / max(1, len(pieces))), f"uploading part {i + 1}/{len(pieces)}…")
            got = {
                "groq": provider_groq,
                "openai": provider_openai,
                "deepgram": provider_deepgram,
                "assemblyai": provider_assemblyai,
            }[provider](piece, opts, report)
            for w in got:
                words.append({"w": w["w"], "s": w["s"] + offset, "e": w["e"] + offset})
        return words, f"{provider} " + (opts.get("model") or PROVIDERS[provider][1])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
