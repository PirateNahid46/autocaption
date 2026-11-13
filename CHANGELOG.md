# AutoCaption for EffectCraft — Changelog

## [3.1.0] - 2026-11-13

### Added
- **Project button**: Instantly show and load the current EffectCraft project folder next to the folder path field

## [3.0.0] - 2026-11-13

### Changed
- **Tab-style navigation**: Replaced section dropdown with three tab buttons (Captions | Transcribe | Keys)
- **Standalone installation**: No longer requires OpenCode — installs to `~/.local/share/effectcraft-autocaption/`
- **Active tab styling**: Disabled button indicates the active tab

### Fixed
- Paste box no longer expands and overlaps buttons (fixed height with scrolling)
- Project folder path auto-fills on panel startup

### Installation
- Single `setup.sh` script installs everything
- Services installed to `~/.local/share/effectcraft-autocaption/` (not OpenCode-dependent)
- API keys stored in `~/.config/autocaption/keys.json`

---

## [2.9.0] - 2026-11-12

### Fixed
- Paste box expansion issue
- Project folder always shows current project's directory

---

## [2.8.0] - 2026-11-11

### Added
- Folder textbox with "Go" button for manual path entry

---

## [2.7.0] - 2026-11-10

### Fixed
- `app.scheduleTask` syntax error with function passing
- Removed broken folder picker (native dialogs don't work in EffectCraft ScriptUI panels)

### Changed
- Polling now uses `$.sleep` for synchronous waiting

---

## [2.6.0] - 2026-11-09

### Added
- Browse button for folder selection (later removed in 2.7.0 due to compatibility)

---

## [2.5.0] - 2026-11-08

### Removed
- Dropdown folder picker (replaced with text field in 2.8.0)

---

## [2.4.0] - 2026-11-07

### Added
- Section dropdown (Captions / Transcribe / Keys)
- Network permission hint when service is unreachable
- "Start the transcriber" button in Keys tab

---

## [2.3.0] - 2026-11-06

### Added
- Three-tab interface (early version)
- Service-driven engine and model lists from transcriber

---

## [2.0.0] - 2026-11-01

### Added
- Initial release with transcription support
- Deepgram, Groq, AssemblyAI, OpenAI providers
- Local transcription with faster-whisper
- Word-timing JSON builder
- Descript-style caption styling (white text, orange highlight)

---

## About

**AutoCaption** is an EffectCraft ScriptUI panel for building word-highlight captions with word-level timing.

- **Panel**: `AutoCaption.jsx` (62KB)
- **Services**: Transcriber (TCP 8787) + Web UI (HTTP 8765)
- **Installation**: `bash setup.sh`
- **License**: (add your license)
- **Repository**: (add your repo URL)
