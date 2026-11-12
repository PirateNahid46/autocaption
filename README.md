# Word-Highlight Captions for EffectCraft

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

## Install

**Recommended:** in EffectCraft, choose **File ▸ Scripts ▸ Install ScriptUI Panel…**, select
`Word-Highlight Captions.jsx`, then open **Window ▸ Word-Highlight Captions.jsx**.

**As a bundle:** `Effect ▸ Install Effect Plug-in…` can install this folder; every top-level `.jsx`
becomes a ScriptUI panel (the README and samples are ignored). From a terminal:

```bash
effectcraft-cli exec effect.plugins.install '{"folder":"/path/to/effectcraft-word-highlight-captions"}'
```

The panel is copied to `Scripts/ScriptUI Panels/` in the EffectCraft settings folder
(`~/.config/effectcraft` on Linux). The app loads panels at start-up; install it, then open it from the
Window menu.

**Already installed on this machine:** the panel is in
`~/.config/effectcraft/Scripts/ScriptUI Panels/Word-Highlight Captions.jsx`. Start (or restart)
EffectCraft and open **Window ▸ Word-Highlight Captions.jsx**.

Poppins SemiBold must be installed for the exact look. If it is missing, EffectCraft substitutes another
font; install `Poppins-SemiBold.ttf` from the `filmcraft-captions` skill assets, or edit the Font/Style
fields.

## Use

The panel is built for big caption files: **you never have to paste a large JSON**, and it does not
depend on a native file dialog (EffectCraft 0.24's `File.openDialog` is a stub that returns `null`,
so a “Load JSON…” button can never open a dialog). Instead the panel **browses folders itself** and
you pick the file with **one click**.

```
Captions
  Path  [ /home/you/Videos/MyProject            ] [Go]
  [ Stuck in the Dinosaur Age - Captions.srt ]  [ Untitled - Captions.srt ]
  [ Untitled - EffectCraft Captions.srt      ]  [ Untitled - word timings.json ]
  [ Untitled - word timings.srt              ]  [ * my-captions.json ]
  Showing /home/you/Videos/MyProject — click a file to load it.
  15 lines · 68 words · 35.1 s · Untitled - word timings.json (8.0 KB)
  Preview:
   1.  0:00.0  Your time machine broke, and now
   2.  0:02.4  you're stuck in the age of dinosaurs.
   …
  Or paste a file path, an SRT or the word-timing JSON:
  [                                            ]
  [Use Pasted Text]

Look                     Build
 Font [Poppins]           [Build in Active Comp]
 Style [SemiBold]         [Build in New Comp]
 26.7 px · baseline 1096 px (720×1280)
```

1. Open the composition that holds the video/audio (or any comp — **Build in New Comp** copies its size
   and frame rate).
2. Load captions — the buttons show the **project's folder** as soon as the panel opens, and they
   follow the project if you open another one:
   - **Click a file** to load it; the loaded one is marked with `*`, and the mouse-over tip shows its
     size.
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

This is the format produced by the `word-timing-json` skill (`<name> - word timings.json`) and by the
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
  `Word-Highlight Captions`); the folder itself is not restored — the browser always starts in the
  project's folder.

## Files

```
effectcraft-word-highlight-captions/
  Word-Highlight Captions.jsx      the panel (self-contained)
  README.md
  example.srt                      a small SRT to try
  word-timings.example.json        a small exact-timing example
```
