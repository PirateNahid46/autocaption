# AutoCaption for EffectCraft — Installation Guide

**Version 3.0.0** — Word-synced Descript-style captions with transcription

---

## Quick Install

```bash
cd effectcraft-autocaption-release
bash setup.sh
```

The installer:
1. ✓ Installs the EffectCraft panel
2. ✓ Installs transcriber service & web app
3. ✓ Installs Python dependencies (faster-whisper, requests)
4. ✓ Creates API keys storage (`~/.config/autocaption/keys.json`)
5. ✓ Tests both services

---

## Requirements

### System
- **Linux** (tested on Ubuntu/Debian)
- **Python 3.8+** — `sudo apt install python3 python3-pip`
- **EffectCraft 0.24.1+** — the panel uses ScriptUI and Socket APIs

### Optional
- **Node.js** — for syntax validation during install (not required at runtime)
- **curl/netcat** — for connection testing

### Python Packages (auto-installed)
- `faster-whisper>=1.0.0` — local transcription
- `requests>=2.31.0` — API provider support

---

## Manual Installation

If `setup.sh` doesn't work or you prefer manual steps:

### 1. Install EffectCraft Panel

```bash
mkdir -p ~/.config/effectcraft/Scripts/ScriptUI\ Panels
cp AutoCaption.jsx ~/.config/effectcraft/Scripts/ScriptUI\ Panels/
```

### 2. Install Transcriber Service

```bash
mkdir -p ~/.local/share/effectcraft-autocaption/{webapp,scripts}
cp webapp/* ~/.local/share/effectcraft-autocaption/webapp/
cp scripts/* ~/.local/share/effectcraft-autocaption/scripts/
chmod +x ~/.local/share/effectcraft-autocaption/webapp/*.sh
```

### 3. Install Dependencies

```bash
pip3 install faster-whisper requests
```

### 4. Create Keys File

```bash
mkdir -p ~/.config/autocaption
echo '{"deepgram":"","groq":"","assemblyai":"","openai":""}' > ~/.config/autocaption/keys.json
chmod 600 ~/.config/autocaption/keys.json
```

---

## Post-Installation

### 1. Enable Network Access in EffectCraft

⚠️ **Required** — The panel talks to the transcriber service over a socket.

1. Open EffectCraft
2. Go to **Settings ▸ Scripting & Expressions**
3. Turn on **"Allow Scripts to Write Files and Access Network"**

Without this, the Transcribe and Keys tabs won't work (Captions tab works offline).

### 2. Set API Keys

Open the panel (**Window ▸ Scripts ▸ ScriptUI Panels ▸ AutoCaption.jsx**), go to the **Keys** tab, and paste your keys:

| Provider | Free Tier | URL |
|---|---|---|
| **Deepgram** (default) | $200 credit | https://console.deepgram.com/ |
| **Groq** | Free | https://console.groq.com/ |
| **AssemblyAI** | 5 hours free | https://www.assemblyai.com/ |
| **OpenAI** | Paid | https://platform.openai.com/ |
| **This machine** | Free (local) | No key needed — uses faster-whisper |

Or edit `~/.config/autocaption/keys.json` directly:

```json
{
  "deepgram": "YOUR_KEY_HERE",
  "groq": "",
  "assemblyai": "",
  "openai": ""
}
```

### 3. Start the Services

The panel's **Keys** tab has a **"Start the transcriber"** button. Click it, or start manually:

```bash
cd ~/.local/share/effectcraft-autocaption/webapp

# Start both services (they auto-start each other)
bash run.sh
```

- **Web app**: http://127.0.0.1:8765
- **Transcriber service**: 127.0.0.1:8787 (TCP socket, no browser UI)

---

## Usage

### 1. Captions Tab

Load an existing word-timing JSON or SRT file from your project folder.

- **Folder** field shows the project folder automatically
- Type a different path and press **Go** to browse elsewhere
- Click any caption file to load it
- Or paste the JSON/SRT text directly

### 2. Transcribe Tab

Pick an engine and a media file to transcribe.

