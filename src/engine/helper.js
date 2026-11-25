// Client for the local helper (server/helper.mjs). Every call fails soft: the
// editor keeps working in the browser when the helper is not running.

export const HELPER = 'http://127.0.0.1:5174';

async function call(path, init) {
  const res = await fetch(HELPER + path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Helper error ${res.status}`);
  return body;
}

export async function helperOnline() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${HELPER}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export const getTools = () => call('/api/tools');
export const getConfig = () => call('/api/config');
export const setConfig = (patch) =>
  call('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
export const getLibrary = () => call('/api/library');
export const fileUrl = (path) => `${HELPER}/api/file?path=${encodeURIComponent(path)}`;

const post = (path, body) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = (path, file) =>
  call(path, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name) }, body: file });

export const startDownload = (url) => post('/api/ytdlp', { url });
export const startVoice = (file) => upload('/api/voice', file);
export const startWhisper = (file, { language = '', task = 'transcribe', model = 'small' } = {}) =>
  upload(`/api/whisper?language=${encodeURIComponent(language)}&task=${task}&model=${encodeURIComponent(model)}`, file);
export const startProject = (body) => post('/api/project', body);

/** Poll a job until it finishes. `onUpdate` receives each snapshot. */
export async function waitForJob(id, onUpdate = () => {}) {
  for (;;) {
    const job = await call(`/api/jobs/${id}`);
    onUpdate(job);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.error || 'Job failed');
    await new Promise((r) => setTimeout(r, 900));
  }
}

/** Fetch a file the helper produced or lists, as a File the editor can ingest. */
export async function fetchAsFile(path, name) {
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error('Could not read that file.');
  const blob = await res.blob();
  return new File([blob], name || path.split('/').pop(), { type: blob.type });
}
