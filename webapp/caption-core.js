/*
    Caption engine for the browser — the same rules as scripts/word_timing.py.

    Words → caption lines → line times → the EffectCraft panel's JSON + an SRT.
    Loaded by the page and by whisper-worker.js, so the browser and the server
    produce the same file.

    self.CaptionCore.groupLines(words, maxWords, maxChars, pause)
    self.CaptionCore.timeLines(groups, lead, hold)
    self.CaptionCore.toPanelJson(lines, fps)
    self.CaptionCore.srtString(lines)
*/
(function () {
    "use strict";

    var SENT_END = /[.!?…]["'”’)]?$/;

    function rebalance(groups, maxWords, maxChars) {
        var out = groups.map(function (g) { return g.slice(); });
        for (var i = 0; i < out.length - 1; i++) {
            var cur = out[i];
            var nxt = out[i + 1];
            if (nxt.length > 2 || cur.length < 4 || SENT_END.test(cur[cur.length - 1].w)) continue;
            var merged = cur.concat(nxt).map(function (w) { return w.w; }).join(" ");
            if (cur.length + nxt.length <= maxWords + 1 && merged.length <= maxChars + 6) {
                out[i] = cur.concat(nxt);
                out[i + 1] = [];
                continue;
            }
            while (nxt.length < 3 && cur.length > 3) {
                nxt.unshift(cur.pop());
            }
        }
        return out.filter(function (g) { return g.length; });
    }

    /* words: [{w, s, e}] → groups of words */
    function groupLines(words, maxWords, maxChars, pause) {
        var lines = [];
        var cur = [];
        function flush() {
            if (cur.length) { lines.push(cur); cur = []; }
        }
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (cur.length) {
                var prev = cur[cur.length - 1];
                var gap = w.s - prev.e;
                var text = cur.map(function (x) { return x.w; }).join(" ");
                var tooLong = cur.length >= maxWords || (text.length + 1 + w.w.length) > maxChars;
                if (gap > pause || tooLong || (SENT_END.test(prev.w) && cur.length >= 3)) flush();
            }
            cur.push(w);
        }
        flush();
        if (lines.length >= 2 && lines[lines.length - 1].length === 1 &&
            lines[lines.length - 2].length <= maxWords + 1) {
            lines[lines.length - 2] = lines[lines.length - 2].concat(lines.pop());
        }
        return rebalance(lines, maxWords, maxChars);
    }

    /* groups → lines with a start, an end and the words */
    function timeLines(groups, lead, hold) {
        var starts = groups.map(function (g) { return Math.max(0, g[0].s - lead); });
        var out = [];
        for (var i = 0; i < groups.length; i++) {
            var ws = groups[i];
            var start = starts[i];
            if (out.length) start = Math.max(start, out[out.length - 1].end);
            var end = Math.max(ws[ws.length - 1].e + hold, ws[ws.length - 1].e + 0.15, start + 0.2);
            if (i + 1 < groups.length) {
                end = Math.min(end, Math.max(starts[i + 1], start + 0.1));
            }
            out.push({
                text: ws.map(function (w) { return w.w; }).join(" "),
                start: start, end: end, words: ws
            });
        }
        return out;
    }

    function round4(v) { return Math.round(v * 10000) / 10000; }

    /* lines → the JSON the EffectCraft panel reads */
    function toPanelJson(lines, fps) {
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var start = line.start;
            var end = line.end;
            if (fps) { start = Math.round(start * fps) / fps; end = Math.round(end * fps) / fps; }
            var words = [];
            for (var j = 0; j < line.words.length; j++) {
                var w = line.words[j];
                var t0 = w.s;
                var t1 = w.e;
                if (fps) { t0 = Math.round(t0 * fps) / fps; t1 = Math.round(t1 * fps) / fps; }
                words.push({ i: j, text: w.w, t0: round4(t0), t1: round4(t1) });
            }
            out.push({ start: round4(start), end: round4(end), text: line.text, words: words });
        }
        return out;
    }

    function srtTime(t) {
        var ms = Math.round(t * 1000);
        var h = Math.floor(ms / 3600000); ms -= h * 3600000;
        var m = Math.floor(ms / 60000); ms -= m * 60000;
        var s = Math.floor(ms / 1000); ms -= s * 1000;
        function p(v) { return (v < 10 ? "0" : "") + v; }
        return p(h) + ":" + p(m) + ":" + p(s) + "," + ("00" + ms).slice(-3);
    }

    function srtString(lines) {
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            out.push((i + 1) + "\n" + srtTime(lines[i].start) + " --> " + srtTime(lines[i].end) +
                "\n" + lines[i].text + "\n");
        }
        return out.join("\n");
    }

    /* the whole pipeline: words → the panel's JSON */
    function build(words, opts) {
        var groups = groupLines(words, opts.maxWords, opts.maxChars, opts.pause);
        var lines = timeLines(groups, opts.lead, opts.hold);
        var data = toPanelJson(lines, opts.fps);
        var nwords = 0;
        for (var i = 0; i < data.length; i++) nwords += data[i].words.length;
        return {
            json: data,
            srt: srtString(lines),
            lines: data.length,
            words: nwords
        };
    }

    /* --------------------------------------------------------------- parsing */

    var SRT_TIME = /(\d+):(\d+):(\d+)(?:[,.](\d+))?\s*-->\s*(\d+):(\d+):(\d+)(?:[,.](\d+))?/;

    function secs(h, m, s, ms) {
        ms = String(ms === undefined || ms === null ? "0" : ms);
        while (ms.length < 3) ms += "0";
        return (+h) * 3600 + (+m) * 60 + (+s) + (+ms.slice(0, 3)) / 1000;
    }

    /* SRT text → caption lines with estimated word times */
    function parseSrtText(raw) {
        raw = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var lines = [];
        var blocks = raw.trim().split(/\n\s*\n/);
        for (var b = 0; b < blocks.length; b++) {
            var rows = blocks[b].split("\n").filter(function (r) { return r.trim(); });
            var ti = -1;
            for (var r = 0; r < rows.length; r++) if (rows[r].indexOf("-->") >= 0) { ti = r; break; }
            if (ti < 0) continue;
            var m = rows[ti].match(SRT_TIME);
            if (!m) continue;
            var start = secs(m[1], m[2], m[3], m[4]);
            var end = secs(m[5], m[6], m[7], m[8]);
            var text = rows.slice(ti + 1).join(" ").trim();
            if (!text || end <= start) continue;
            var toks = text.split(/\s+/);
            var weights = toks.map(function (t) {
                var base = Math.max(1, (t.match(/[^\W_]/g) || [""]).join("").length);
                if (/[,;:]$/.test(t)) base += 2;
                else if (/[.!?]$/.test(t)) base += 4;
                return base;
            });
            var total = weights.reduce(function (a, b) { return a + b; }, 0) || toks.length;
            var c = start;
            var ws = [];
            for (var i = 0; i < toks.length; i++) {
                var d = (end - start) * weights[i] / total;
                ws.push({ w: toks[i], s: c, e: c + d * 0.9 });
                c += d;
            }
            lines.push({ text: text, start: start, end: end, words: ws });
        }
        if (!lines.length) throw new Error("no subtitle cues with timings were found");
        return lines;
    }

    function toFloat(v) {
        if (v === null || v === undefined || typeof v === "boolean") return null;
        if (typeof v === "number") return isFinite(v) ? v : null;
        var n = parseFloat(String(v).replace(",", "."));
        return isNaN(n) ? null : n;
    }

    function approximateWords(line) {
        var parts = String(line.text).split(/\s+/).filter(Boolean);
        var weights = parts.map(function (p) { return Math.max(1, p.length); });
        var total = weights.reduce(function (a, b) { return a + b; }, 0) || parts.length;
        var span = line.end - line.start;
        var out = [];
        var t = line.start;
        var cum = 0;
        for (var i = 0; i < parts.length; i++) {
            cum += weights[i];
            var t1 = (i === parts.length - 1) ? line.end : line.start + span * (cum / total);
            out.push({ w: parts[i], s: t, e: t1 });
            t = t1;
        }
        return out;
    }

    /* word-timing JSON → caption lines (the panel's own rules) */
    function normalizeJson(data) {
        var arr = data;
        if (data && !Array.isArray(data) && typeof data === "object") {
            arr = data.lines || data.captions;
        }
        if (!Array.isArray(arr)) throw new Error("The JSON must be an array of caption lines (or {lines:[...]}).");
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var raw = arr[i];
            if (!raw || typeof raw !== "object") continue;
            var words = [];
            var ws = raw.words || [];
            for (var j = 0; j < ws.length; j++) {
                var w = ws[j];
                var wt = "", t0 = null, t1 = null;
                if (Array.isArray(w) && w.length >= 3) {
                    wt = String(w[0]); t0 = toFloat(w[1]); t1 = toFloat(w[2]);
                } else if (w && typeof w === "object") {
                    wt = String(w.text || w.word || "");
                    t0 = toFloat(w.t0 !== undefined ? w.t0 : w.start);
                    t1 = toFloat(w.t1 !== undefined ? w.t1 : w.end);
                }
                if (!wt) continue;
                words.push({ w: wt, s: t0, e: t1 });
            }
            var text = (raw.text !== undefined && raw.text !== null) ? String(raw.text) : "";
            if (!text) text = words.map(function (x) { return x.w; }).join(" ");
            var start = toFloat(raw.start);
            var end = toFloat(raw.end);
            if (start === null) start = words.length ? words[0].s : null;
            if (end === null) end = words.length ? words[words.length - 1].e : null;
            if (start === null || end === null || end <= start) continue;
            var valid = words.length > 0;
            for (var k = 0; k < words.length; k++) {
                if (words[k].s === null || words[k].e === null || words[k].e < words[k].s) { valid = false; break; }
            }
            if (!valid) words = approximateWords({ start: start, end: end, text: text });
            for (var m = 0; m < words.length; m++) {
                words[m].s = Math.max(start, Math.min(words[m].s, end));
                words[m].e = Math.max(words[m].s, Math.min(words[m].e, end));
            }
            out.push({ text: text, start: start, end: end, words: words });
        }
        if (!out.length) throw new Error("no caption lines with valid timings were found");
        return out;
    }

    /* pasted JSON or SRT → the panel's JSON */
    function convertText(text) {
        var t = String(text || "").trim();
        if (!t) throw new Error("Nothing to read.");
        var lines, kind;
        if (t.charAt(0) === "[" || t.charAt(0) === "{") {
            lines = normalizeJson(JSON.parse(t));
            kind = "json";
        } else {
            lines = parseSrtText(t);
            kind = "srt";
        }
        var data = toPanelJson(lines, null);
        var nwords = 0;
        for (var i = 0; i < data.length; i++) nwords += data[i].words.length;
        return { json: data, srt: srtString(lines), lines: data.length, words: nwords, kind: kind };
    }

    self.CaptionCore = {
        groupLines: groupLines,
        rebalance: rebalance,
        timeLines: timeLines,
        toPanelJson: toPanelJson,
        srtString: srtString,
        build: build,
        parseSrtText: parseSrtText,
        normalizeJson: normalizeJson,
        convertText: convertText
    };
})();
