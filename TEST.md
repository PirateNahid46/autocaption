# Installation Test Checklist

## Pre-Installation
- [ ] Python 3.8+ installed (`python3 --version`)
- [ ] pip3 installed (`pip3 --version`)
- [ ] EffectCraft 0.24.1+ installed

## Running setup.sh
```bash
cd effectcraft-autocaption-release
bash setup.sh
```

Expected output:
- ✓ Python version found
- ✓ Panel installed
- ✓ Transcriber service installed
- ✓ Dependencies installed
- ✓ Keys file created
- ✓ Services start successfully

## Post-Installation Verification

### 1. Panel Installed
```bash
ls -l ~/.config/effectcraft/Scripts/ScriptUI\ Panels/AutoCaption.jsx
```
Should show: `AutoCaption.jsx` file (~62KB)

### 2. Services Installed
```bash
ls -l ~/.local/share/effectcraft-autocaption/webapp/
```
Should show: `app.py`, `transcriber.py`, `providers.py`, `run.sh`, `run-transcriber.sh`

### 3. Keys File Created
```bash
cat ~/.config/autocaption/keys.json
```
Should show: `{"deepgram":"","groq":"","assemblyai":"","openai":""}`

### 4. Test Web App
```bash
cd ~/.local/share/effectcraft-autocaption/webapp
bash run.sh &
sleep 3
curl http://127.0.0.1:8765/ | grep -q "AutoCaption" && echo "✓ Web app OK"
pkill -f "app.py"
```

### 5. Test Panel in EffectCraft
1. Open EffectCraft
2. Settings > Scripting & Expressions > Enable "Allow Scripts to Write Files and Access Network"
3. Window > Scripts > ScriptUI Panels > AutoCaption.jsx
4. Panel opens with three tabs: Captions | Transcribe | Keys

### 6. Test Full Workflow
1. Create/open an EffectCraft project
2. Save it (so panel knows project folder)
3. Open panel
4. **Keys tab**: Click "Start the transcriber" — should say "The transcriber is starting..."
5. **Transcribe tab**: Click any audio file — should show "Transcribing..."
6. Wait ~5-10 seconds
7. **Captions tab**: New JSON file appears in list
8. Click it to load
9. Preview shows caption lines
10. Click "Build in Active Comp"
11. Caption layers appear with text animators

## Troubleshooting

### setup.sh fails
- Check Python: `which python3`
- Check pip: `which pip3`
- Run manually: see INSTALL.md section "Manual Installation"

### Panel doesn't open
- Check syntax: `node --check ~/.config/effectcraft/Scripts/ScriptUI\ Panels/AutoCaption.jsx`
- Check EffectCraft version: 0.24.1+ required

### "Cannot reach the transcriber"
- Enable network access in EffectCraft Settings
- Start service: `bash ~/.local/share/effectcraft-autocaption/webapp/run.sh`

### Transcription fails
- Check logs: `tail -20 /tmp/autocaption.log`
- Try local engine: Select "This machine" (no API key needed)
