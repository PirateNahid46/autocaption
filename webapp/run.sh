#!/bin/bash
# Start AutoCaption Web — the browser app for word-timing JSON files.
#   run.sh [--port 8765] [--open]
# Prints the URL to open; press Ctrl+C to stop.
set -u
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
for p in "$SKILL/../filmcraft-captions/venv/bin/python" \
         "$HOME/.filmcraft-captions/venv/bin/python" \
         "$HOME/.faceless-shorts/venv/bin/python" \
         "$HOME/.word-timing-json/venv/bin/python"; do
  if [ -x "$p" ] && "$p" -c "import faster_whisper" >/dev/null 2>&1; then PY="$p"; break; fi
done
if [ -z "${PY:-}" ]; then
  echo "no Python with faster-whisper found — run scripts/setup.sh first" >&2
  exit 1
fi
exec "$PY" "$SKILL/webapp/app.py" "$@"
