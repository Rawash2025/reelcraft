// ReelCraft local helper.
//
// The editor runs in a browser tab and cannot start programs. This small
// server runs next to it on the same Mac and does the jobs that need real
// tools: FFmpeg, yt-dlp, Whisper, Remotion and HyperFrames. It also lets the
// Library page browse a materials folder on disk.
//
// It listens on 127.0.0.1 only, accepts requests only from the ReelCraft page,
// runs only the fixed commands below (never a free-form shell string) and
// serves files only from the folders listed in its config.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.REELCRAFT_HELPER_PORT || 5174);
const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, '.reelcraft');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ALLOWED_ORIGINS = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

// GUI-launched processes on macOS get a short PATH; add the usual tool homes.
const EXTRA_PATH = [
  '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local/bin'),
  path.join(HOME, 'bin'), path.join(HOME, '.bun/bin'), path.join(HOME, '.homebrew/bin'),
  '/usr/bin', '/bin',
];
const ENV = { ...process.env, PATH: [...new Set([...(process.env.PATH || '').split(':'), ...EXTRA_PATH])].filter(Boolean).join(':') };

const DEFAULT_CONFIG = {
  // Both spellings: the folder on this Mac has a trailing space in its name.
  libraryDirs: [
    path.join(HOME, 'Movies', 'ReelCraft Materials'),
  ],
  outputDir: path.join(HOME, 'Movies', 'ReelCraft'),
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();
const libraryRoots = () => config.libraryDirs.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });

/* ------------------------------------------------------------- utilities */

function run(cmd, args, { cwd, onLine, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: ENV });
    } catch (e) {
      return resolve({ code: -1, out: String(e.message) });
    }
    const feed = (buf) => {
      const s = buf.toString();
      out += s;
      if (out.length > 400_000) out = out.slice(-200_000);
      if (onLine) s.split(/\r?\n/).filter(Boolean).forEach(onLine);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => resolve({ code: -1, out: out + String(e.message) }));
    child.on('close', (code) => resolve({ code, out }));
    if (timeoutMs) setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
  });
}

async function which(name) {
  const r = await run('/usr/bin/which', [name], { timeoutMs: 4000 });
  return r.code === 0 ? r.out.trim().split('\n')[0] : null;
}

const firstLine = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';

const MEDIA = {
  video: ['.mp4', '.mov', '.webm', '.m4v', '.mkv'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],
};
const kindOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  return Object.keys(MEDIA).find((k) => MEDIA[k].includes(ext)) || null;
};
const MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

// A path may be served only when it sits inside a library folder or the
// output folder. Resolved first so `..` and symlinks cannot escape.
function allowedPath(p) {
  let real;
  try { real = fs.realpathSync(p); } catch { return null; }
  const roots = [...libraryRoots(), config.outputDir].map((r) => { try { return fs.realpathSync(r); } catch { return null; } }).filter(Boolean);
  return roots.some((r) => real === r || real.startsWith(r + path.sep)) ? real : null;
}

/* ------------------------------------------------------------------ jobs */

