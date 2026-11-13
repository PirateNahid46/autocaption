#!/usr/bin/env python3
"""Word-timing JSON for the EffectCraft word-highlight caption panel.

    word_timing.py MEDIA [options]

Turns any audio or video file into the JSON the "AutoCaption"
ScriptUI panel reads:

    [
      {
        "start": 0.067,
        "end": 2.5,
        "text": "Your time machine broke, and now",
        "words": [
          {"i": 0, "text": "Your",   "t0": 0.1,   "t1": 0.333},
          {"i": 1, "text": "time",   "t0": 0.333, "t1": 0.567},
          ...
        ]
      }
    ]

Every word keeps its real speech time, so the panel can hold the orange
highlight on one word at a time and clear it during the pauses.

Pipeline:
    1. ffmpeg decodes 16 kHz mono
    2. faster-whisper returns word timestamps (local, no network)
    3. words are grouped into short caption lines (max words / chars / pause)
    4. lines are timed, and written as JSON (+ an SRT)

Everything is local; only the first run downloads the Whisper model.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# The caption look of the sibling skill (grouping + timing), kept identical so
# the JSON and the FilmCraft captions describe the same lines.
SENT_END = re.compile(r"[.!?…][\"'”’)]?$")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


# --------------------------------------------------------------------------- media

def probe(path: Path) -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True)
    if r.returncode != 0:
        die(f"ffprobe cannot read {path}:\n{r.stderr.strip()}")
    d = json.loads(r.stdout)
    video = next((s for s in d["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    if not audio and not video:
        die(f"{path} has no audio and no video")

    def rate(s):
        if not s:
            return None
        for key in ("avg_frame_rate", "r_frame_rate"):
            v = s.get(key, "0/0")
            try:
                n, den = v.split("/")
                if float(den) and float(n):
                    return float(n) / float(den)
            except Exception:
                pass
        return None

    return {
        "path": path,
        "width": int(video["width"]) if video else 0,
        "height": int(video["height"]) if video else 0,
        "fps": rate(video) or 30.0,
        "has_video": video is not None,
        "has_audio": audio is not None,
        "duration": float(d["format"].get("duration") or 0.0),
    }


def decode_audio(path: Path):
    import numpy as np
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000",
         "-f", "f32le", "-"], capture_output=True)
    if r.returncode != 0:
        die(f"ffmpeg could not decode audio from {path}:\n{r.stderr.decode(errors='replace')}")
    return np.frombuffer(r.stdout, dtype=np.float32)


# --------------------------------------------------------------------------- transcript

def transcribe(path: Path, model_name: str, language: str | None,
               beam_size: int = 5, progress=None) -> list[dict]:
    """Word timestamps for a media file. `progress(seconds)` is called per segment."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("faster-whisper is not installed. Run scripts/setup.sh first "
            "(or pass --srt to build the JSON from existing subtitles).")
    log(f"transcribing with {model_name} (the first run downloads the model)…")
    audio = decode_audio(path)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segs, info = model.transcribe(audio, language=language, word_timestamps=True,
                                  vad_filter=True, beam_size=beam_size)
    words = []
    for seg in segs:
        for w in getattr(seg, "words", None) or []:
            txt = (w.word or "").strip()
            if not txt:
                continue
            s = float(w.start)
            e = float(w.end)
            if e <= s:
                e = s + 0.08
            if words and s < words[-1]["s"]:
                s = words[-1]["s"]
            words.append({"w": txt, "s": s, "e": e})
        if progress:
            try:
                progress(float(getattr(seg, "end", 0)))
            except Exception:
                pass
    if not words:
        die("no speech was found in the audio")
    lang = getattr(info, "language", None) or language or "?"
    log(f"  {len(words)} words · language {lang}")
    return words


SRT_TIME = re.compile(
    r"(\d+):(\d+):(\d+)(?:[,.](\d+))?\s*-->\s*(\d+):(\d+):(\d+)(?:[,.](\d+))?")


