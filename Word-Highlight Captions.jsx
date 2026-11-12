/*
    Word-Highlight Captions for EffectCraft
    Version 1.7.0

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
      a panel), then open Window > Word-Highlight Captions.jsx.

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
    var VERSION = "1.7.0";
    var PANEL_TITLE = "Word-Highlight Captions";
    var SECTION = "Word-Highlight Captions";
    var HOLD = 6614;              // KeyframeInterpolationType.HOLD
    var CENTER_JUSTIFY = 7414;    // ParagraphJustification.CENTER_JUSTIFY
    var SIZE_RATIO = 0.0371;      // 26.7 px at 720x1280
    var BASELINE_PCT = 85.6;      // 1096 px at 1280 tall
    var MAX_PASTE = 400000;       // characters; bigger files must be loaded from disk
    var MAX_PREVIEW = 80;         // preview rows
    var MAX_FILE_BUTTONS = 12;    // file buttons shown at once
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
        if (ownsUndoGroup) app.beginUndoGroup("Word-Highlight Captions");
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

    function buildUI(thisObj) {
        // EffectCraft 0.24's File.openDialog is a stub that always returns null:
        // there is no native file dialog, so the panel browses folders itself.
        var hasNativeDialog = true;
        try { hasNativeDialog = !/return\s+null/.test(String(File.openDialog)); } catch (e) {}

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
        var title = head.add("statictext", undefined, "WORD-HIGHLIGHT CAPTIONS");
        try { title.graphics.font = ScriptUI.newFont("dialog", "BOLD", 12); } catch (e) {}
        head.add("statictext", undefined, "Poppins SemiBold · white line · the spoken word in orange");

        // ----------------------------------------------------------- captions
        var sourcePanel = ui.add("panel", undefined, "Captions");
        sourcePanel.orientation = "column";
        sourcePanel.alignChildren = ["fill", "top"];
        sourcePanel.margins = 8;
        sourcePanel.spacing = 5;

        var pathRow = sourcePanel.add("group");
        pathRow.alignment = ["fill", "top"];
        pathRow.add("statictext", undefined, "Path");
        var pathField = pathRow.add("edittext", undefined, "", { name: "pathField" });
        pathField.alignment = ["fill", "center"];
        var goBtn = pathRow.add("button", undefined, "Go", { name: "goPath" });

        var fileButtons = sourcePanel.add("group");
        fileButtons.orientation = "row";
        fileButtons.alignment = ["fill", "top"];
        var fileColA = fileButtons.add("group");
        fileColA.orientation = "column";
        fileColA.alignment = ["fill", "top"];
        var fileColB = fileButtons.add("group");
        fileColB.orientation = "column";
        fileColB.alignment = ["fill", "top"];

        var browseNote = sourcePanel.add("statictext", undefined, "", { name: "browseNote", multiline: true });
        browseNote.preferredSize = [380, 28];

        var sourceInfo = sourcePanel.add("statictext", undefined, "No captions loaded yet.", { name: "sourceInfo", multiline: true });
        sourceInfo.preferredSize = [380, 30];

        var previewLabel = sourcePanel.add("statictext", undefined, "Preview:", { name: "previewLabel" });
        var preview = sourcePanel.add("listbox", undefined, [], { name: "preview" });
        preview.preferredSize = [380, 96];

        var pasteLabel = sourcePanel.add("statictext", undefined,
            "Or paste a file path, an SRT or the word-timing JSON:", { name: "pasteLabel" });
        var pasteBox = sourcePanel.add("edittext", undefined, "", { name: "paste", multiline: true, wantReturn: true });
        pasteBox.preferredSize = [380, 44];
        var usePasteBtn = sourcePanel.add("button", undefined, "Use Pasted Text", { name: "usePaste" });
        usePasteBtn.alignment = ["fill", "center"];

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
        status.preferredSize = [380, 40];

        // ---------------------------------------------------------- actions
        var state = { lines: null, kind: "", source: "", words: 0, entries: [], loading: false, loadedPath: "", loadedAt: 0 };
        // the browser starts in the project's folder and follows the project if it changes
        var browser = {
            folder: projectFolder() || loadSetting("lastFolder", ""),
            project: projectFolder()
        };

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
                preview.add("item", (i + 1) + ".  " + timeText(l.start) + "  " + shorten(l.text, 46));
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
                setStatus("Load a caption file first (or paste one and press Use Pasted Text).");
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
                font: font,
                style: style,
                sizePx: sizePx,
                textColorRgb: textRgb,
                highlightRgb: highlightRgb,
                baselinePct: baseline,
                replace: replaceBox.value
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

        function loadFromText(text, sourceName) {
            var t = trim(text);
            if (!t) throw new Error("There is nothing to read.");
            if (t.charAt(0) === "[" || t.charAt(0) === "{") {
                return { lines: normalizeLines(JSON.parse(t)), kind: "json", source: sourceName };
            }
            return { lines: parseSRT(t), kind: "srt", source: sourceName };
        }

        function loadFile(file) {
            var text = readFileText(file);
            var res = loadFromText(text, file.name + " (" + fileSizeText(text.length) + ")");
            adopt(res.lines, res.kind, res.source, file.name);
            try { state.loadedPath = String(file.fsName); } catch (e) {}
            try { state.loadedAt = new Date().getTime(); } catch (e2) {}
            return res;
        }

        // ------------------------------------------------------ file browser
        // This EffectCraft build has no native file dialog (File.openDialog is a
        // stub that returns null), so the panel browses folders itself.
        function pathOf(item, folder) {
            try { return String(item.fsName); } catch (e) {}
            return folder + "/" + item.name;
        }

        function listFolder(folder) {
            var entries = [];
            var list = new Folder(folder).getFiles();
            var i;
            for (i = 0; i < list.length; i++) {
                var it = list[i];
                if (it instanceof File && /\.(json|srt|txt|vtt)$/i.test(it.name)) {
                    var size = 0;
                    try { size = it.length; } catch (e) {}
                    entries.push({ dir: false, label: it.name, name: it.name, path: pathOf(it, folder), size: size });
                }
            }
            entries.sort(function (a, b) {
                return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
            });
            return entries;
        }

        function refreshBrowser() {
            var folder = browser.folder;
            state.entries = [];
            pathField.text = folder || "";
            if (!folder) {
                browseNote.text = "Save the project first, or type a path below.";
                return;
            }
            var entries = null;
            try {
                entries = listFolder(folder);
            } catch (e) {
                // the last folder may have become unreadable — fall back to the project's
                var home = projectFolder();
                if (home && home !== folder) {
                    browser.folder = home;
                    try { entries = listFolder(home); } catch (e2) { entries = null; }
                    if (entries) {
                        folder = home;
                        pathField.text = home;
                        saveSetting("lastFolder", home);
                        browseNote.text = "That folder cannot be read — back in the project's folder.";
                    }
                }
                if (!entries) browseNote.text = "Cannot read that folder: " + friendlyError(e);
            }
            state.entries = entries || [];
            try { fileColA.removeAll(); fileColB.removeAll(); } catch (e) {}
            var i;
            var shown = 0;
            for (i = 0; i < state.entries.length && shown < MAX_FILE_BUTTONS; i++) {
                var en = state.entries[i];
                var label = en.name;
                if (state.sourceName && en.name === state.sourceName) label = "* " + label;
                var col = (shown % 2 === 0) ? fileColA : fileColB;
                var button = col.add("button", undefined, shorten(label, 36), { name: "file" + i });
                button.alignment = ["fill", "top"];
                try { button.helpTip = en.name + " — " + fileSizeText(en.size); } catch (e) {}
                button.onClick = makeFileHandler(i);
                shown++;
            }
            if (entries === null) {
                // the message from the error is already in browseNote
            } else if (!entries.length) {
                browseNote.text = "No caption files (.json / .srt) in " + folder + ".";
            } else {
                browseNote.text = "Showing " + folder + " — click a file to load it." +
                    (entries.length > shown
                        ? " (first " + shown + " of " + entries.length + " — type a path for the rest)"
                        : "") +
                    (hasNativeDialog ? "" : " (no native file dialog in this build)");
            }
        }

        function loadEntry(index) {
            var entry = state.entries[index];
            if (!entry) {
                setStatus("That file is gone — press Go on the path to list the folder again.");
                return;
            }
            followProject();
            state.loading = true;
            try {
                loadFile(new File(entry.path));
                saveSetting("lastFile", entry.name);
                refreshBrowser();
            } catch (e) {
                setStatus("Could not read that file: " + friendlyError(e));
            }
            state.loading = false;
        }

        // each button needs its own copy of the index
        function makeFileHandler(index) {
            return function () { loadEntry(index); };
        }

        // If the user opened another project, show that project's files.
        function followProject() {
            var home = projectFolder();
            if (!home || home === browser.project) return;
            browser.project = home;
            browser.folder = home;
            refreshBrowser();
            setStatus("Now showing the files of " + home + ".");
        }

        function goToTypedPath() {
            var p = trim(pathField.text);
            if (!p) {
                setStatus("Type a folder or a file path first.");
                return;
            }
            var file = new File(p);
            var loaded = false;
            try {
                if (file.exists) {
                    loadFile(file);
                    loaded = true;
                }
            } catch (e) {
                loaded = false;
            }
            if (!loaded) {
                var entries = null;
                try { entries = listFolder(p); } catch (e2) { entries = null; }
                if (entries) {
                    browser.folder = p;
                    refreshBrowser();
                    setStatus("Now showing the files of " + p + ".");
                    loaded = true;
                }
            }
            if (!loaded) {
                setStatus("Cannot use that path: " + p +
                    ". A script may only read files inside the project folder — " +
                    "put the file next to the project, or turn on Settings ▸ Scripting & Expressions ▸ " +
                    "Allow Scripts to Write Files and Access Network.");
            }
        }

        // ---------------------------------------------------------- buttons
        goBtn.onClick = function () {
            followProject();
            goToTypedPath();
        };

        try {
            pathField.onActivate = function () { goToTypedPath(); };
        } catch (e) {}

        usePasteBtn.onClick = function () {
            var text = pasteBox.text;
            if (!trim(text)) {
                setStatus("The paste box is empty — paste a file path, a folder path, an SRT or the JSON.");
                return;
            }
            if (text.length > MAX_PASTE) {
                setStatus("That is too much text to paste (" + fileSizeText(text.length) + "). " +
                    "Use the file list above instead.");
                return;
            }
            var t = trim(text);
            var looksLikePath = t.indexOf("\n") < 0 && (t.charAt(0) === "/" || t.charAt(0) === "~" || /\.(json|srt|txt|vtt)$/i.test(t));
            try {
                if (looksLikePath) {
                    var file = new File(t);
                    var loaded = false;
                    try {
                        if (file.exists) {
                            loadFile(file);
                            loaded = true;
                        }
                    } catch (e2) {
                        loaded = false;
                    }
                    if (!loaded) {
                        // maybe it is a folder
                        var entries = null;
                        try { entries = listFolder(t); } catch (e3) { entries = null; }
                        if (entries) {
                            browser.folder = t;
                            refreshBrowser();
                            setStatus("Now showing the files of " + t + ".");
                            loaded = true;
                        }
                    }
                    if (!loaded) {
                        throw new Error("Cannot use that path: " + t +
                            ". A script may only read files inside the project folder — " +
                            "put the file next to the project, or turn on Settings ▸ Scripting & Expressions ▸ " +
                            "Allow Scripts to Write Files and Access Network.");
                    }
                } else {
                    var res = loadFromText(t, "pasted text (" + fileSizeText(text.length) + ")");
                    adopt(res.lines, res.kind, res.source);
                }
                // the big text has served its purpose: keep the panel small
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
            followProject();
            refreshBrowser();
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
            followProject();
            refreshBrowser();
            try {
                var opts = readOptions();
                saveOptions();
                var comp;
                var result;
                app.beginUndoGroup("Word-Highlight Captions");
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
        if (!hasNativeDialog) {
            setStatus(browser.folder
                ? "Click a caption file in the list above to load it, or paste a file path below."
                : "Save the project so its folder can be listed, or paste a file path below.");
        }
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
