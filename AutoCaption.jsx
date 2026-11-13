/*
    AutoCaption for EffectCraft
    Version 3.1.0

    Builds the Descript-style captions measured from "Stuck in the Dinosaur Age":
    Poppins SemiBold, white, one centred line low in the frame, the spoken word
    turning orange (#FC9868), word by word.

    One text layer per caption line. Each line gets a native text animator that
    animates Fill Color, driven by a range selector in Index / Words mode with
    hold keyframes: the current word is orange, pauses go back to all white, and
    the last word stays orange until the line ends.

    Install as a ScriptUI panel (Window menu):
      File > Scripts > Install ScriptUI Panel... and choose this file, or install
      the bundle folder with Effect > Install Effect Plug-in... (the .jsx becomes
      a panel), then open Window > AutoCaption.jsx.

    Caption sources:
      - Word-timing JSON: exact per-word times, e.g.
          [{"start":0.067,"end":2.5,"text":"Your time machine broke, and now",
            "words":[{"text":"Your","t0":0.1,"t1":0.333}, ...]}]
        Also accepts {"lines":[...]} and words as ["word", t0, t1].
      - SRT: cue text and cue times are used as written; word times are estimated
        by word length inside each cue.
      - Pasted text: a file path, an SRT or the JSON itself.

    Big files never have to be pasted: the panel lists the caption files next to
    the project and loads them in one click. Anything pasted is read and the box
    is emptied again, so the panel stays small and responsive.

    Every build is one undo step.
*/