- **Engine**: Deepgram (default), Groq, AssemblyAI, OpenAI, or local
- **Model**: auto-selected per engine
- Click any audio/video file — the panel transcribes it and loads the result

The word-timing JSON is written next to the media file.

### 3. Keys Tab

Manage API keys and start/stop the transcriber.

- **Start the transcriber** button
- Paste keys, press **Save**
- Press **Clear** to delete a key

### 4. Build Captions

After loading captions:

1. Set **Font** (Poppins), **Style** (SemiBold), **Size** (auto or px), **Baseline** (85.6%)
2. Set **Text** color (#FFFFFF), **Highlight** color (#FC9868)
3. Click **Build in Active Comp** or **Build in New Comp**

Each caption line becomes one text layer with a native text animator (fillColor) and range selector (Index/Words mode, hold keyframes).

---

## Troubleshooting

### Panel shows "The panel cannot reach the transcriber"

- Check Settings ▸ Scripting & Expressions ▸ **Allow Scripts to Write Files and Access Network** is ON
- Start the transcriber: `bash ~/.local/share/effectcraft-autocaption/webapp/run.sh`

### "Syntax error" when transcribing

- Fixed in v2.7.0+ (the panel now polls synchronously with `$.sleep`)
- Make sure you have the latest `AutoCaption.jsx`

### Files not showing in the Captions tab

- Save your EffectCraft project first (the panel shows the project's folder)
- Or type a folder path manually and press **Go**

### Transcription fails

- Check the transcriber log: `/tmp/autocaption.log`
- Test the API key: `curl -H "Authorization: Token YOUR_KEY" https://api.deepgram.com/v1/listen`
- Try a different engine or the local "This machine" option

### Web app won't start

- Check port 8765 is free: `lsof -i :8765`
- Check Python packages: `pip3 list | grep -E "faster-whisper|requests"`

---

## Uninstall

```bash
rm ~/.config/effectcraft/Scripts/ScriptUI\ Panels/AutoCaption.jsx
rm -rf ~/.local/share/effectcraft-autocaption
rm -rf ~/.config/autocaption
```

---

## File Structure

```
effectcraft-autocaption-release/
├── setup.sh              # One-click installer
├── requirements.txt      # Python dependencies
├── AutoCaption.jsx       # EffectCraft panel (62KB)
├── README.md             # Project documentation
├── INSTALL.md            # This file
├── webapp/
│   ├── app.py            # Web UI (http://127.0.0.1:8765)
│   ├── transcriber.py    # Socket service (127.0.0.1:8787)
│   ├── providers.py      # API provider support
│   ├── run.sh            # Start web app
│   ├── run-transcriber.sh# Start socket service
│   ├── index.html        # Web UI page
│   ├── caption-core.js   # Caption grouping engine
│   └── whisper-worker.js # Browser-based Whisper.cpp
└── scripts/
    └── word_timing.py    # Shared caption processing

Installed locations:
  ~/.config/effectcraft/Scripts/ScriptUI Panels/AutoCaption.jsx
  ~/.local/share/effectcraft-autocaption/webapp/
  ~/.local/share/effectcraft-autocaption/scripts/
  ~/.config/autocaption/keys.json
```

---

## Version History

- **3.1.0** (Nov 13, 2026) — Added **Project** button for instant project folder view
- **3.0.0** (Nov 13, 2026) — Tab-style navigation, auto project folder, paste box size fix
- **2.9.0** — Fixed paste box expansion, always show project folder
- **2.8.0** — Added folder textbox with Go button
- **2.7.0** — Fixed `app.scheduleTask` syntax error, removed broken folder picker
- **2.6.0** — Added Browse button for folder selection
- **2.5.0** — Removed dropdown folder picker
- **2.4.0** — Section dropdown, network pref hint, Start button
- **2.3.0** — Three tabs, service-driven engine/model lists

---

## Support

- **Repository**: [https://github.com/PirateNahid46/autocaption](https://github.com/PirateNahid46/autocaption)
- **Issues**: Report bugs via GitHub Issues

Made with ❤️ for EffectCraft
