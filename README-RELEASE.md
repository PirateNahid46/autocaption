# AutoCaption v3.0.0 — Standalone Release

**Word-synced Descript-style captions for EffectCraft**

This is a standalone, ready-to-install package that **does not require OpenCode**.

---

## What's Inside

- **EffectCraft panel** (v3.0.0) with tab navigation
- **Transcriber service** (5 providers: Deepgram, Groq, AssemblyAI, OpenAI, local faster-whisper)
- **Web UI** for caption preview and editing
- **One-click installer** (`setup.sh`)

---

## Quick Start

```bash
cd effectcraft-autocaption-release
bash setup.sh
```

That's it! The installer:
- ✓ Installs the panel to EffectCraft
- ✓ Installs services to `~/.local/share/effectcraft-autocaption/`
- ✓ Installs Python dependencies (faster-whisper, requests)
- ✓ Creates API keys storage
- ✓ Tests everything

Then:
1. Open EffectCraft
2. **Settings > Scripting & Expressions** → Enable "Allow Scripts to Write Files and Access Network"
3. **Window > Scripts > ScriptUI Panels > AutoCaption.jsx**
4. Click the **Keys** tab → "Start the transcriber"
5. Click the **Transcribe** tab → Select a media file → Done!

---

## Requirements

- **Linux** (Ubuntu/Debian tested)
- **Python 3.8+** — `sudo apt install python3 python3-pip`
- **EffectCraft 0.24.1+**

---

## Features (v3.0.0)

### Tab Navigation
- **Captions** — Load existing caption files
- **Transcribe** — Transcribe new media files
- **Keys** — Manage API keys and start services

### Transcription Providers
| Provider | Free Tier | Speed | Quality |
|---|---|---|---|
| **Deepgram** (default) | $200 credit | ⚡ Very fast | ⭐⭐⭐⭐⭐ |
| **Groq** | Free forever | ⚡⚡⚡ Fastest | ⭐⭐⭐⭐ |
| **AssemblyAI** | 5 hours free | ⚡⚡ Fast | ⭐⭐⭐⭐⭐ |
| **OpenAI** | Paid only | ⚡⚡ Fast | ⭐⭐⭐⭐⭐ |
| **This machine** | Free (local) | ⚡ Slow | ⭐⭐⭐⭐ |

### Caption Style
- **Descript-style word highlighting**: White text, orange word (#FC9868)
- **Font**: Poppins SemiBold (or any installed font)
- **Layout**: One text layer per caption line
- **Animation**: Native text animator with range selector (hold keyframes)

---

## Installation Details

### File Structure After Installation

```
~/.config/effectcraft/Scripts/ScriptUI Panels/
└── AutoCaption.jsx                              # EffectCraft panel (62KB)

~/.local/share/effectcraft-autocaption/
├── webapp/
│   ├── app.py                                   # Web UI server
│   ├── transcriber.py                           # Transcription socket service
│   ├── providers.py                             # API provider integrations
│   ├── run.sh                                   # Start web app
│   └── run-transcriber.sh                       # Start transcriber
└── scripts/
    └── word_timing.py                           # Caption processing

~/.config/autocaption/
└── keys.json                                    # API keys (mode 600)
```

### Services

- **Transcriber**: TCP socket on `127.0.0.1:8787`
- **Web UI**: HTTP server on `http://127.0.0.1:8765`

Both start automatically when you click "Start the transcriber" in the panel's Keys tab.

---

## Documentation

- **INSTALL.md** — Complete installation guide
- **TEST.md** — Installation test checklist
- **README.md** — Full feature documentation
- **CHANGELOG.md** — Version history

---

## Troubleshooting

### Panel doesn't connect to transcriber
- Enable network access: **Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network**
- Start manually: `bash ~/.local/share/effectcraft-autocaption/webapp/run.sh`

### Transcription fails
- Check API key in Keys tab
- Try a different provider
- Use "This machine" for free local transcription (no key needed)

### Python dependency errors
```bash
pip3 install faster-whisper requests
```

---

## What's New in v3.1.0

- ✨ **Project button** — Instantly jump to the current EffectCraft project folder with a single click
- ✨ **Tab-style navigation** — Click Captions | Transcribe | Keys
- ✨ **Standalone installation** — Works without OpenCode
- ✨ **Auto project folder** — Panel shows your project's caption files automatically
- 🐛 **Fixed paste box** — No more expansion/overlap issues

---

## Uninstall

```bash
rm ~/.config/effectcraft/Scripts/ScriptUI\ Panels/AutoCaption.jsx
rm -rf ~/.local/share/effectcraft-autocaption
rm -rf ~/.config/autocaption
```

---

## Version

**v3.1.0** — November 13, 2026

---

## License

(Add your license here)

---

## Repository

(Add your repository URL here)

---

Made with ❤️ for EffectCraft
