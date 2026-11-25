// Whisper, in the browser. No API key, no account, no per-minute cost.
//
// Runs in a worker because transcription is heavy enough to freeze the UI
// otherwise. The model is fetched once and then cached by the browser, so the
// first run pays a download and later runs do not.

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

let cached = null;
let cachedKey = '';

async function getPipeline(model, device) {
  const key = `${model}:${device}`;
  if (cached && cachedKey === key) return cached;
  cached = await pipeline('automatic-speech-recognition', model, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device,
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        self.postMessage({
          type: 'progress',
          phase: 'download',
          file: p.file,
          loaded: p.loaded,
          total: p.total,
        });
      } else if (p.status === 'ready' || p.status === 'done') {
        self.postMessage({ type: 'progress', phase: 'ready' });
      }
    },
  });
  cachedKey = key;
  return cached;
}

self.onmessage = async (e) => {
  const { audio, model, language, device, translate } = e.data;
  try {
    self.postMessage({ type: 'progress', phase: 'loading' });

    let pipe;
    try {
      pipe = await getPipeline(model, device);
    } catch (err) {
      // WebGPU is not everywhere, and a failure here is not fatal.
      if (device === 'webgpu') {
        self.postMessage({ type: 'progress', phase: 'fallback' });
        pipe = await getPipeline(model, 'wasm');
      } else {
        throw err;
      }
    }

    self.postMessage({ type: 'progress', phase: 'transcribing' });

    // Whisper's own `translate` task emits English from any source language —
    // one pass, so the word timings still line up with the original speech.
    const task = translate ? 'translate' : 'transcribe';
    const out = await pipe(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      task,
      ...(language ? { language } : {}),
    });

    const words = (out.chunks || [])
      .map((c) => ({
        text: String(c.text || '').trim(),
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 0.3,
      }))
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));

    self.postMessage({ type: 'done', words, text: out.text || '' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
