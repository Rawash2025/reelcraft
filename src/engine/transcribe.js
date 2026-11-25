// Speech -> word-timed captions.
//
// Three providers. `manual` needs no key and no network: you paste the script
// and it distributes words across the clip weighted by syllable length, which
// lands close enough to edit by hand. The other two return real timings.

const KEY_STORE = 'reelcraft.keys';

export const loadKeys = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
  } catch {
    return {};
  }
};
// Merge rather than replace. The Captions panel and the Pilot panel each hold
// their own snapshot of this object, so a straight overwrite from one wipes the
// key the other just saved.
export const saveKeys = (k) => {
  try {
    const current = JSON.parse(localStorage.getItem(KEY_STORE) || '{}');
    localStorage.setItem(KEY_STORE, JSON.stringify({ ...current, ...k }));
  } catch { /* private mode */ }
};

const syllables = (w) => {
  const m = w.toLowerCase().replace(/[^a-z؀-ۿ]/g, '').match(/[aeiouy؀-ۿ]+/g);
  return Math.max(1, m ? m.length : Math.ceil(w.length / 3));
};

export function timeWordsEvenly(text, start, end) {
  const raw = text.split(/\s+/).filter(Boolean);
  if (!raw.length) return [];
  const weights = raw.map(syllables);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.4, end - start);
  let t = start;
  return raw.map((w, i) => {
    const d = (weights[i] / total) * span;
    const word = { text: w, start: +t.toFixed(3), end: +(t + d * 0.96).toFixed(3) };
    t += d;
    return word;
  });
}


/* ------------------------------------------------- local (free) whisper */

export const LOCAL_MODELS = [
  { id: 'Xenova/whisper-tiny', name: 'Tiny — English only in practice, ~40 MB', size: 40 },
  { id: 'Xenova/whisper-base', name: 'Base — fine for English, ~80 MB', size: 80 },
  { id: 'Xenova/whisper-small', name: 'Small — needed for non-English, ~240 MB', size: 240 },
];


/**
 * Whisper's word-level output splits some tokens in ways that read badly as
 * captions — "$40,000" comes back as "$40" then ",000.", which then shows on
 * screen as its own word. Glue a fragment that opens with punctuation back
 * onto the word before it, and drop anything left with no content.
 */
export function normalizeWords(words) {
  const out = [];
  for (const w of words) {
    const text = String(w.text || '').trim();
    if (!text) continue;
    const isFragment = /^[,.:;!?%'’\)\]]/.test(text);
    const prev = out[out.length - 1];
    if (isFragment && prev) {
      prev.text += text;
      prev.end = Math.max(prev.end, w.end);
      continue;
    }
    out.push({ ...w, text });
  }
  // A token with no letters or digits at all is punctuation debris.
  return out.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
}

/** Whisper expects mono float32 at 16 kHz. */
export async function decodeForASR(file) {
  const buf = await file.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ac.decodeAudioData(buf);
  ac.close();
  if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1)
    return decoded.getChannelData(0);
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Transcribe on this machine. Costs nothing and sends no audio anywhere —
 * the model runs inside the tab.
 */
export async function transcribeLocal(file, {
  model = 'Xenova/whisper-small', language, translate = false, onProgress = () => {},
} = {}) {
  const audio = await decodeForASR(file);

  // WebGPU when the browser has it, WASM otherwise; the worker falls back on
  // its own if WebGPU initialisation fails.
  const device = typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm';

  const worker = new Worker(new URL('./asr.worker.js', import.meta.url), { type: 'module' });

  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m);
        else if (m.type === 'done') resolve(normalizeWords(m.words));
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (err) => reject(new Error(err.message || 'Worker failed'));
      // Transfer the buffer rather than copying it.
      worker.postMessage({ audio, model, language, device, translate }, [audio.buffer]);
    });
  } finally {
    worker.terminate();
  }
}

// Domain vocabulary to prime Whisper (the `prompt` field biases spelling of
// names/terms it would otherwise mangle). Used for Groq/OpenAI transcription.
export const MORTGAGE_PROMPT =
  'mortgage, EIBOR, DIB, ADIB, FAB, Emirates NBD, ' +
  'Dubai Islamic Bank, Abu Dhabi Islamic Bank, LTV, DBR, UAE, AED, ' +
  'pre-approval, refinance, property, down payment, salary transfer, ' +
  'self employed, Dubai, Abu Dhabi.';