def _secs(h, m, s, ms) -> float:
    ms = (ms or "0").ljust(3, "0")[:3]
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_srt_text(raw: str) -> list[dict]:
    """SRT text → caption lines with estimated word times."""
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        rows = [r for r in block.split("\n") if r.strip()]
        ti = next((i for i, r in enumerate(rows) if "-->" in r), None)
        if ti is None:
            continue
        m = SRT_TIME.search(rows[ti])
        if not m:
            continue
        g = m.groups()
        start = _secs(g[0], g[1], g[2], g[3])
        end = _secs(g[4], g[5], g[6], g[7])
        text = " ".join(rows[ti + 1:]).strip()
        if not text or end <= start:
            continue
        toks = text.split()
        # weigh the words so a long word gets more of the cue
        weights = [max(1, len(re.sub(r"\W", "", t))) +
                   (2 if re.search(r"[,;:]$", t) else 4 if re.search(r"[.!?]$", t) else 0)
                   for t in toks]
        total = sum(weights) or len(toks)
        c = start
        ws = []
        for tok, wgt in zip(toks, weights):
            d = (end - start) * wgt / total
            ws.append({"w": tok, "s": c, "e": c + d * 0.9})
            c += d
        lines.append({"text": text, "start": start, "end": end, "words": ws})
    if not lines:
        raise ValueError("no subtitle cues with timings were found")
    return lines


