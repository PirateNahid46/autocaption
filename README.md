# AutoCaption for EffectCraft

A ScriptUI panel that builds the Descript-style captions measured from *Stuck in the Dinosaur Age*:
**Poppins SemiBold, white, one centred line low in the frame, the spoken word turning orange
`#FC9868`, word by word.**

It creates **one text layer per caption line**, each with a native text animator (`Fill Color`) and a
range selector in **Index / Words** mode, hold-keyed per word. The current word is orange, pauses go
back to all white, and the last word stays orange until the line ends. Every build is one undo step.

## Why a panel and not a `.wasm` effect

EffectCraft has two extension points (see `plugins.md`): WebAssembly **effect plug-ins**, which process
pixels, and **scripts / ScriptUI panels**, which use the After Effects-style object model. Captions are
authored content — text layers, fonts, selector keyframes, timeline trimming — not a pixel effect, so the
panel is the correct extension type. It is installed exactly like an extension and appears in the Window
menu. A `.wasm` effect cannot create layers or keyframes and has no font rasteriser.



[https://github.com/user-attachments/assets/ed297f49-1db5-403c-a0a7-5e72fb92fe9c](https://github.com/user-attachments/assets/ed297f49-1db5-403c-a0a7-5e72fb92fe9c)

## Install

**Recommended:** in EffectCraft, choose **File ▸ Scripts ▸ Install ScriptUI Panel…**, select
`AutoCaption.jsx`, then open **Window ▸ AutoCaption.jsx**.

**As a bundle:** `Effect ▸ Install Effect Plug-in…` can install this folder; every top-level `.jsx`
becomes a ScriptUI panel (the README and samples are ignored). From a terminal:

```bash
effectcraft-cli exec effect.plugins.install '{"folder":"/path/to/effectcraft-autocaption"}'
```

The panel is copied to `Scripts/ScriptUI Panels/` in the EffectCraft settings folder
(`~/.config/effectcraft` on Linux). The app loads panels at start-up; install it, then open it from the
Window menu.

**Already installed on this machine:** the panel is in
`~/.config/effectcraft/Scripts/ScriptUI Panels/AutoCaption.jsx`. Start (or restart) EffectCraft and open
**Window ▸ AutoCaption.jsx**.

Poppins SemiBold must be installed for the exact look. If it is missing, EffectCraft substitutes another
font; install `Poppins-SemiBold.ttf` from the `filmcraft-captions` skill assets, or edit the Font/Style
fields.

## Use

The panel is built for big caption files: **you never have to paste a large JSON**, and it does not
depend on a native file dialog (EffectCraft 0.24's `File.openDialog` is a stub that returns `null`,
so a “Load JSON…” button can never open a dialog). Instead the panel **browses folders itself** and
you pick the file with **one click**.

```
┌ AUTOCAPTION ──────────────────────────────────────────┐
│ Poppins SemiBold · white line · the spoken word in orange│
│ Section [Captions ▾]                                  │
│ Folder [ /home/you/Videos/MyProject        ] [Go]      │
│ CAPTION FILES — CLICK ONE TO LOAD IT                   │
│ [ Stuck in the Dinosaur Age - Captions.srt ]            │
│ [ * my-captions.json                      ]            │
│ Showing /home/you/Videos/MyProject — click a file.    │
│ 15 lines · 68 words · 35.1 s · my-captions.json      │
│ [ 1. 0:00.0  Your time machine broke, and now     ] │
│ Or paste [                          ] [Load]          │
│ Look  Font [Poppins] Style [SemiBold]                 │
│       Size [auto] px  Baseline [85.6] %                │
│       Text [#FFFFFF]  Highlight [#FC9868]             │
│ Build [Build in Active Comp] [Build in New Comp]       │
└──────────────────────────────────────────────────────┘
```

One **Section** dropdown at the top switches between the three parts of the panel, so only one is on
screen at a time and nothing can overlap (EffectCraft's own tabbed panel draws its tabs on top of each
other, which is why the panel does not use it):

| Section | What it does |
|---|---|
| **Captions** | load an existing word-timing JSON or SRT from the project's folder, or paste one |
| **Transcribe** | pick the engine (Deepgram first) and a media file; the JSON is written next to the media and loaded here |
| **Keys** | see which engines have a key, paste a new one, clear it, and **start the transcriber** |

The panel is 575×630 in the Captions section and shrinks to ~470 tall in the others. The look and the
build buttons stay below, and the status line is always visible.

1. Open the composition that holds the video/audio (or any comp — **Build in New Comp** copies its size
   and frame rate).
2. Load captions — the buttons show the **project's folder** as soon as the panel opens, and they
   follow the project if you open another one:
   - **Click a caption file** to load it; the loaded one is marked with `*`, and the mouse-over tip shows
     its size.
   - **Click a media file** in the *Transcribe a media file* list to **transcribe it right here** (see
     below) — no JSON to copy around.
   - Type a path into the **Path** field and press **Go** (or Enter) to load a file or to show another
     folder's caption files.
   - The format is detected from the content: a JSON array/object is read as word timings, anything
     else as an SRT. Word times in an SRT are estimated from the text; a JSON gives exact times.
   - Or paste a **file path**, an SRT or the JSON into the paste box and press **Use Pasted Text**.
     Whatever you paste is read immediately and the box is emptied again, so a huge JSON never sits
     in the window.
3. Check the **preview** list: it shows the loaded lines with their times. The summary line gives the
   line/word count, the duration and the file size.
4. Adjust Font, Style, Size, Baseline and colours if needed. Size `auto` = 3.71 % of the short side
   (26.7 px at 720×1280, 40.1 px at 1080×1920). Baseline is a percentage of frame height (default
   `85.6`, i.e. y = 1096 at 1280 tall). The note under the fields shows the measured size for the
   active comp.
5. **Build in Active Comp** or **Build in New Comp**. The buttons stay greyed out until captions are
   loaded.

**Build in New Comp** copies the active comp's size and frame rate but contains the caption layers only —
no footage or audio. Use **Build in Active Comp** to put the captions over the edit itself.

The panel names layers `Caption 01`, `Caption 02`, … With **Replace existing caption layers** ticked
(default), a rebuild removes those layers first. Don't name other layers `Caption NN` unless you want
them replaced.

## Transcribing from the panel

Click a media file in the **Transcribe a media file** list and the panel transcribes it, writes
`<name> - word timings.json` next to the media and loads it into the panel — no JSON to copy around.

A script may not run programs (`system.callSystem` is a stub in EffectCraft), so the panel asks a small
local service to do the work over a local socket. Start it once:

```bash
bash ~/.local/share/effectcraft-autocaption/webapp/run-transcriber.sh
```

Two things have to be true for this to work:

- the transcriber service is running (`127.0.0.1:8787` by default);
- **Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network** is on —
  without it a script may not use the network, and the panel says so.

If the service is not running the panel tells you exactly what to start.

### Where the transcription happens

The panel's **Engine** list picks the engine — the panel asks the transcriber service which ones
hold a key and shows it in the list:

| Engine | Model | Cost | Notes |
|---|---|---|---|
| `deepgram` | `whisper-large` (or `nova-3`) | **$200 free credit** ≈ 43 000 minutes, no card needed | the audio is uploaded; word times |
| `local` | `small.en` / `small` / `medium` / `large-v3` | free | faster-whisper **on your own CPU** — nothing is uploaded |
| `groq` | `whisper-large-v3-turbo` | free tier | the audio is uploaded |
| `assemblyai` | `best` / `nano` | free tier | the audio is uploaded |
| `openai` | `whisper-1` | paid | the audio is uploaded |

Deepgram is the default. Choosing an engine repopulates the **Model** list with that engine's
models, and the line under it says what happens (uploaded or not, free or paid, key set or not).

For the online providers the audio is extracted to 16 kHz mono and, if it is too long for one
request, sent in pieces whose word times are shifted back into place — so a long video still gets one
continuous set of timings.

### API keys

Keys are **not** typed into the caption fields — they live on the service, in
`~/.config/autocaption/keys.json` (mode 600), and the panel never sees them. You can set them from the
panel's **Keys** tab (it asks the service to store them), or from a terminal:

```bash
bash ~/.local/share/effectcraft-autocaption/webapp/run-transcriber.sh --set-key deepgram <your key>
bash ~/.local/share/effectcraft-autocaption/webapp/run-transcriber.sh --keys
```

You can also export `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY` or `OPENAI_API_KEY`
instead. The panel's engine list shows which engines hold a key (*key set* / *no key*).

### Starting the transcriber

A panel may not run programs (`system.callSystem` is a stub), so the panel cannot start the service
itself — but the **local web app** can, and the panel asks it to:

```
[Start the transcriber]  →  the panel pings the service
                         →  not running? it posts to http://127.0.0.1:8765/api/start-transcriber
                         →  the web app starts it and the panel picks it up
```

So run the web app once (`webapp/run.sh`) — it now **starts the transcriber itself** — and the panel can
start it on demand too. The web app has the same button on its page.

**One setting is required**: the panel talks to the service over a socket, so
**Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network** must be on.
Without it the panel says exactly that, and the Captions section still works (it only reads files).

A Deepgram key comes from <https://console.deepgram.com> — the free tier starts with **$200 of
credit** (no card needed, about 43 000 minutes of transcription).

## Word-timing JSON

```json
[
  {
    "start": 0.067,
    "end": 2.5,
    "text": "Your time machine broke, and now",
    "words": [
      {"text": "Your", "t0": 0.1, "t1": 0.333},
      {"text": "time", "t0": 0.333, "t1": 0.567},
      {"text": "machine", "t0": 0.567, "t1": 0.967},
      {"text": "broke,", "t0": 0.967, "t1": 1.867},
      {"text": "and", "t0": 2.133, "t1": 2.367},
      {"text": "now", "t0": 2.367, "t1": 2.5}
    ]
  }
]
```

Also accepted:

- `{"lines": [...]}` or `{"captions": [...]}`
- words as arrays: `["Your", 0.1, 0.333]`
- word times named `start` / `end` instead of `t0` / `t1`
- a line without `start` / `end` (taken from the first/last word)
- a line without `words` (estimated from its text and line span)

This is the format produced by the `word-timing-json` skill (`<name> - word timings.json`), by its
browser app (**AutoCaption Web**: drop a media file on the page, get the JSON back), and by the
`filmcraft-captions` skill's transcription step (`caption_data30.json`), so the same measured timings
can be replayed exactly.

## Notes and traps

- **There is no native file dialog in this build.** EffectCraft 0.24 ships
  `File.openDialog = function () { return null; };`, so a button that calls it does nothing at all.
  The panel therefore browses folders itself with `Folder.getFiles()`.
- **A script may only read inside the project's folder.** The list shows the project's folder; for a
  file elsewhere, put it next to the project, or turn on **Settings ▸ Scripting & Expressions ▸ Allow
  Scripts to Write Files and Access Network**.
- **The list holds caption files only** (`.json`, `.srt`, `.txt`, `.vtt`) and shows at most 12 of
  them; subfolders are not listed — type a path into the **Path** field to look inside one.
- **The file entries are buttons, not a list box.** EffectCraft fires `onChange` for a list box, so a
  script that only listens to `onClick` never hears the click; buttons always work.
- **Big files do not need to be pasted.** The browser + **Open** is the route for large JSON files.
  If you do paste one, the panel reads it and empties the box again, so the window stays small.
- **SRT word timing is an estimate.** Punctuation and pauses inside a cue are not reconstructed; use the
  word-timing JSON for exact karaoke timing.
- **Two selectors make the whole line orange.** The panel creates exactly one animator and one selector.
  If you edit the layer by hand, don't add a second range selector.
- **Hold keyframes matter.** Start/End are keyed with Hold interpolation; with linear keys the orange
  would sweep across characters.
- The panel uses the script enum values for the selector: `Units = 2` means Index and `Based On = 3`
  means Words (they are 1-based in the scripting API, 0-based in the engine commands).
- The panel saves its last style values and loaded file with `app.settings` (section
  `AutoCaption`); the folder itself is not restored — the browser always starts in the
  project's folder.

## Files

```
effectcraft-autocaption/
  AutoCaption.jsx              the panel (self-contained)
  README.md
  example.srt                  a small SRT to try
  word-timings.example.json    a small exact-timing example
```