const jobs = new Map();
function startJob(label, fn) {
  const id = randomUUID().slice(0, 8);
  const job = { id, label, status: 'running', log: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  const log = (line) => { job.log.push(line); if (job.log.length > 400) job.log.splice(0, job.log.length - 400); };
  Promise.resolve()
    .then(() => fn(log))
    .then((result) => { job.status = 'done'; job.result = result; })
    .catch((e) => { job.status = 'error'; job.error = e.message || String(e); });
  return job;
}

/* ----------------------------------------------------------------- tools */

async function detectTools() {
  const [ffmpeg, ytdlp, whisperPy, mlxWhisper, whisperCpp, npx, node] = await Promise.all([
    which('ffmpeg'), which('yt-dlp'), which('whisper'), which('mlx_whisper'), which('whisper-cli'), which('npx'), which('node'),
  ]);
  const ver = async (cmd, args) => (cmd ? firstLine((await run(cmd, args, { timeoutMs: 8000 })).out) : '');

  const tools = [];
  tools.push({
    id: 'ffmpeg', name: 'FFmpeg', installed: !!ffmpeg, path: ffmpeg,
    version: (await ver(ffmpeg, ['-version'])).replace(/^ffmpeg version /, '').split(' ')[0],
    use: 'Cleans the voice to studio loudness and converts files.',
    install: 'brew install ffmpeg',
  });
  tools.push({
    id: 'ytdlp', name: 'yt-dlp', installed: !!ytdlp, path: ytdlp,
    version: await ver(ytdlp, ['--version']),
    use: 'Downloads a reference video from a link into ReelCraft.',
    install: 'brew install yt-dlp',
  });
  const wh = mlxWhisper || whisperPy;
  tools.push({
    id: 'whisper', name: 'Whisper', installed: !!wh, path: wh || whisperCpp,
    version: wh ? (mlxWhisper ? 'mlx-whisper' : 'openai-whisper') : (whisperCpp ? 'whisper.cpp found (not used yet)' : ''),
    use: 'Transcribes on the Mac with larger models than the browser can run. Without it, ReelCraft still transcribes in the browser.',
    install: 'pip3 install -U openai-whisper',
  });
  tools.push({
    id: 'remotion', name: 'Remotion', installed: !!npx, path: npx,
    version: npx ? 'runs through npx inside a Remotion project folder' : '',
    use: 'Opens or renders a Remotion project (e.g. a 4K reel project folder).',
    install: 'Install Node.js 22 or newer from nodejs.org',
  });
  let hfVersion = '';
  if (npx && fs.existsSync(path.join(HOME, '.hyperframes'))) hfVersion = 'set up on this Mac';
  tools.push({
    id: 'hyperframes', name: 'HyperFrames', installed: !!npx && !!ffmpeg, path: npx,
    version: hfVersion || (npx ? 'runs through npx inside a HyperFrames project folder' : ''),
    use: 'Opens or renders an HTML-based HyperFrames video project.',
    install: 'Needs Node.js 22 or newer and FFmpeg',
  });
  return { tools, node: node ? await ver(node, ['-v']) : process.version };
}

async function ytdlpJob(url, log) {
  if (!/^https?:\/\//i.test(url)) throw new Error('That does not look like a link.');
  const bin = await which('yt-dlp');
  if (!bin) throw new Error('yt-dlp is not installed. In Terminal: brew install yt-dlp');
  const dir = path.join(config.outputDir, 'Downloads');
  await fsp.mkdir(dir, { recursive: true });
  const before = new Set(await fsp.readdir(dir));
  const r = await run(bin, [
    '--no-playlist', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4',
    '--restrict-filenames', '-o', path.join(dir, '%(title).80s-%(id)s.%(ext)s'), url,
  ], { onLine: log });
  if (r.code !== 0) throw new Error(firstLine(r.out.split('\n').filter((l) => /ERROR/.test(l)).join('\n')) || 'Download failed.');
  const added = (await fsp.readdir(dir)).filter((f) => !before.has(f) && kindOf(f));
  if (!added.length) throw new Error('Nothing was downloaded (the file may already be in the Downloads folder).');
  const file = path.join(dir, added[0]);
  return { path: file, name: added[0], kind: kindOf(file) };
}

async function saveUpload(req, name) {
  const dir = path.join(config.outputDir, 'Work');
  await fsp.mkdir(dir, { recursive: true });
  const safe = String(name || 'upload.bin').replace(/[^\w.\-]+/g, '_').slice(-80);
  const file = path.join(dir, `${Date.now()}-${safe}`);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(file);
    req.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    req.on('error', reject);
  });
  return file;
}

async function voiceJob(input, log) {
  const bin = await which('ffmpeg');
  if (!bin) throw new Error('FFmpeg is not installed. In Terminal: brew install ffmpeg');
  const out = input.replace(/\.[^.]+$/, '') + '-voice.wav';
  // High-pass the rumble, light broadband denoise, gentle compression, then
  // loudness-normalise to the level short-form platforms expect.
  const chain = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,loudnorm=I=-14:TP=-1.5:LRA=11';
  const r = await run(bin, ['-y', '-i', input, '-vn', '-af', chain, '-ar', '48000', '-ac', '1', out], { onLine: log });
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error('FFmpeg could not process that file.');
  return { path: out, name: path.basename(out), kind: 'audio' };
}