def parse_srt(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    try:
        return parse_srt_text(raw)
    except ValueError:
        die(f"no cues found in {path}")


def approximate_words(line: dict) -> list[dict]:
    """Spread a line's time over its words by length — the panel's estimate."""
    parts = str(line["text"]).split()
    weights = [max(1, len(p)) for p in parts]
    total = sum(weights) or len(parts)
    span = line["end"] - line["start"]
    out = []
    t = line["start"]
    cum = 0
    for i, p in enumerate(parts):
        cum += weights[i]
        t1 = line["end"] if i == len(parts) - 1 else line["start"] + span * (cum / total)
        out.append({"w": p, "s": t, "e": t1})
        t = t1
    return out


def _to_float(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def normalize_lines(data) -> list[dict]:
    """Word-timing JSON (the panel's format) → caption lines."""
    arr = data
    if isinstance(data, dict):
        arr = data.get("lines") or data.get("captions")
    if not isinstance(arr, list):
        raise ValueError("The JSON must be an array of caption lines (or {lines:[...]}).")

    out = []
    for raw in arr:
        if not isinstance(raw, dict):
            continue
        words = []
        for w in raw.get("words") or []:
            if isinstance(w, (list, tuple)) and len(w) >= 3:
                wt, t0, t1 = str(w[0]), _to_float(w[1]), _to_float(w[2])
            elif isinstance(w, dict):
                wt = str(w.get("text") or w.get("word") or "")
                t0 = _to_float(w.get("t0", w.get("start")))
                t1 = _to_float(w.get("t1", w.get("end")))
            else:
                continue
            if not wt:
                continue
            words.append({"w": wt, "s": t0, "e": t1})

        text = raw.get("text")
        text = str(text) if text is not None else " ".join(w["w"] for w in words)
        start = _to_float(raw.get("start"))
        end = _to_float(raw.get("end"))
        if start is None:
            start = words[0]["s"] if words else None
        if end is None:
            end = words[-1]["e"] if words else None
        if start is None or end is None or end <= start:
            continue

        valid = bool(words) and all(
            w["s"] is not None and w["e"] is not None and w["e"] >= w["s"] for w in words)
        if not valid:
            words = approximate_words({"start": start, "end": end, "text": text})
        for w in words:
            w["s"] = max(start, min(w["s"], end))
            w["e"] = max(w["s"], min(w["e"], end))

        out.append({"text": text, "start": start, "end": end, "words": words})

    if not out:
        raise ValueError("no caption lines with valid timings were found")
    return out


# --------------------------------------------------------------------------- lines

def group_lines(words: list[dict], max_words: int, max_chars: int, pause: float) -> list[list[dict]]:
    lines, cur = [], []

    def flush():
        nonlocal cur
        if cur:
            lines.append(cur)
            cur = []

    for w in words:
        if cur:
            prev = cur[-1]
            gap = w["s"] - prev["e"]
            text = " ".join(x["w"] for x in cur)
            too_long = len(cur) >= max_words or (len(text) + 1 + len(w["w"])) > max_chars
            if gap > pause or too_long or (SENT_END.search(prev["w"]) and len(cur) >= 3):
                flush()
        cur.append(w)
    flush()
    if len(lines) >= 2 and len(lines[-1]) == 1 and len(lines[-2]) <= max_words + 1:
        lines[-2].extend(lines[-1])
        lines.pop()
    return rebalance(lines, max_words, max_chars)


def rebalance(groups: list[list[dict]], max_words: int, max_chars: int) -> list[list[dict]]:
    """No 1-2 word stragglers: merge a short page with the one above, or borrow words from it."""
    out = [list(g) for g in groups]
    for i in range(len(out) - 1):
        cur, nxt = out[i], out[i + 1]
        if len(nxt) > 2 or len(cur) < 4 or SENT_END.search(cur[-1]["w"]):
            continue
        merged = " ".join(w["w"] for w in cur + nxt)
        if len(cur) + len(nxt) <= max_words + 1 and len(merged) <= max_chars + 6:
            out[i] = cur + nxt
            out[i + 1] = []
            continue
        while len(nxt) < 3 and len(cur) > 3:
            nxt.insert(0, cur.pop())
    return [g for g in out if g]


def time_lines(groups: list[list[dict]], lead: float = 0.05, hold: float = 0.7) -> list[dict]:
    starts = [max(0.0, g[0]["s"] - lead) for g in groups]
    out = []
    for i, ws in enumerate(groups):
        start = starts[i]
        if out:
            start = max(start, out[-1]["end"])
        end = max(ws[-1]["e"] + hold, ws[-1]["e"] + 0.15, start + 0.2)
        if i + 1 < len(groups):
            # never run into the next line: the next line is already being spoken
            end = min(end, max(starts[i + 1], start + 0.1))
        out.append({"text": " ".join(w["w"] for w in ws),
                    "start": start, "end": end, "words": ws})
    return out


def regroup_cues(cues: list[dict], max_words: int, max_chars: int, pause: float) -> list[dict]:
    """Keep deliberate SRT cue breaks; only split cues that are too long for one line."""
    out = []
    for cue in cues:
        if len(cue["words"]) <= max_words and len(cue["text"]) <= max_chars:
            out.append(cue)
            continue
        out.extend(time_lines(group_lines(cue["words"], max_words, max_chars, pause)))
    return out


# --------------------------------------------------------------------------- output

def to_panel_json(lines: list[dict], fps: float | None = None) -> list[dict]:
    """The JSON shape the EffectCraft panel reads."""
    out = []
    for line in lines:
        start, end = line["start"], line["end"]
        if fps:
            start = round(start * fps) / fps
            end = round(end * fps) / fps
        words = []
        for i, w in enumerate(line["words"]):
            t0, t1 = w["s"], w["e"]
            if fps:
                t0 = round(t0 * fps) / fps
                t1 = round(t1 * fps) / fps
            words.append({"i": i, "text": w["w"], "t0": round(t0, 4), "t1": round(t1, 4)})
        out.append({"start": round(start, 4), "end": round(end, 4),
                    "text": line["text"], "words": words})
    return out


def srt_string(lines: list[dict]) -> str:
    def ts(t):
        ms = round(t * 1000)
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    return "\n".join(f"{i}\n{ts(l['start'])} --> {ts(l['end'])}\n{l['text']}\n"
                     for i, l in enumerate(lines, 1))


def write_atomic(path: Path, text: str) -> None:
    """Write a file in one step — a reader never sees half a file."""
    path = Path(path)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def write_srt(lines: list[dict], out: Path) -> None:
    out.write_text(srt_string(lines), encoding="utf-8")


def transcribe_file(path: Path, model: str = "small.en", language: str | None = None,
                    max_words: int = 7, max_chars: int = 38, pause: float = 1.0,
                    lead: float = 0.05, hold: float = 0.7, fps: float | None = None,
                    beam_size: int = 5, progress=None) -> dict:
    """Media file → the panel's JSON, an SRT and the counts (the whole pipeline)."""
    words = transcribe(path, model, language, beam_size, progress)
    groups = group_lines(words, max_words, max_chars, pause)
    lines = time_lines(groups, lead, hold)
    data = to_panel_json(lines, fps)
    duration = 0.0
    try:
        duration = round(probe(path)["duration"] or 0.0, 2)
    except Exception:
        pass
    return {"json": data, "srt": srt_string(lines), "lines": len(data),
            "words": sum(len(l["words"]) for l in data), "duration": duration,
            "model": model}


def write_json(data: list[dict], out: Path, indent: int | None) -> None:
    out.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- validate

def validate(path: Path) -> int:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as e:
        die(f"{path} is not valid JSON: {e}")
    if isinstance(data, dict):
        data = data.get("lines") or data.get("captions")
    if not isinstance(data, list) or not data:
        die("the JSON must be a non-empty array of caption lines "
            "(or {\"lines\": [...]})")

    problems = []
    total_words = 0
    longest_pause = 0.0
    pauses = 0
    for i, line in enumerate(data, 1):
        if not isinstance(line, dict):
            problems.append(f"line {i}: not an object")
            continue
        text = line.get("text")
        start, end = line.get("start"), line.get("end")
        if not isinstance(text, str) or not text.strip():
            problems.append(f"line {i}: missing text")
        for key, val in (("start", start), ("end", end)):
            if not isinstance(val, (int, float)):
                problems.append(f"line {i}: {key} is not a number")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end <= start:
            problems.append(f"line {i}: end {end} is not after start {start}")
        words = line.get("words")
        if not isinstance(words, list) or not words:
            problems.append(f"line {i}: no words")
            continue
        total_words += len(words)
        prev_end = None
        for j, w in enumerate(words):
            if not isinstance(w, dict):
                problems.append(f"line {i} word {j}: not an object")
                continue
            if not isinstance(w.get("text"), str) or not w.get("text", "").strip():
                problems.append(f"line {i} word {j}: missing text")
            t0, t1 = w.get("t0"), w.get("t1")
            if not isinstance(t0, (int, float)) or not isinstance(t1, (int, float)):
                problems.append(f"line {i} word {j}: t0/t1 must be numbers")
                continue
            if t1 < t0:
                problems.append(f"line {i} word {j}: t1 {t1} is before t0 {t0}")
            if prev_end is not None and t0 > prev_end + 0.001:
                gap = t0 - prev_end
                pauses += 1
                longest_pause = max(longest_pause, gap)
            prev_end = max(prev_end or 0, t1)

    span = 0.0
    if data and isinstance(data[0], dict) and isinstance(data[-1], dict):
        first = data[0].get("start")
        last = data[-1].get("end")
        if isinstance(first, (int, float)) and isinstance(last, (int, float)):
            span = float(last) - float(first)
    print(f"{path}")
    print(f"  lines        {len(data)}")
    print(f"  words        {total_words}")
    print(f"  span         {span:.2f} s")
    if data:
        wc = [len(l["words"]) for l in data
              if isinstance(l, dict) and isinstance(l.get("words"), list)]
        if wc:
            print(f"  words/line   {min(wc)}–{max(wc)} (avg {sum(wc)/len(wc):.1f})")
    print(f"  pauses       {pauses} (longest {longest_pause:.2f} s)")
    if problems:
        print(f"  problems     {len(problems)}")
        for p in problems[:20]:
            print(f"    - {p}")
        return 1
    print("  problems     none — the panel can read this file")
    return 0


# --------------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Create the word-timing JSON for the EffectCraft caption panel.")
    ap.add_argument("media", nargs="?", help="audio or video file")
    ap.add_argument("--out", help="the JSON file (default: '<media> - word timings.json' next to it)")
    ap.add_argument("--srt", help="build the JSON from these subtitles instead of transcribing")
    ap.add_argument("--model", default=os.environ.get("WORD_TIMING_WHISPER_MODEL", "small.en"),
                    help="faster-whisper model (default small.en)")
    ap.add_argument("--language", help="spoken language (default: auto-detect)")
    ap.add_argument("--beam-size", type=int, default=5, help="whisper beam size (default 5)")
    ap.add_argument("--max-words", type=int, default=7, help="words per caption line")
    ap.add_argument("--max-chars", type=int, default=38, help="characters per caption line")
    ap.add_argument("--pause", type=float, default=1.0, help="a silence this long ends a line")
    ap.add_argument("--lead", type=float, default=0.05, help="seconds a line starts before its first word")
    ap.add_argument("--hold", type=float, default=0.7, help="seconds a line stays after its last word")
    ap.add_argument("--fps", type=float, help="quantise the times to this frame rate")
    ap.add_argument("--no-srt", action="store_true", help="do not write the SRT next to the JSON")
    ap.add_argument("--compact", action="store_true", help="write the JSON on one line")
    ap.add_argument("--stdout", action="store_true", help="print the JSON to stdout as well")
    ap.add_argument("--validate", metavar="JSON", help="check a JSON file and print a summary")
    args = ap.parse_args()

    if args.validate:
        sys.exit(validate(Path(args.validate).expanduser().resolve()))

    if not args.media:
        ap.error("a media file is required (or use --validate FILE)")
    media_path = Path(args.media).expanduser().resolve()
    if not media_path.exists():
        die(f"{media_path} does not exist")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        die("ffmpeg/ffprobe were not found (apt install ffmpeg · brew install ffmpeg)")

    media = probe(media_path)

    if args.srt:
        cues = parse_srt(Path(args.srt).expanduser().resolve())
        lines = regroup_cues(cues, args.max_words, args.max_chars, args.pause)
        log(f"{len(cues)} subtitle cues from {args.srt} → {len(lines)} caption lines "
            "(word times estimated from the text)")
    else:
        words = transcribe(media_path, args.model, args.language, args.beam_size)
        groups = group_lines(words, args.max_words, args.max_chars, args.pause)
        lines = time_lines(groups, args.lead, args.hold)
        log(f"{len(lines)} caption lines")

    data = to_panel_json(lines, args.fps)
    if not data:
        die("no caption lines came out of the transcript")

    out = Path(args.out).expanduser().resolve() if args.out else \
        media_path.parent / f"{media_path.stem} - word timings.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_json(data, out, None if args.compact else 2)

    srt_out = None
    if not args.no_srt:
        srt_out = out.with_suffix(".srt")
        write_srt(lines, srt_out)

    if args.stdout:
        print(json.dumps(data, ensure_ascii=False, indent=None if args.compact else 2))

    nwords = sum(len(l["words"]) for l in data)
    log("")
    log(f"done. {len(data)} lines, {nwords} words, "
        f"{media['duration']:.1f} s of media.")
    log(f"  timings {out}")
    if srt_out:
        log(f"  srt     {srt_out}")
    log("")
    log("Paste the JSON into the EffectCraft panel (Window ▸ AutoCaption.jsx) "
        "with 'Use Pasted Text', or keep it next to the project and use 'Load JSON…'.")


if __name__ == "__main__":
    main()
