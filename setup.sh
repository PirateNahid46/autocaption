#!/bin/bash
#
# AutoCaption for EffectCraft — Installation Script
# Installs the panel, transcriber service, and web app
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_FILE="$SCRIPT_DIR/AutoCaption.jsx"
EFFECTCRAFT_PANEL_DIR="$HOME/.config/effectcraft/Scripts/ScriptUI Panels"
INSTALL_DIR="$HOME/.local/share/effectcraft-autocaption"
KEYS_DIR="$HOME/.config/autocaption"

echo "=== AutoCaption Installation ==="
echo

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not found."
    echo "Install it with: sudo apt install python3 python3-pip"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo "✓ Python $PYTHON_VERSION found"

# Check Node.js (for syntax validation only)
if command -v node &> /dev/null; then
    echo "✓ Node.js found (for validation)"
else
    echo "⚠ Node.js not found (optional, skipping validation)"
fi

echo

# 1. Install EffectCraft panel
echo "1. Installing EffectCraft panel..."
if [ ! -f "$PANEL_FILE" ]; then
    echo "ERROR: AutoCaption.jsx not found in $SCRIPT_DIR"
    exit 1
fi

mkdir -p "$EFFECTCRAFT_PANEL_DIR"
cp "$PANEL_FILE" "$EFFECTCRAFT_PANEL_DIR/"
echo "   Installed: $EFFECTCRAFT_PANEL_DIR/AutoCaption.jsx"

# Validate syntax if Node.js is available
if command -v node &> /dev/null; then
    if node --check "$EFFECTCRAFT_PANEL_DIR/AutoCaption.jsx" 2>/dev/null; then
        echo "   ✓ Syntax OK"
    else
        echo "   ⚠ Syntax check failed (panel may still work)"
    fi
fi

echo

# 2. Install transcriber service and web app
echo "2. Installing transcriber service..."
mkdir -p "$INSTALL_DIR/webapp"
mkdir -p "$INSTALL_DIR/scripts"

cp "$SCRIPT_DIR/webapp/"*.py "$INSTALL_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/"*.sh "$INSTALL_DIR/webapp/"
cp "$SCRIPT_DIR/webapp/"*.js "$INSTALL_DIR/webapp/" 2>/dev/null || true
cp "$SCRIPT_DIR/webapp/index.html" "$INSTALL_DIR/webapp/" 2>/dev/null || true
cp "$SCRIPT_DIR/scripts/"*.py "$INSTALL_DIR/scripts/"

chmod +x "$INSTALL_DIR/webapp/"*.sh

echo "   Installed transcriber to: $INSTALL_DIR/webapp"
echo "   Installed scripts to: $INSTALL_DIR/scripts"

echo

# 3. Install Python dependencies
echo "3. Installing Python dependencies..."

REQUIREMENTS="$SCRIPT_DIR/requirements.txt"
if [ -f "$REQUIREMENTS" ]; then
    pip3 install -q -r "$REQUIREMENTS"
    echo "   ✓ Dependencies installed from requirements.txt"
else
    echo "   Installing core dependencies..."
    pip3 install -q faster-whisper requests 2>/dev/null || {
        echo "   ⚠ Some packages may require: pip3 install faster-whisper requests"
    }
fi

echo

# 4. Create keys directory
echo "4. Setting up API keys storage..."
mkdir -p "$KEYS_DIR"
if [ ! -f "$KEYS_DIR/keys.json" ]; then
    echo '{"deepgram":"","groq":"","assemblyai":"","openai":""}' > "$KEYS_DIR/keys.json"
    chmod 600 "$KEYS_DIR/keys.json"
    echo "   Created: $KEYS_DIR/keys.json (mode 600)"
else
    echo "   Keys file already exists: $KEYS_DIR/keys.json"
fi

echo

# 5. Test the installation
echo "5. Testing installation..."

# Test transcriber service can start
echo "   Starting transcriber service..."
cd "$INSTALL_DIR/webapp"
bash run-transcriber.sh --port 8787 > /tmp/autocaption-test.log 2>&1 &
TRANSCRIBER_PID=$!
sleep 2

if kill -0 $TRANSCRIBER_PID 2>/dev/null; then
    echo "   ✓ Transcriber service started (PID $TRANSCRIBER_PID)"
    # Test connection
    if command -v curl &> /dev/null; then
        if echo "PING" | nc -w 1 127.0.0.1 8787 2>/dev/null | grep -q "OK"; then
            echo "   ✓ Service responding to PING"
        fi
    fi
    kill $TRANSCRIBER_PID 2>/dev/null
    wait $TRANSCRIBER_PID 2>/dev/null
else
    echo "   ⚠ Transcriber service may have issues (check /tmp/autocaption-test.log)"
fi

# Test web app can start
echo "   Starting web app..."
bash run.sh --port 8765 > /tmp/autocaption-webapp-test.log 2>&1 &
WEBAPP_PID=$!
sleep 3

if kill -0 $WEBAPP_PID 2>/dev/null; then
    echo "   ✓ Web app started (PID $WEBAPP_PID)"
    if command -v curl &> /dev/null; then
        if curl -s http://127.0.0.1:8765/ | grep -q "AutoCaption" 2>/dev/null; then
            echo "   ✓ Web app serving pages"
        fi
    fi
    kill $WEBAPP_PID 2>/dev/null
    wait $WEBAPP_PID 2>/dev/null
else
    echo "   ⚠ Web app may have issues (check /tmp/autocaption-webapp-test.log)"
fi

echo

# 6. Summary
echo "=== Installation Complete ==="
echo
echo "EffectCraft Panel:"
echo "  • Open EffectCraft"
echo "  • Go to Window > Scripts > ScriptUI Panels > AutoCaption.jsx"
echo "  • Turn on Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network"
echo
echo "Services:"
echo "  • Transcriber: $INSTALL_DIR/webapp/run-transcriber.sh"
echo "  • Web app: $INSTALL_DIR/webapp/run.sh"
echo "  • Both start automatically from the panel's 'Start transcriber' button"
echo
echo "API Keys:"
echo "  • Set keys in the panel's 'Keys' tab"
echo "  • Or edit: $KEYS_DIR/keys.json"
echo
echo "Documentation:"
if [ -f "$SCRIPT_DIR/README.md" ]; then
    echo "  • See README.md in $SCRIPT_DIR"
else
    echo "  • Panel has built-in help"
fi
echo
echo "To start the services manually:"
echo "  cd $INSTALL_DIR/webapp"
echo "  bash run.sh          # Web app on http://127.0.0.1:8765"
echo

exit 0
