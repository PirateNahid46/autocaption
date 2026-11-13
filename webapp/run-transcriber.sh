#!/bin/bash
# Start the AutoCaption Transcriber — the local service the EffectCraft panel
# talks to. It transcribes on your own CPU with faster-whisper, or through an
# online provider (Groq, Deepgram, AssemblyAI, OpenAI) when you pick one.
#
#   run-transcriber.sh [--port 8787]
#   run-transcriber.sh --keys                 # show the providers and their keys
#   run-transcriber.sh --set-key groq gsk_…   # store an API key
#
# Leave it running while you caption. Press Ctrl+C to stop.
set -u
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
for p in "$HOME/.filmcraft-captions/venv/bin/python" \
         "$HOME/.faceless-shorts/venv/bin/python" \
         "$HOME/.word-timing-json/venv/bin/python" \
         "$SKILL/../filmcraft-captions/venv/bin/python"; do
  if [ -x "$p" ] && "$p" -c "import faster_whisper" >/dev/null 2>&1; then PY="$p"; break; fi
done
if [ -z "${PY:-}" ]; then
  echo "no Python with faster-whisper found — run scripts/setup.sh first" >&2
  exit 1
fi
exec "$PY" "$SKILL/webapp/transcriber.py" "$@"