(function (thisObj) {
    var VERSION = "3.1.0";
    var PANEL_TITLE = "AutoCaption";
    var SECTION = "AutoCaption";
    var HOLD = 6614;              // KeyframeInterpolationType.HOLD
    var CENTER_JUSTIFY = 7414;    // ParagraphJustification.CENTER_JUSTIFY
    var SIZE_RATIO = 0.0371;      // 26.7 px at 720x1280
    var BASELINE_PCT = 85.6;      // 1096 px at 1280 tall
    var MAX_PASTE = 400000;       // characters; bigger files must be loaded from disk
    var MAX_PREVIEW = 80;         // preview rows
    var MAX_FILE_BUTTONS = 8;     // file buttons shown at once
    var MEDIA_EXTS = /\.(mp4|m4v|mov|mkv|webm|avi|mpg|mpeg|m4a|mp3|aac|wav|flac|ogg|opus|wma|aif|aiff)$/i;
    var TRANSCRIBER_HOST = "127.0.0.1";
    var TRANSCRIBER_PORT = 8787;
    var WEBAPP_HOST = "127.0.0.1";
    var WEBAPP_PORT = 8765;
    var STATUS_CHARS = 240;       // keeps the status line from stretching the panel

    // ------------------------------------------------------------------ helpers

    function trim(s) {
        return String(s === null || s === undefined ? "" : s).replace(/^\s+|\s+$/g, "");
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function num(v, fallback) {
        var n = parseFloat(String(v).replace(",", "."));
        return isNaN(n) ? fallback : n;
    }

    function isNum(v) {
        return typeof v === "number" && isFinite(v);
    }

    function clamp(v, a, b) {
        return v < a ? a : (v > b ? b : v);
    }

    function shorten(s, n) {
        var t = String(s === null || s === undefined ? "" : s);
        return t.length > n ? t.slice(0, n - 1) + "…" : t;
    }

    function hexToRgb(hex) {
        var s = trim(hex).replace(/^#/, "");
        if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
        return [
            parseInt(s.substr(0, 2), 16) / 255,
            parseInt(s.substr(2, 2), 16) / 255,
            parseInt(s.substr(4, 2), 16) / 255
        ];
    }

    function readFileText(file) {
        file.encoding = "UTF-8";
        if (!file.open("r")) throw new Error("Could not open " + file.fsName + ".");
        var text = file.read();
        file.close();
        return String(text).replace(/^\uFEFF/, "");
    }

    function friendlyError(e) {
        var msg = e && e.message ? e.message : String(e);
        if (msg.indexOf("scripts can only read") >= 0) {
            msg = "This script may only read files inside the project folder. " +
                "Put the file next to the project, or turn on " +
                "Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network.";
        }
        return shorten(msg, STATUS_CHARS);
    }

    function fileSizeText(bytes) {
        var n = Number(bytes);
        if (!isFinite(n) || n < 0) n = 0;
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
        return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    function timeText(t) {
        var s = Math.max(0, t);
        var m = Math.floor(s / 60);
        var sec = s - m * 60;
        return m + ":" + (sec < 10 ? "0" : "") + sec.toFixed(1);
    }

    // -------------------------------------------------------------------- SRT

    function parseTimestamp(h, m, s, frac) {
        return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) +
            parseInt(frac, 10) / Math.pow(10, String(frac).length);
    }

    function approximateWords(line) {
        var parts = String(line.text).split(/\s+/);
        var weights = [];
        var total = 0;
        var i;
        for (i = 0; i < parts.length; i++) {
            var w = Math.max(1, parts[i].length);
            weights.push(w);
            total += w;
        }
        var out = [];
        var t = line.start;
        var span = line.end - line.start;
        var cum = 0;
        for (i = 0; i < parts.length; i++) {
            cum += weights[i];
            var t1 = line.start + span * (cum / total);
            if (i === parts.length - 1) t1 = line.end;
            out.push({ text: parts[i], t0: t, t1: t1 });
            t = t1;
        }
        return out;
    }

    function parseSRT(text) {
        text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var blocks = text.split(/\n\s*\n/);
        var lines = [];
        var b;
        for (b = 0; b < blocks.length; b++) {
            var rows = blocks[b].split("\n");
            var cue = -1;
            var r;
            for (r = 0; r < rows.length; r++) {
                if (rows[r].indexOf("-->") >= 0) { cue = r; break; }
            }
            if (cue < 0) continue;

            var tm = rows[cue].match(/(\d{1,3}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/);
            if (!tm) continue;

            var start = parseTimestamp(tm[1], tm[2], tm[3], tm[4] || "0");
            var end = parseTimestamp(tm[5], tm[6], tm[7], tm[8] || "0");
            if (!(end > start)) continue;

            var body = "";
            for (r = cue + 1; r < rows.length; r++) {
                var s = rows[r].replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "");
                body += (body ? " " : "") + s;
            }
            body = trim(body.replace(/\s+/g, " "));
            if (!body) continue;

            lines.push({ start: start, end: end, text: body, words: approximateWords({ start: start, end: end, text: body }) });
        }

        lines.sort(function (a, c) { return a.start - c.start; });
        if (!lines.length) throw new Error("No subtitle cues with timings were found.");
        return lines;
    }

    // ------------------------------------------------------------- word timing

    function normalizeLines(data) {
        var arr = data;
        if (data && data.lines) arr = data.lines;
        else if (data && data.captions) arr = data.captions;
        if (!arr || typeof arr.length !== "number") {
            throw new Error("The JSON must be an array of caption lines (or {lines:[...]}).");
        }

        var out = [];
        var i;
        for (i = 0; i < arr.length; i++) {
            var raw = arr[i] || {};
            var words = [];
            var ws = raw.words;
            var j;

            if (ws && ws.length) {
                for (j = 0; j < ws.length; j++) {
                    var w = ws[j];
                    var wt = "";
                    var t0 = NaN;
                    var t1 = NaN;
                    if (w && typeof w.length === "number" && w.length >= 3) {
                        wt = String(w[0]);
                        t0 = num(w[1], NaN);
                        t1 = num(w[2], NaN);
                    } else if (w) {
                        wt = String(w.text !== undefined ? w.text : (w.word !== undefined ? w.word : ""));
                        t0 = num(w.t0 !== undefined ? w.t0 : w.start, NaN);
                        t1 = num(w.t1 !== undefined ? w.t1 : w.end, NaN);
                    }
                    if (!wt) continue;
                    words.push({ text: wt, t0: t0, t1: t1 });
                }
            }

            var text = raw.text !== undefined && raw.text !== null ? String(raw.text) : "";
            if (!text) {
                var joined = [];
                for (j = 0; j < words.length; j++) joined.push(words[j].text);
                text = joined.join(" ");
            }

            var start = num(raw.start, words.length ? words[0].t0 : NaN);
            var end = num(raw.end, words.length ? words[words.length - 1].t1 : NaN);
            if (!isNum(start) || !isNum(end) || !(end > start)) continue;

            var valid = words.length > 0;
            if (valid) {
                for (j = 0; j < words.length; j++) {
                    if (!isNum(words[j].t0) || !isNum(words[j].t1) || !(words[j].t1 >= words[j].t0)) {
                        valid = false;
                        break;
                    }
                }
            }
            if (!valid) words = approximateWords({ start: start, end: end, text: text });

            for (j = 0; j < words.length; j++) {
                words[j].t0 = clamp(words[j].t0, start, end);
                words[j].t1 = clamp(words[j].t1, words[j].t0, end);
            }

            if (!text) {
                var joined2 = [];
                for (j = 0; j < words.length; j++) joined2.push(words[j].text);
                text = joined2.join(" ");
            }
            out.push({ start: start, end: end, text: text, words: words });
        }

        if (!out.length) throw new Error("No caption lines with valid timings were found.");
        return out;
    }

    // ------------------------------------------------------------------ build

    function setHoldKeys(prop, keys) {
        var map = {};
        var order = [];
        var i;
        for (i = 0; i < keys.length; i++) {
            var t = Math.round(keys[i].t * 10000) / 10000;
            if (!(t in map)) order.push(t);
            map[t] = keys[i].v;
        }
        order.sort(function (a, b) { return a - b; });
        for (i = 0; i < order.length; i++) {
            prop.setValueAtTime(order[i], map[order[i]]);
        }
        var hold = HOLD;
        try {
            if (typeof KeyframeInterpolationType !== "undefined" && KeyframeInterpolationType.HOLD !== undefined) {
                hold = KeyframeInterpolationType.HOLD;
            }
        } catch (e) {}
        for (i = 1; i <= prop.numKeys; i++) {
            try { prop.setInterpolationTypeAtKey(i, hold, hold); } catch (e2) {}
        }
    }

    function buildCaptions(comp, lines, opts) {
        var made = 0;
        var removed = 0;
        var size = opts.sizePx > 0 ? opts.sizePx :
            Math.round(Math.min(comp.width, comp.height) * SIZE_RATIO * 10) / 10;
        var y = Math.round(comp.height * (opts.baselinePct / 100));
        var x = comp.width / 2;

        var ownsUndoGroup = !opts.grouped;
        if (ownsUndoGroup) app.beginUndoGroup("AutoCaption");
        try {
            if (opts.replace) {
                for (var i = comp.numLayers; i >= 1; i--) {
                    var old = comp.layer(i);
                    if (old && /^Caption \d+$/.test(old.name)) {
                        old.remove();
                        removed++;
                    }
                }
            }

            for (var n = 0; n < lines.length; n++) {
                var line = lines[n];
                var layer = comp.layers.addText(line.text);
                layer.name = "Caption " + pad2(n + 1);

                var textProp = layer.property("Text");
                var sourceText = textProp.property("Source Text");
                var doc = sourceText.value;
                doc.text = line.text;
                doc.font = opts.font;
                if (opts.style) doc.fontStyle = opts.style;
                doc.fontSize = size;
                doc.fillColor = opts.textColorRgb;
                doc.justification = CENTER_JUSTIFY;
                sourceText.setValue(doc);
                layer.transform.position.setValue([x, y]);

                var animator = textProp.property("Animators").addProperty("ADBE Text Animator");
                animator.name = "Highlight";

                var fill = animator.property("Properties").addProperty("ADBE Text Fill Color");
                fill.setValue([opts.highlightRgb[0], opts.highlightRgb[1], opts.highlightRgb[2], 1]);

                var selector = animator.property("Selectors").addProperty("ADBE Text Selector");
                selector.name = "Word";
                var advanced = selector.property("Advanced");
                advanced.property("Units").setValue(2);     // script enum: 2 = Index
                advanced.property("Based On").setValue(3);  // script enum: 3 = Words

                var startKeys = [{ t: 0, v: 0 }];
                var endKeys = [{ t: 0, v: 0 }];
                for (var w = 0; w < line.words.length; w++) {
                    var word = line.words[w];
                    startKeys.push({ t: word.t0, v: w });
                    endKeys.push({ t: word.t0, v: w + 1 });
                    var next = line.words[w + 1];
                    if (next && next.t0 > word.t1 + 0.001) {
                        startKeys.push({ t: word.t1, v: 0 });
                        endKeys.push({ t: word.t1, v: 0 });
                    }
                }
                setHoldKeys(selector.property("Start"), startKeys);
                setHoldKeys(selector.property("End"), endKeys);
                setHoldKeys(layer.transform.opacity, [
                    { t: 0, v: 0 },
                    { t: line.start, v: 100 },
                    { t: line.end, v: 0 }
                ]);

                try {
                    layer.inPoint = line.start;
                    layer.outPoint = line.end;
                } catch (e3) {}

                made++;
            }
        } finally {
            if (ownsUndoGroup) app.endUndoGroup();
        }

        return { made: made, removed: removed, size: size, y: y };
    }

    function makeNewComp(lines) {
        var like = app.project.activeItem;
        var isComp = false;
        try { isComp = like instanceof CompItem; } catch (e) {}
        var w = isComp ? like.width : 1080;
        var h = isComp ? like.height : 1920;
        var fps = isComp ? like.frameRate : 30;
        var end = 0;
        for (var i = 0; i < lines.length; i++) end = Math.max(end, lines[i].end);
        var dur = Math.max(end + 0.5, isComp ? like.duration : 0);
        return app.project.items.addComp("Captions", w, h, 1, dur, fps);
    }

    // -------------------------------------------------------------------- UI

    function loadSetting(key, fallback) {
        try {
            var v = app.settings.getSetting(SECTION, key);
            if (v === null || v === undefined || v === "") return fallback;
            return String(v);
        } catch (e) {
            return fallback;
        }
    }

    function saveSetting(key, value) {
        try { app.settings.saveSetting(SECTION, key, String(value)); } catch (e) {}
    }

    function projectFolder() {
        try {
            if (app.project && app.project.file && app.project.file.parent) {
                return String(app.project.file.parent.fsName);
            }
        } catch (e) {}
        return "";
    }

    // The engines, with their models. The service reports the same list (plus
    // which keys it holds); this is the fallback when the service is down.
    var ENGINES = {
        deepgram: { title: "Deepgram", env: "DEEPGRAM_API_KEY",
                    models: ["whisper-large", "nova-3"],
                    note: "Deepgram — $200 free credit, the audio is uploaded" },
        groq: { title: "Groq", env: "GROQ_API_KEY",
                models: ["whisper-large-v3-turbo"],
                note: "Groq — free tier, the audio is uploaded" },
        assemblyai: { title: "AssemblyAI", env: "ASSEMBLYAI_API_KEY",
                      models: ["best", "nano"],
                      note: "AssemblyAI — free tier, the audio is uploaded" },
        openai: { title: "OpenAI", env: "OPENAI_API_KEY",
                  models: ["whisper-1"],
                  note: "OpenAI — paid, the audio is uploaded" },
        local: { title: "This machine", env: null,
                 models: ["small.en", "small", "medium", "large-v3"],
                 note: "faster-whisper on this machine — nothing is uploaded" }
    };
    var ENGINE_ORDER = ["deepgram", "groq", "assemblyai", "openai", "local"];

    function pathOf(item, folder) {
        try { return String(item.fsName); } catch (e) {}
        return folder + "/" + item.name;
    }

    function buildUI(thisObj) {
        var ui = (thisObj instanceof Panel) ? thisObj :
            new Window("palette", PANEL_TITLE, undefined, { resizeable: true });
        ui.orientation = "column";
        ui.alignChildren = ["fill", "top"];
        ui.spacing = 6;
        ui.margins = 10;

        // ------------------------------------------------------------- header
        var head = ui.add("group");
        head.orientation = "column";
        head.alignChildren = ["left", "top"];
        head.spacing = 1;
        var title = head.add("statictext", undefined, "AUTOCAPTION");
        try { title.graphics.font = ScriptUI.newFont("dialog", "BOLD", 12); } catch (e) {}
        head.add("statictext", undefined, "Poppins SemiBold · white line · the spoken word in orange");

        // ------------------------------------------------------ tabs
        var tabRow = ui.add("group");
        tabRow.alignment = ["fill", "top"];
        tabRow.spacing = 2;
        var tabCaptions = tabRow.add("button", undefined, "Captions", { name: "tabCaptions" });
        var tabTranscribe = tabRow.add("button", undefined, "Transcribe", { name: "tabTranscribe" });
        var tabKeys = tabRow.add("button", undefined, "Keys", { name: "tabKeys" });
        tabCaptions.alignment = ["fill", "center"];
        tabTranscribe.alignment = ["fill", "center"];
        tabKeys.alignment = ["fill", "center"];

        // ---------------------------------------------------- 1 · captions
        var capGroup = ui.add("group", undefined, { name: "capGroup" });
        capGroup.orientation = "column";
        capGroup.alignChildren = ["fill", "top"];
        capGroup.spacing = 5;

        var pathRow = capGroup.add("group");
        pathRow.alignment = ["fill", "top"];
        pathRow.add("statictext", undefined, "Folder");
        var pathField = pathRow.add("edittext", undefined, "", { name: "pathField" });
        pathField.alignment = ["fill", "center"];
        pathField.preferredSize = [210, 22];
        var projectBtn = pathRow.add("button", undefined, "Project", { name: "projectBtn" });
        var goBtn = pathRow.add("button", undefined, "Go", { name: "goPath" });

        capGroup.add("statictext", undefined, "CAPTION FILES — CLICK ONE TO LOAD IT", { name: "capHead" });

        var fileButtons = capGroup.add("group");
        fileButtons.orientation = "row";
        fileButtons.alignment = ["fill", "top"];
        var fileColA = fileButtons.add("group");
        fileColA.orientation = "column";
        fileColA.alignment = ["fill", "top"];
        var fileColB = fileButtons.add("group");
        fileColB.orientation = "column";
        fileColB.alignment = ["fill", "top"];

        var browseNote = capGroup.add("statictext", undefined, "", { name: "browseNote", multiline: true });
        browseNote.preferredSize = [380, 16];

        var sourceInfo = capGroup.add("statictext", undefined, "No captions loaded yet.", { name: "sourceInfo", multiline: true });
        sourceInfo.preferredSize = [380, 16];

        var preview = capGroup.add("listbox", undefined, [], { name: "preview" });
        preview.preferredSize = [380, 78];

        var pasteGroup = capGroup.add("group");
        pasteGroup.orientation = "column";
        pasteGroup.alignment = ["fill", "top"];
        pasteGroup.spacing = 3;
        pasteGroup.add("statictext", undefined, "Or paste");
        var pasteBox = pasteGroup.add("edittext", undefined, "", { name: "paste", multiline: true, wantReturn: true, scrolling: true });
        pasteBox.alignment = ["fill", "center"];
        pasteBox.preferredSize = [380, 38];
        pasteBox.maximumSize = [380, 38];
        var usePasteBtn = pasteGroup.add("button", undefined, "Load", { name: "usePaste" });
        usePasteBtn.alignment = ["fill", "top"];

        // -------------------------------------------------- 2 · transcribe
        var mediaGroup = ui.add("group", undefined, { name: "mediaGroup" });
        mediaGroup.orientation = "column";
        mediaGroup.alignChildren = ["fill", "top"];
        mediaGroup.spacing = 5;

        var engineRow = mediaGroup.add("group");
        engineRow.alignment = ["fill", "top"];
        engineRow.add("statictext", undefined, "Engine");
        var engineList = engineRow.add("dropdownlist", undefined, [], { name: "engine" });
        engineList.alignment = ["fill", "center"];
        engineList.preferredSize = [140, 24];
        engineRow.add("statictext", undefined, "Model");
        var modelList = engineRow.add("dropdownlist", undefined, [], { name: "model" });
        modelList.alignment = ["fill", "center"];
        modelList.preferredSize = [130, 24];
        engineRow.add("statictext", undefined, "Lang");
        var languageField = engineRow.add("edittext", undefined, loadSetting("language", ""), { name: "language" });
        languageField.characters = 5;
        languageField.alignment = ["fill", "center"];

        var engineNote = mediaGroup.add("statictext", undefined, "", { name: "engineNote", multiline: true });
        engineNote.preferredSize = [380, 16];

        mediaGroup.add("statictext", undefined, "MEDIA FILES — CLICK ONE TO TRANSCRIBE IT", { name: "mediaHead" });

        var mediaButtons = mediaGroup.add("group");
        mediaButtons.orientation = "row";
        mediaButtons.alignment = ["fill", "top"];
        var mediaColA = mediaButtons.add("group");
        mediaColA.orientation = "column";
        mediaColA.alignment = ["fill", "top"];
        var mediaColB = mediaButtons.add("group");
        mediaColB.orientation = "column";
        mediaColB.alignment = ["fill", "top"];

        var mediaNote = mediaGroup.add("statictext", undefined, "", { name: "mediaNote", multiline: true });
        mediaNote.preferredSize = [380, 16];

        // -------------------------------------------------------- 3 · keys
        var keyGroup = ui.add("group", undefined, { name: "keyGroup" });
        keyGroup.orientation = "column";
        keyGroup.alignChildren = ["fill", "top"];
        keyGroup.spacing = 5;

        keyGroup.add("statictext", undefined, "API KEYS FOR THE ONLINE ENGINES", { name: "keyHead" });

        var keyRow = keyGroup.add("group");
        keyRow.alignment = ["fill", "top"];
        keyRow.add("statictext", undefined, "Service");
        var keyProvider = keyRow.add("dropdownlist", undefined, [], { name: "keyProvider" });
        keyProvider.alignment = ["fill", "center"];
        keyProvider.preferredSize = [140, 24];
        keyRow.add("statictext", undefined, "Key");
        var keyField = keyRow.add("edittext", undefined, "", { name: "keyField" });
        keyField.alignment = ["fill", "center"];
        keyField.preferredSize = [170, 24];

        var keyButtons = keyGroup.add("group");
        keyButtons.alignment = ["fill", "top"];
        var saveKeyBtn = keyButtons.add("button", undefined, "Save key", { name: "saveKey" });
        var clearKeyBtn = keyButtons.add("button", undefined, "Clear key", { name: "clearKey" });
        saveKeyBtn.alignment = ["fill", "center"];
        clearKeyBtn.alignment = ["fill", "center"];

        var keyNote = keyGroup.add("statictext", undefined, "", { name: "keyNote", multiline: true });
        keyNote.preferredSize = [380, 30];

        var serviceRow = keyGroup.add("group");
        serviceRow.alignment = ["fill", "top"];
        var startBtn = serviceRow.add("button", undefined, "Start the transcriber", { name: "startTranscriber" });
        startBtn.alignment = ["fill", "center"];
        var serviceNote = keyGroup.add("statictext", undefined, "", { name: "serviceNote", multiline: true });
        serviceNote.preferredSize = [380, 30];

        // -------------------------------------------------------------- look
        var bottomRow = ui.add("group");
        bottomRow.alignment = ["fill", "top"];

        var lookPanel = bottomRow.add("panel", undefined, "Look");
        lookPanel.orientation = "column";
        lookPanel.alignChildren = ["fill", "top"];
        lookPanel.margins = 8;
        lookPanel.spacing = 5;

        var row1 = lookPanel.add("group");
        row1.alignment = ["fill", "top"];
        row1.add("statictext", undefined, "Font");
        var fontField = row1.add("edittext", undefined, loadSetting("font", "Poppins"), { name: "font" });
        fontField.characters = 10;
        fontField.alignment = ["fill", "center"];
        row1.add("statictext", undefined, "Style");
        var styleField = row1.add("edittext", undefined, loadSetting("style", "SemiBold"), { name: "style" });
        styleField.characters = 9;
        styleField.alignment = ["fill", "center"];

        var row2 = lookPanel.add("group");
        row2.alignment = ["fill", "top"];
        row2.add("statictext", undefined, "Size");
        var sizeField = row2.add("edittext", undefined, loadSetting("size", "auto"), { name: "size" });
        sizeField.characters = 6;
        sizeField.alignment = ["fill", "center"];
        row2.add("statictext", undefined, "px");
        row2.add("statictext", undefined, "Baseline");
        var baselineField = row2.add("edittext", undefined, loadSetting("baseline", String(BASELINE_PCT)), { name: "baseline" });
        baselineField.characters = 6;
        baselineField.alignment = ["fill", "center"];
        row2.add("statictext", undefined, "%");

        var row3 = lookPanel.add("group");
        row3.alignment = ["fill", "top"];
        row3.add("statictext", undefined, "Text");
        var textField = row3.add("edittext", undefined, loadSetting("textColor", "#FFFFFF"), { name: "textColor" });
        textField.characters = 8;
        textField.alignment = ["fill", "center"];
        row3.add("statictext", undefined, "Highlight");
        var highlightField = row3.add("edittext", undefined, loadSetting("highlight", "#FC9868"), { name: "highlight" });
        highlightField.characters = 8;
        highlightField.alignment = ["fill", "center"];

        var replaceBox = lookPanel.add("checkbox", undefined, "Replace existing caption layers", { name: "replace" });
        replaceBox.value = loadSetting("replace", "1") !== "0";

        var lookNote = lookPanel.add("statictext", undefined, "", { name: "lookNote", multiline: true });
        lookNote.preferredSize = [230, 26];

        // ------------------------------------------------------------- build
        var buildPanel = bottomRow.add("panel", undefined, "Build");
        buildPanel.orientation = "column";
        buildPanel.alignChildren = ["fill", "top"];
        buildPanel.margins = 8;
        buildPanel.spacing = 5;

        var buildActiveBtn = buildPanel.add("button", undefined, "Build in Active Comp", { name: "buildActive" });
        var buildNewBtn = buildPanel.add("button", undefined, "Build in New Comp", { name: "buildNew" });
        buildActiveBtn.alignment = ["fill", "center"];
        buildNewBtn.alignment = ["fill", "center"];

        var buildNote = buildPanel.add("statictext", undefined,
            "Active comp: the captions go over your edit.\nNew comp: captions only.",
            { name: "buildNote", multiline: true });
        buildNote.preferredSize = [230, 34];

        // ------------------------------------------------------------ status
        var status = ui.add("statictext", undefined, "Load a caption file to begin.", { name: "status", multiline: true });
        status.preferredSize = [380, 34];

        // ---------------------------------------------------------- actions
        var state = { lines: null, kind: "", source: "", sourceName: "", words: 0, entries: [], media: [],
                      loading: false, loadedPath: "", loadedAt: 0, modelEngine: "" };
        var providerInfo = {};          // provider → {title, models, ready, note}
        var serviceUp = false;
        var browser = { folder: projectFolder() };
        var MODES = ["Captions", "Transcribe", "Keys"];
        var activeTab = 0;

        function showMode(name) {
            var index = 0;
            for (var i = 0; i < MODES.length; i++) if (MODES[i] === name) index = i;
            activeTab = index;
            try {
                tabCaptions.enabled = true;
                tabTranscribe.enabled = true;
                tabKeys.enabled = true;
                if (index === 0) tabCaptions.enabled = false;
                if (index === 1) tabTranscribe.enabled = false;
                if (index === 2) tabKeys.enabled = false;

                capGroup.visible = (index === 0);
                mediaGroup.visible = (index === 1);
                keyGroup.visible = (index === 2);
            } catch (e) {}
            try { ui.layout.layout(true); } catch (e2) {}
            saveSetting("mode", MODES[index]);
        }

        try {
            tabCaptions.onClick = function () { showMode("Captions"); };
            tabTranscribe.onClick = function () { showMode("Transcribe"); };
            tabKeys.onClick = function () { showMode("Keys"); };
        } catch (e) {}

        function setStatus(msg) {
            status.text = shorten(msg, STATUS_CHARS);
        }

        function setBuildEnabled(on) {
            try {
                buildActiveBtn.enabled = on;
                buildNewBtn.enabled = on;
            } catch (e) {}
        }

        function refreshPreview(lines) {
            try { preview.removeAll(); } catch (e) {
                try { while (preview.items.length) preview.remove(0); } catch (e2) {}
            }
            if (!lines) return;
            var n = Math.min(lines.length, MAX_PREVIEW);
            for (var i = 0; i < n; i++) {
                var l = lines[i];
                preview.add("item", (i + 1) + ".  " + timeText(l.start) + "  " + shorten(l.text, 44));
            }
            if (lines.length > n) {
                preview.add("item", "… and " + (lines.length - n) + " more line(s)");
            }
        }

        function adopt(lines, kind, source, fileName) {
            state.lines = lines;
            state.kind = kind;
            state.source = source;
            state.sourceName = fileName || "";
            var words = 0;
            var span = 0;
            var i;
            for (i = 0; i < lines.length; i++) {
                words += lines[i].words.length;
                span = Math.max(span, lines[i].end);
            }
            sourceInfo.text = lines.length + " line" + (lines.length === 1 ? "" : "s") + " · " +
                words + " word" + (words === 1 ? "" : "s") + " · " + span.toFixed(1) + " s · " + source;
            refreshPreview(lines);
            setBuildEnabled(true);
            setStatus(kind === "srt"
                ? "Loaded " + lines.length + " lines from " + source + ". SRT word times are estimated from the text."
                : "Loaded " + lines.length + " lines from " + source + " with exact word times.");
        }

        function requireLines() {
            if (!state.lines || !state.lines.length) {
                setStatus("Load a caption file first (or paste one and press Load).");
                return null;
            }
            return state.lines;
        }

        function readOptions() {
            var font = trim(fontField.text) || "Poppins";
            var style = trim(styleField.text) || "SemiBold";
            var sizeText = trim(sizeField.text);
            var sizePx = (sizeText === "" || sizeText.toLowerCase() === "auto") ? 0 : num(sizeText, 0);
            if (sizePx < 0) sizePx = 0;
            var textRgb = hexToRgb(textField.text);
            var highlightRgb = hexToRgb(highlightField.text);
            if (!textRgb) throw new Error("Text colour must be #RRGGBB.");
            if (!highlightRgb) throw new Error("Highlight colour must be #RRGGBB.");
            var baseline = num(baselineField.text, BASELINE_PCT);
            if (!(baseline >= 0 && baseline <= 100)) throw new Error("Baseline must be between 0 and 100.");
            return {
                font: font, style: style, sizePx: sizePx,
                textColorRgb: textRgb, highlightRgb: highlightRgb,
                baselinePct: baseline, replace: replaceBox.value
            };
        }

        function saveOptions() {
            saveSetting("font", trim(fontField.text));
            saveSetting("style", trim(styleField.text));
            saveSetting("size", trim(sizeField.text));
            saveSetting("baseline", trim(baselineField.text));
            saveSetting("textColor", trim(textField.text));
            saveSetting("highlight", trim(highlightField.text));
            saveSetting("replace", replaceBox.value ? "1" : "0");
            saveSetting("language", trim(languageField.text));
        }

        function updateLookNote() {
            var comp = app.project.activeItem;
            var w = 0;
            var h = 0;
            try {
                if (comp instanceof CompItem) { w = comp.width; h = comp.height; }
            } catch (e) {}
            if (!w || !h) {
                lookNote.text = "Open a composition to see the measured size.";
                return;
            }
            var sizeText = trim(sizeField.text);
            var size = (sizeText === "" || sizeText.toLowerCase() === "auto")
                ? Math.round(Math.min(w, h) * SIZE_RATIO * 10) / 10
                : num(sizeText, 0);
            var baseline = Math.round(h * (num(baselineField.text, BASELINE_PCT) / 100));
            lookNote.text = size + " px · baseline " + baseline + " px (" + w + "×" + h + ")";
        }

        function loadFromText(text, sourceName, fileName) {
            var t = trim(text);
            if (!t) throw new Error("There is nothing to read.");
            if (t.charAt(0) === "[" || t.charAt(0) === "{") {
                var data;
                try {
                    data = JSON.parse(t);
                } catch (e) {
                    throw new Error("the JSON could not be read — it may still be being written. Try again in a moment.");
                }
                return { lines: normalizeLines(data), kind: "json", source: sourceName, fileName: fileName };
            }
            return { lines: parseSRT(t), kind: "srt", source: sourceName, fileName: fileName };
        }

        function loadFile(file) {
            var text = readFileText(file);
            var res = loadFromText(text, file.name + " (" + fileSizeText(text.length) + ")", file.name);
            adopt(res.lines, res.kind, res.source, res.fileName);
            return res;
        }

        // ------------------------------------------------------- file lists
        function listFolder(folder) {
            var entries = [];
            var list = new Folder(folder).getFiles();
            var i;
            for (i = 0; i < list.length; i++) {
                var it = list[i];
                if (it instanceof File && /\.(json|srt|txt|vtt)$/i.test(it.name)) {
                    var size = 0;
                    try { size = it.length; } catch (e) {}
                    entries.push({ label: it.name, name: it.name, path: pathOf(it, folder), size: size });
                }
            }
            entries.sort(function (a, b) {
                return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
            });
            return entries;
        }

        function listMedia(folder) {
            var entries = [];
            try {
                var list = new Folder(folder).getFiles();
                for (var i = 0; i < list.length; i++) {
                    var it = list[i];
                    if (it instanceof File && MEDIA_EXTS.test(it.name)) {
                        var size = 0;
                        try { size = it.length; } catch (e) {}
                        entries.push({ name: it.name, path: pathOf(it, folder), size: size });
                    }
                }
            } catch (e) {}
            entries.sort(function (a, b) {
                return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
            });
            return entries;
        }

        function refreshBrowser() {
            // always use the project folder
            var proj = projectFolder();
            if (proj) browser.folder = proj;
            var folder = browser.folder;
            state.entries = [];
            pathField.text = folder || "";
            checkPendingResult();
            try { fileColA.removeAll(); fileColB.removeAll(); } catch (e) {}
            if (!folder) {
                browseNote.text = "Save the project first so the panel can find its folder.";
                return;
            }
            var entries = null;
            try {
                entries = listFolder(folder);
            } catch (e) {
                browseNote.text = "That folder cannot be read: " + friendlyError(e);
            }
            state.entries = entries || [];
            var i;
            var shown = 0;
            for (i = 0; i < state.entries.length && shown < MAX_FILE_BUTTONS; i++) {
                var en = state.entries[i];
                var label = shorten(en.name, 26) + "  (" + fileSizeText(en.size) + ")";
                if (state.sourceName && en.name === state.sourceName) label = "* " + label;
                var col = (shown % 2 === 0) ? fileColA : fileColB;
                var button = col.add("button", undefined, label, { name: "file" + i });
                button.alignment = ["fill", "top"];
                try { button.helpTip = en.path; } catch (e) {}
                button.onClick = makeFileHandler(i);
                shown++;
            }
            if (entries && entries.length) {
                browseNote.text = "Showing " + folder + (entries.length > shown
                    ? " — first " + shown + " of " + entries.length + ", type a path for the rest." : ".");
            }
            refreshMedia(folder);
        }

        function refreshMedia(folder) {
            try { mediaColA.removeAll(); mediaColB.removeAll(); } catch (e) {}
            state.media = [];
            if (!folder) {
                mediaNote.text = "Save the project first to see its media files.";
                return;
            }
            var entries = listMedia(folder);
            state.media = entries;
            var shown = 0;
            for (var i = 0; i < entries.length && shown < MAX_FILE_BUTTONS; i++) {
                var en = entries[i];
                var label = shorten(en.name, 26) + "  (" + fileSizeText(en.size) + ")";
                var col = (shown % 2 === 0) ? mediaColA : mediaColB;
                var button = col.add("button", undefined, label, { name: "media" + i });
                button.alignment = ["fill", "top"];
                try { button.helpTip = en.path; } catch (e) {}
                button.onClick = makeTranscribeHandler(i);
                shown++;
            }
            mediaNote.text = entries.length
                ? "The word-timing JSON is written next to the file and loaded here."
                : "No audio or video files in this folder.";
        }

        // pick up a finished transcription even if the panel could not poll
        function checkPendingResult() {
            if (!state.pendingOut) return false;
            try {
                var file = new File(state.pendingOut);
                if (!file.exists) return false;
                if (state.loadedPath === String(file.fsName)) return false;
                loadFile(file);
                state.loadedPath = String(file.fsName);
                state.pendingOut = "";
                setStatus("The transcription finished — the word-timing JSON was loaded.");
                return true;
            } catch (e) {
                return false;
            }
        }

        // ------------------------------------------------------------ engines
        function engineLabel(name) {
            var known = providerInfo[name];          // only the service knows the key state
            var info = known || ENGINES[name];
            var label = info.title || name;
            if (known && known.env) {
                label += (known.ready === true) ? "  (key set)" : "  (no key)";
            }
            return label;
        }

        function engineModels(name) {
            var info = providerInfo[name] || ENGINES[name];
            return (info && info.models && info.models.length) ? info.models : [];
        }

        function fillModels(name) {
            var models = engineModels(name);
            try { modelList.removeAll(); } catch (e) {
                try { while (modelList.items.length) modelList.remove(0); } catch (e2) {}
            }
            for (var i = 0; i < models.length; i++) modelList.add("item", models[i]);
            try { modelList.selection = 0; } catch (e3) {}
            var known = providerInfo[name];
            var info = known || ENGINES[name];
            var note = info ? info.note : "";
            if (known && known.env && known.ready !== true) note += " — no key yet (Keys tab).";
            engineNote.text = note;
        }

        function setEngine(name) {
            if (!name) return;
            fillModels(name);
            saveSetting("provider", name);
        }

        function currentEngine() {
            var sel = null;
            try { sel = engineList.selection; } catch (e) {}
            var label = sel && sel.text ? String(sel.text) : "";
            for (var i = 0; i < ENGINE_ORDER.length; i++) {
                var name = ENGINE_ORDER[i];
                var info = providerInfo[name] || ENGINES[name];
                if (label.indexOf(info.title) === 0) return name;
            }
            return loadSetting("provider", "deepgram");
        }

        function currentModel() {
            var sel = null;
            try { sel = modelList.selection; } catch (e) {}
            if (sel && sel.text) return String(sel.text);
            var models = engineModels(currentEngine());
            return models.length ? models[0] : "";
        }

        // keep the model list in step with the engine, whichever event the app sends
        function syncModels() {
            var name = currentEngine();
            if (name === state.modelEngine) return;
            state.modelEngine = name;
            fillModels(name);
        }

        function onEngineChanged() {
            syncModels();
            setEngine(currentEngine());
        }

        try {
            engineList.onChange = onEngineChanged;
            engineList.onClick = onEngineChanged;
        } catch (e) {}

        // ---------------------------------------------------------- the service
        function sendToTranscriber(message, onReply) {
            var reply = "";
            try {
                var s = new Socket();
                s.timeout = 5000;
                if (!s.open(TRANSCRIBER_HOST + ":" + TRANSCRIBER_PORT, "UTF-8")) {
                    s.close();
                    onReply(null, "no transcriber");
                    return;
                }
                s.write(message + "\n");
                for (var i = 0; i < 400; i++) {
                    s.poll();
                    reply += s.read();
                    if (reply.indexOf("\n") >= 0) break;
                }
                s.close();
                onReply(reply, null);
            } catch (e) {
                onReply(null, String(e && e.message ? e.message : e));
            }
        }

        // a tiny HTTP client over the socket (the panel has no fetch)
        function httpPost(host, port, path) {
            var reply = "";
            try {
                var s = new Socket();
                s.timeout = 8000;
                if (!s.open(host + ":" + port, "UTF-8")) { s.close(); return null; }
                s.write("POST " + path + " HTTP/1.1\r\nHost: " + host + ":" + port +
                    "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                for (var i = 0; i < 400; i++) {
                    s.poll();
                    reply += s.read();
                    if (reply.length > 2000) break;
                }
                s.close();
                return reply;
            } catch (e) {
                return null;
            }
        }

        var NETWORK_HINT = "Turn on Settings ▸ Scripting & Expressions ▸ " +
            "Allow Scripts to Write Files and Access Network, so the panel can reach the transcriber.";

        function refreshEngines() {
            sendToTranscriber("PROVIDERS", function (reply, err) {
                if (err || !reply || reply.indexOf("PROVIDERS") !== 0) {
                    serviceUp = false;
                    providerInfo = {};
                    var blocked = /network/.test(String(err || ""));
                    engineNote.text = blocked
                        ? "The panel cannot reach the transcriber. " + NETWORK_HINT
                        : "The transcriber is not running — press “Start the transcriber” in the Keys tab.";
                    serviceNote.text = blocked
                        ? NETWORK_HINT
                        : "The transcriber service is not running on " +
                          TRANSCRIBER_HOST + ":" + TRANSCRIBER_PORT + ".";
                    fillEngineList();
                    fillKeyList();
                    return;
                }
                serviceUp = true;
                var info = {};
                try { info = JSON.parse(reply.slice(10)); } catch (e) {}
                providerInfo = info;
                serviceNote.text = "The transcriber is running on " + TRANSCRIBER_HOST + ":" + TRANSCRIBER_PORT + ".";
                fillEngineList();
                fillKeyList();
            });
        }

        function fillEngineList() {
            var wanted = loadSetting("provider", "deepgram");
            try { engineList.removeAll(); } catch (e) {
                try { while (engineList.items.length) engineList.remove(0); } catch (e2) {}
            }
            var index = 0;
            for (var i = 0; i < ENGINE_ORDER.length; i++) {
                var name = ENGINE_ORDER[i];
                engineList.add("item", engineLabel(name));
                if (name === wanted) index = i;
            }
            try { engineList.selection = index; } catch (e3) {}
            state.modelEngine = "";
            fillModels(ENGINE_ORDER[index]);
        }

        // ------------------------------------------------------------- keys
        function fillKeyList() {
            var wanted = loadSetting("keyProvider", "deepgram");
            try { keyProvider.removeAll(); } catch (e) {
                try { while (keyProvider.items.length) keyProvider.remove(0); } catch (e2) {}
            }
            var index = 0;
            for (var i = 0; i < ENGINE_ORDER.length; i++) {
                var name = ENGINE_ORDER[i];
                keyProvider.add("item", engineLabel(name));
                if (name === wanted) index = i;
            }
            try { keyProvider.selection = index; } catch (e3) {}
            updateKeyNote();
        }

        function currentKeyProvider() {
            var sel = null;
            try { sel = keyProvider.selection; } catch (e) {}
            var label = sel && sel.text ? String(sel.text) : "";
            for (var i = 0; i < ENGINE_ORDER.length; i++) {
                var name = ENGINE_ORDER[i];
                var info = providerInfo[name] || ENGINES[name];
                if (label.indexOf(info.title) === 0) return name;
            }
            return loadSetting("keyProvider", "deepgram");
        }

        function updateKeyNote() {
            var name = currentKeyProvider();
            var known = providerInfo[name];
            var info = known || ENGINES[name];
            if (!info.env) {
                keyNote.text = info.title + " needs no key — it runs on this machine.";
                return;
            }
            if (!known) {
                keyNote.text = info.title + " — the transcriber service holds the key. " +
                    "Start it to see whether a key is saved.";
                return;
            }
            keyNote.text = info.title + " — " + (info.ready === true
                ? "a key is saved. Paste a new one to replace it."
                : "no key yet. Paste one and press Save key.");
        }

        try {
            keyProvider.onChange = function () { saveSetting("keyProvider", currentKeyProvider()); updateKeyNote(); };
            keyProvider.onClick = function () { saveSetting("keyProvider", currentKeyProvider()); updateKeyNote(); };
        } catch (e) {}

        saveKeyBtn.onClick = function () {
            var name = currentKeyProvider();
            var key = trim(keyField.text);
            if (!key) {
                setStatus("Paste the API key first.");
                return;
            }
            if (!serviceUp) {
                setStatus("Start the transcriber first — it is the one that stores the key.");
                return;
            }
            sendToTranscriber("SETKEY " + name + " " + key, function (reply, err) {
                if (err) { transcriberMissing(err); return; }
                if ((reply || "").indexOf("OK") !== 0) {
                    setStatus("The key was not saved: " + shorten(reply, 160));
                    return;
                }
                keyField.text = "";
                setStatus("Saved the " + name + " key.");
                refreshEngines();
            });
        };

        clearKeyBtn.onClick = function () {
            var name = currentKeyProvider();
            if (!serviceUp) {
                setStatus("Start the transcriber first — it is the one that stores the key.");
                return;
            }
            sendToTranscriber("DELKEY " + name, function (reply, err) {
                if (err) { transcriberMissing(err); return; }
                if ((reply || "").indexOf("OK") !== 0) {
                    setStatus("The key was not cleared: " + shorten(reply, 160));
                    return;
                }
                keyField.text = "";
                setStatus("Cleared the " + name + " key.");
                refreshEngines();
            });
        };

        function transcriberMissing(reason) {
            setStatus(/network/.test(String(reason))
                ? NETWORK_HINT
                : "The transcriber is not reachable (" + reason + "). " +
                  "Press “Start the transcriber” in the Keys tab.");
        }

        // The panel cannot start programs itself, but the local web app can:
        // it starts the transcriber service on request.
        startBtn.onClick = function () {
            setStatus("Looking for the transcriber…");
            sendToTranscriber("PING", function (reply, err) {
                if (!err && (reply || "").indexOf("OK") === 0) {
                    setStatus("The transcriber is already running.");
                    serviceUp = true;
                    refreshEngines();
                    return;
                }
                if (err && /network/.test(String(err))) {
                    setStatus(NETWORK_HINT);
                    return;
                }
                serviceUp = false;
                var http = httpPost(WEBAPP_HOST, WEBAPP_PORT, "/api/start-transcriber");
                if (http && http.indexOf("200 OK") >= 0) {
                    setStatus("The transcriber is starting…");
                    refreshEngines();
                    return;
                }
                setStatus("The web app at " + WEBAPP_HOST + ":" + WEBAPP_PORT +
                    " could not start it. Run: bash ~/.local/share/effectcraft-autocaption/" +
                    "webapp/run-transcriber.sh");
            });
        };

        // ---------------------------------------------------------- transcribe
        function transcribeMedia(index) {
            var entry = state.media[index];
            if (!entry) return;
            var dot = entry.path.lastIndexOf(".");
            var base = dot > 0 ? entry.path.slice(0, dot) : entry.path;
            var out = base + " - word timings.json";
            syncModels();
            var engine = currentEngine();
            var info = providerInfo[engine] || ENGINES[engine];
            var request = {
                media: entry.path,
                out: out,
                provider: engine,
                model: currentModel(),
                language: trim(languageField.text),
                max_words: 7, max_chars: 38, pause: 1.0, lead: 0.05, hold: 0.7
            };
            state.pendingOut = out;
            setStatus("Transcribing " + entry.name + " with " + info.title + "…");
            sendToTranscriber("TRANSCRIBE\t" + JSON.stringify(request), function (reply, err) {
                if (err) { transcriberMissing(err); return; }
                var head = (reply || "").split(" ")[0];
                if (head === "ERR") {
                    setStatus("The transcriber refused the job: " + (reply || "").slice(4));
                    return;
                }
                if (head !== "QUEUED") {
                    setStatus("Unexpected answer from the transcriber: " + shorten(reply, 120));
                    return;
                }
                var job = (reply || "").split(" ")[1];
                pollTranscription(job, out, entry.name);
            });
        }

        function makeTranscribeHandler(index) {
            return function () { transcribeMedia(index); };
        }

        function makeFileHandler(index) {
            return function () { loadEntry(index); };
        }

        function loadEntry(index) {
            var entry = state.entries[index];
            if (!entry) {
                setStatus("That file is gone — type a path and press Go.");
                return;
            }
            try {
                loadFile(new File(entry.path));
                state.loadedPath = entry.path;
                saveSetting("lastFile", entry.name);
                refreshBrowser();
            } catch (e) {
                setStatus("Could not read that file: " + friendlyError(e));
            }
        }

        // Store poll state so app.scheduleTask (string-only) can reach it
        var _pollJob = "", _pollOut = "", _pollName = "";

        function pollTranscription(job, out, name) {
            _pollJob = job; _pollOut = out; _pollName = name;
            // Poll synchronously — sendToTranscriber is sync (Socket is blocking)
            for (var attempt = 0; attempt < 120; attempt++) {
                $.sleep(1500);
                var done = false;
                sendToTranscriber("STATUS " + job, function (reply, err) {
                    if (err) { transcriberMissing(err); done = true; return; }
                    var line = (reply || "").replace(/\r?\n$/, "");
                    var head = line.split(" ")[0];
                    if (head === "RUNNING") {
                        setStatus("Transcribing " + name + "…  " + shorten(line.slice(8), 120));
                        return;
                    }
                    if (head === "DONE") {
                        try {
                            loadFile(new File(out));
                            state.loadedPath = out;
                            saveSetting("lastFile", out);
                            refreshBrowser();
                            showMode("Captions");
                            setStatus("Transcribed " + name + " — the word-timing JSON was loaded.");
                        } catch (e) {
                            setStatus("Transcribed, but the JSON could not be read: " + friendlyError(e));
                        }
                        done = true;
                        return;
                    }
                    if (head === "ERR" || head === "FAIL") {
                        setStatus("The transcription failed: " + shorten(line.slice(4), 200));
                        done = true;
                        return;
                    }
                });
                if (done) return;
            }
            setStatus("Timed out after 3 minutes — check the transcriber log.");
        }

        // ---------------------------------------------------------- buttons
        projectBtn.onClick = function () {
            var proj = projectFolder();
            if (!proj) {
                setStatus("Save the project first, then the project folder will be available.");
                return;
            }
            pathField.text = proj;
            browser.folder = proj;
            refreshBrowser();
            setStatus("Showing project folder: " + proj);
        };

        goBtn.onClick = function () {
            var p = trim(pathField.text);
            if (!p) {
                setStatus("Type a folder path first.");
                return;
            }
            var entries = null;
            try { entries = listFolder(p); } catch (e) { entries = null; }
            if (entries) {
                browser.folder = p;
                refreshBrowser();
                setStatus("Showing the files of " + p + ".");
                return;
            }
            var file = new File(p);
            try {
                if (file.exists) {
                    loadFile(file);
                    state.loadedPath = p;
                    return;
                }
            } catch (e) {}
            setStatus("Cannot read " + p + " — a script may only read inside the project folder.");
        };

        usePasteBtn.onClick = function () {
            var text = pasteBox.text;
            if (!trim(text)) {
                setStatus("Paste a file path, an SRT or the JSON first.");
                return;
            }
            if (text.length > MAX_PASTE) {
                setStatus("That is too much text to paste (" + fileSizeText(text.length) + "). " +
                    "Use the file list instead.");
                return;
            }
            var t = trim(text);
            var looksLikePath = t.indexOf("\n") < 0 &&
                (t.charAt(0) === "/" || t.charAt(0) === "~" || /\.(json|srt|txt|vtt)$/i.test(t));
            try {
                if (looksLikePath) {
                    var file = new File(t);
                    var loaded = false;
                    try {
                        if (file.exists) { loadFile(file); loaded = true; }
                    } catch (e) { loaded = false; }
                    if (!loaded) throw new Error("Cannot read that path — put the file next to the project, or turn on " +
                        "Settings ▸ Scripting & Expressions ▸ Allow Scripts to Write Files and Access Network.");
                } else {
                    var res = loadFromText(t, "pasted text (" + fileSizeText(text.length) + ")", "");
                    adopt(res.lines, res.kind, res.source, res.fileName);
                }
                pasteBox.text = "";
            } catch (e) {
                setStatus("Could not read that: " + friendlyError(e));
            }
        };

        buildActiveBtn.onClick = function () {
            var lines = requireLines();
            if (!lines) return;
            var comp = app.project.activeItem;
            if (!(comp instanceof CompItem)) {
                setStatus("Open a composition first.");
                return;
            }
            try {
                var opts = readOptions();
                saveOptions();
                var result = buildCaptions(comp, lines, opts);
                setStatus("Built " + result.made + " caption layers in \"" + comp.name + "\" (" +
                    result.size + " px, baseline " + result.y + " px)." +
                    (result.removed ? " Replaced " + result.removed + " old layer(s)." : ""));
            } catch (e) {
                setStatus("Build failed: " + friendlyError(e));
            }
        };

        buildNewBtn.onClick = function () {
            var lines = requireLines();
            if (!lines) return;
            try {
                var opts = readOptions();
                saveOptions();
                var comp;
                var result;
                app.beginUndoGroup("AutoCaption");
                try {
                    comp = makeNewComp(lines);
                    opts.grouped = true;
                    result = buildCaptions(comp, lines, opts);
                } finally {
                    app.endUndoGroup();
                }
                try { comp.openInViewer(); } catch (e2) {}
                setStatus("Built " + result.made + " caption layers in a new comp \"" + comp.name + "\" (" +
                    result.size + " px, baseline " + result.y + " px).");
            } catch (e) {
                setStatus("Build failed: " + friendlyError(e));
            }
        };

        // --------------------------------------------------------- start up
        setBuildEnabled(false);
        refreshBrowser();
        updateLookNote();
        refreshEngines();
        showMode(loadSetting("mode", "Captions"));
        try {
            fontField.onChanging = updateLookNote;
            sizeField.onChanging = updateLookNote;
            baselineField.onChanging = updateLookNote;
        } catch (e) {}

        if (ui instanceof Window) {
            ui.center();
            ui.show();
        } else {
            ui.layout.layout(true);
        }
    }

    buildUI(thisObj);
})(this);