// Recommended Groq models (editable; do not hard-depend on one existing).
export const GROQ_MODELS = {
  transcribe: 'whisper-large-v3',        // word timestamps + best multilingual
  transcribeFast: 'whisper-large-v3-turbo',
};

/**
 * Groq Whisper — free-tier cloud transcription with real word timestamps.
 * OpenAI-compatible audio API. `translate:true` uses the translations endpoint
 * (any language -> English) for Arabic->English captions; otherwise transcribes
 * in the spoken language (pass `language` e.g. 'ar', or omit for auto-detect).
 */
async function transcribeGroq(blob, key, { language, model, prompt, translate } = {}) {
  const base = 'https://api.groq.com/openai/v1/audio';
  const endpoint = translate ? `${base}/translations` : `${base}/transcriptions`;
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model', model || GROQ_MODELS.transcribe);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  if (prompt) fd.append('prompt', prompt);
  // translations endpoint always outputs English and rejects `language`.
  if (!translate && language && language !== 'auto') fd.append('language', language);

  const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
  if (res.status === 401) throw new Error('Groq rejected that API key.');
  if (res.status === 429) throw new Error('Groq rate limit — wait a moment.');
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();

  let words = (json.words || []).map((w) => ({
    text: String(w.word ?? w.text ?? '').trim(),
    start: w.start,
    end: w.end,
  })).filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));

  // If word timings are missing (some models/paths only return segments),
  // distribute each segment's words across its time range so captions still sync.
  if (!words.length && Array.isArray(json.segments)) {
    words = [];
    for (const seg of json.segments) {
      const segWords = timeWordsEvenly(seg.text || '', seg.start, seg.end);
      words.push(...segWords);
    }
  }
  if (!words.length && json.text) words = timeWordsEvenly(json.text, 0, 30);
  return { words, language: json.language, text: json.text };
}

async function transcribeOpenAI(blob, key, language) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.webm');
  fd.append('model', 'whisper-1');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (language) fd.append('language', language);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const words = (json.words || []).map((w) => ({
    text: w.word.trim(),
    start: w.start,
    end: w.end,
  }));
  if (!words.length && json.text) return timeWordsEvenly(json.text, 0, 30);
  return words;
}

async function transcribeDeepgram(blob, key, language) {
  const qs = new URLSearchParams({
    model: 'nova-2',
    punctuate: 'true',
    smart_format: 'true',
  });
  if (language) qs.set('language', language);
  const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const alt = json.results?.channels?.[0]?.alternatives?.[0];
  return (alt?.words || []).map((w) => ({
    text: w.punctuated_word || w.word,
    start: w.start,
    end: w.end,
  }));
}

export async function transcribe({ provider, blob, key, language, ...opts }) {
  if (provider === 'groq') {
    const out = await transcribeGroq(blob, key, {
      language, model: opts.model, prompt: opts.prompt ?? MORTGAGE_PROMPT, translate: opts.translate,
    });
    return normalizeWords(out.words);
  }
  if (provider === 'openai')
    return normalizeWords(await transcribeOpenAI(blob, key, language));
  if (provider === 'deepgram')
    return normalizeWords(await transcribeDeepgram(blob, key, language));
  throw new Error(`Unknown provider ${provider}`);
}

// Pull the audio out of a media file as a compact webm blob for upload.
export async function extractAudio(file, maxSeconds = 600) {
  const buf = await file.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ac.decodeAudioData(buf);
  const dur = Math.min(decoded.duration, maxSeconds);
  const off = new OfflineAudioContext(1, Math.ceil(16000 * dur), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  ac.close();
  return new Blob([encodeWav(rendered)], { type: 'audio/wav' });
}

function encodeWav(buffer) {
  const data = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(out);
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, data.length * 2, true);
  let o = 44;
  for (let i = 0; i < data.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

// SRT / VTT out, so captions can go to YouTube or a client for review.
const stamp = (t, comma) => {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${s}${comma ? ',' : '.'}${ms}`;
};

export function toSRT(chunks) {
  return chunks
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.start, true)} --> ${stamp(c.end, true)}\n${c.words
          .map((w) => w.text)
          .join(' ')}\n`
    )
    .join('\n');
}

export function toVTT(chunks) {
  return (
    'WEBVTT\n\n' +
    chunks
      .map(
        (c) =>
          `${stamp(c.start)} --> ${stamp(c.end)}\n${c.words.map((w) => w.text).join(' ')}\n`
      )
      .join('\n')
  );
}