async function whisperJob(input, { language = '', task = 'transcribe', model = 'small' }, log) {
  const mlx = await which('mlx_whisper');
  const py = await which('whisper');
  const bin = mlx || py;
  if (!bin) throw new Error('Whisper is not installed on this Mac. In Terminal: pip3 install -U openai-whisper');
  const dir = path.dirname(input);
  const args = [input, '--task', task === 'translate' ? 'translate' : 'transcribe', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', dir];
  if (mlx) args.push('--model', `mlx-community/whisper-${model}-mlx`);
  else args.push('--model', model);
  if (language) args.push('--language', language);
  const r = await run(bin, args, { onLine: log });
  const jsonFile = path.join(dir, path.basename(input).replace(/\.[^.]+$/, '') + '.json');
  if (r.code !== 0 || !fs.existsSync(jsonFile)) throw new Error('Whisper did not produce a transcript.');
  const data = JSON.parse(await fsp.readFile(jsonFile, 'utf8'));
  const words = [];
  for (const seg of data.segments || []) {
    for (const w of seg.words || []) {
      const text = String(w.word || '').trim();
      if (text) words.push({ text, start: +w.start, end: +w.end });
    }
  }
  if (!words.length) throw new Error('No speech found.');
  return { words, language: data.language || language };
}

// Fixed command templates for the two render tools. `dir` must be an existing
// project folder; nothing from the request is passed through a shell.
async function projectJob(tool, action, dir, opts, log) {
  const npx = await which('npx');
  if (!npx) throw new Error('Node.js is not installed.');
  let st;
  try { st = await fsp.stat(dir); } catch { st = null; }
  if (!st?.isDirectory()) throw new Error('That project folder does not exist.');
  const clean = (v, fallback) => (/^[\w.\-]{1,80}$/.test(String(v || '')) ? String(v) : fallback);
  let args;
  if (tool === 'remotion') {
    if (!fs.existsSync(path.join(dir, 'package.json'))) throw new Error('No package.json in that folder — is it a Remotion project?');
    args = action === 'studio'
      ? ['remotion', 'studio']
      : ['remotion', 'render', clean(opts.composition, 'Main'), path.join('out', clean(opts.output, 'reelcraft-render.mp4'))];
  } else if (tool === 'hyperframes') {
    args = action === 'studio'
      ? ['hyperframes', 'preview']
      : ['hyperframes', 'render', '--quality', opts.quality === 'draft' ? 'draft' : 'high', '--output', clean(opts.output, 'reelcraft-render.mp4')];
  } else throw new Error('Unknown tool.');
  log(`$ npx ${args.join(' ')}   (in ${dir})`);
  if (action === 'studio') {
    // Long-running preview server: start it and report, do not wait for exit.
    const child = spawn(npx, args, { cwd: dir, env: ENV, detached: true, stdio: 'ignore' });
    child.unref();
    return { started: true, note: 'Preview is starting in the background; it opens in your browser when ready.' };
  }
  const r = await run(npx, args, { cwd: dir, onLine: log });
  if (r.code !== 0) throw new Error('Render failed — see the log.');
  return { finished: true };
}

async function listLibrary() {
  const out = [];
  for (const root of libraryRoots()) {
    const items = [];
    const walk = async (dir, depth) => {
      if (depth > 4 || items.length >= 1500) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else {
          const kind = kindOf(e.name);
          if (!kind) continue;
          let size = 0;
          try { size = (await fsp.stat(full)).size; } catch { /* unreadable */ }
          items.push({ name: e.name, kind, size, path: full, folder: path.relative(root, dir) || '' });
          if (items.length >= 1500) return;
        }
      }
    };
    await walk(root, 0);
    out.push({ root, name: path.basename(root).trim(), items, truncated: items.length >= 1500 });
  }
  return out;
}

/* ---------------------------------------------------------------- server */

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readJson = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
});

function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : 0;
    const end = range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.test(origin)) return json(res, 403, { error: 'Not allowed from this page.' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /api/health') return json(res, 200, { ok: true, version: 1 });
    if (route === 'GET /api/tools') return json(res, 200, await detectTools());
    if (route === 'GET /api/config') return json(res, 200, { ...config, activeLibraryDirs: libraryRoots() });
    if (route === 'POST /api/config') {
      const body = await readJson(req);
      if (Array.isArray(body.libraryDirs)) config.libraryDirs = body.libraryDirs.map(String).slice(0, 12);
      if (typeof body.outputDir === 'string' && body.outputDir) config.outputDir = body.outputDir;
      saveConfig(config);
      return json(res, 200, { ...config, activeLibraryDirs: libraryRoots() });
    }
    if (route === 'GET /api/library') return json(res, 200, { libraries: await listLibrary() });
    if (route === 'GET /api/file') {
      const file = allowedPath(url.searchParams.get('path') || '');
      if (!file || !fs.statSync(file).isFile()) return json(res, 404, { error: 'File not available.' });
      return serveFile(req, res, file);
    }
    if (route === 'POST /api/ytdlp') {
      const { url: link } = await readJson(req);
      return json(res, 200, startJob('Download reference video', (log) => ytdlpJob(String(link || ''), log)));
    }
    if (route === 'POST /api/voice') {
      const file = await saveUpload(req, decodeURIComponent(req.headers['x-file-name'] || 'input.mp4'));
      return json(res, 200, startJob('Studio voice', (log) => voiceJob(file, log)));
    }
    if (route === 'POST /api/whisper') {
      const file = await saveUpload(req, decodeURIComponent(req.headers['x-file-name'] || 'input.mp4'));
      const opts = { language: url.searchParams.get('language') || '', task: url.searchParams.get('task') || 'transcribe', model: url.searchParams.get('model') || 'small' };
      if (!/^[\w.\-]{1,24}$/.test(opts.model)) opts.model = 'small';
      if (!/^[a-z]{0,3}$/.test(opts.language)) opts.language = '';
      return json(res, 200, startJob('Transcribe on this Mac', (log) => whisperJob(file, opts, log)));
    }
    if (route === 'POST /api/project') {
      const body = await readJson(req);
      const action = body.action === 'studio' ? 'studio' : 'render';
      return json(res, 200, startJob(`${body.tool} ${action}`, (log) => projectJob(String(body.tool), action, String(body.dir || ''), body, log)));
    }
    const jm = /^\/api\/jobs\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && jm) {
      const job = jobs.get(jm[1]);
      return job ? json(res, 200, { ...job, log: job.log.slice(-40) }) : json(res, 404, { error: 'No such job.' });
    }
    return json(res, 404, { error: 'Unknown request.' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ReelCraft helper ready on http://127.0.0.1:${PORT}`);
});
