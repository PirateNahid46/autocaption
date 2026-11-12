/*
    Whisper in a Web Worker — the transcription runs on the user's own CPU (or GPU).

    The page decodes the media file to 16 kHz mono and sends the samples here;
    this worker loads the model (cached by the browser after the first run),
    transcribes with word-level timestamps and groups the words into caption
    lines with the same rules the server uses.

    Messages in:
      {type:"load", model, device}            → loads (or reuses) the model
      {type:"transcribe", audio, options}     → transcribes (audio is a Float32Array)
    Messages out:
      {type:"progress", file, progress, loaded, total, message}
      {type:"ready", model, device}
      {type:"done", result}
      {type:"error", message}
*/
// The +esm bundle has its dependencies resolved, so it loads in a browser
// without a bundler or an import map.
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";
import "./caption-core.js";

env.allowLocalModels = false;

let transcriber = null;
let loadedModel = "";
let loadedDevice = "";

function post(msg) {
    self.postMessage(msg);
}

async function loadModel(model, device) {
    if (transcriber && loadedModel === model && loadedDevice === device) {
        post({ type: "ready", model: loadedModel, device: loadedDevice });
        return;
    }
    post({ type: "progress", message: "Loading the " + model + " model…" });
    const options = { device: device };
    if (device === "wasm") options.dtype = "q8";
    transcriber = await pipeline("automatic-speech-recognition", model, {
        ...options,
        progress_callback: (p) => {
            if (p.status === "progress" && p.file) {
                post({
                    type: "progress",
                    file: p.file,
                    progress: p.progress,
                    loaded: p.loaded,
                    total: p.total,
                    message: "Loading " + p.file
                });
            }
        }
    });
    loadedModel = model;
    loadedDevice = device;
    post({ type: "ready", model: loadedModel, device: loadedDevice });
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    try {
        if (msg.type === "load") {
            await loadModel(msg.model, msg.device);
            return;
        }
        if (msg.type === "transcribe") {
            if (!transcriber) await loadModel(msg.model, msg.device);
            const opts = msg.options || {};
            post({ type: "progress", message: "Transcribing on your " + (loadedDevice === "webgpu" ? "GPU" : "CPU") + "…" });
            const args = {
                return_timestamps: "word",
                chunk_length_s: 30,
                stride_length_s: 5
            };
            if (opts.language) args.language = opts.language;
            const output = await transcriber(msg.audio, args);
            const words = [];
            const chunks = output.chunks || [];
            for (const chunk of chunks) {
                const text = String(chunk.text || "").trim();
                if (!text) continue;
                const ts = chunk.timestamp || [0, 0];
                const s = Number(ts[0]) || 0;
                const e = Number(ts[1]) || s;
                words.push({ w: text, s: s, e: Math.max(s, e) });
            }
            if (!words.length) throw new Error("No speech was found in the audio");
            const result = self.CaptionCore.build(words, {
                maxWords: opts.maxWords || 7,
                maxChars: opts.maxChars || 38,
                pause: opts.pause || 1.0,
                lead: opts.lead !== undefined ? opts.lead : 0.05,
                hold: opts.hold !== undefined ? opts.hold : 0.7,
                fps: opts.fps || null
            });
            result.model = loadedModel;
            result.duration = msg.audio.length / 16000;
            post({ type: "done", result: result });
            return;
        }
    } catch (error) {
        post({ type: "error", message: (error && error.message) || String(error) });
    }
};
