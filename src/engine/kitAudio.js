// Signature-style audio: real desk sounds and recorded-style music beds from
// the brand kit, instead of the synthesised whooshes and pad.
//
// The rule (from the signature-reel playbook): every sound is something
// that happens on a desk, one per graphic, landing on the frame the graphic
// appears. No whooshes, risers or impacts.
import { nanoid } from 'nanoid';
import { useEditor } from '../store/editorStore.js';
import { probeFile } from './media.js';

const SR = 44100;
const SFX = '/kit/audio/sfx/';
const MUSIC = '/kit/audio/music/';

// Takes that measured clean and audible. The near-silent ones are left out.
const TAKES = {
  paper_place: ['sfx01_paper_place_a', 'sfx01_paper_place_b'],
  print_drop: ['sfx03_print_drop_a', 'sfx03_print_drop_c'],
  pen_circle: ['sfx04_pen_circle_b', 'sfx04_pen_circle_a'],
  pen_underline: ['sfx05_pen_underline_c', 'sfx05_pen_underline_d'],
  pen_tick: ['sfx06_pen_tick_c'],
  pen_strike: ['sfx07_pen_strike_c', 'sfx07_pen_strike_d'],
  seal_press: ['sfx08_seal_press_a', 'sfx08_seal_press_d'],
  book_close: ['sfx12_book_close_a', 'sfx12_book_close_d'],
};

// Which desk sound goes with which graphic.
const SOUND_FOR = {
  'premium-scene': {
    'number-impact': 'pen_circle',
    'problem-alert': 'pen_strike',
    'solution-reveal': 'seal_press',
    'process-steps': 'pen_tick',
    'kinetic-caption': 'pen_underline',
    'hook-punch': 'pen_underline',
    'fullscreen-broll': 'print_drop',
    'split-screen': 'print_drop',
    'floating-cards': 'print_drop',
    'premium-cta': 'book_close',
  },
  card: 'print_drop',
  cards: 'print_drop',
  collage: 'print_drop',
  document: 'paper_place',
  pip: 'print_drop',
};

function soundFor(clip) {
  const m = SOUND_FOR[clip.kind];
  if (!m) return null;
  if (typeof m === 'string') return m;
  return m[clip.sceneType] || 'paper_place';
}

function encodeWav(buffer) {
  const d = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + d.length * 2);
  const v = new DataView(out);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, d.length * 2, true);
  let o = 44;
  for (let i = 0; i < d.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** One desk sound per graphic on the overlay track. Replaces any earlier pass. */
export async function addDeskSfx(intensity = 1) {
  const st = useEditor.getState();
  const duration = st.duration();
  const len = Math.max(1, Math.ceil(Number.isFinite(duration) && duration > 0 ? duration : 1));
  const cues = [];
  for (const track of st.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const clip of track.clips) {
      const sound = soundFor(clip);
      if (sound && clip.start < duration - 0.1) cues.push({ at: Math.max(0, clip.start - 0.04), sound });
    }
  }
  cues.sort((a, b) => a.at - b.at);
  if (!cues.length) return { sounds: 0, note: 'No graphics on the timeline yet, so no desk sounds were placed.' };

  const ctx = new OfflineAudioContext(1, SR * len, SR);
  const cache = new Map();
  const load = async (name) => {
    if (!cache.has(name)) {
      const res = await fetch(`${SFX}${name}.mp3`);
      if (!res.ok) throw new Error(`Desk sound missing: ${name}`);
      cache.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    }
    return cache.get(name);
  };

  const used = {};
  let placed = 0;
  let last = -1;
  for (const cue of cues) {
    // Never two sounds on top of each other.
    if (cue.at - last < 0.35) continue;
    const takes = TAKES[cue.sound];
    // Rotate takes so a repeated event never sounds identical twice in a row.
    const n = (used[cue.sound] = (used[cue.sound] ?? -1) + 1);
    const buf = await load(takes[n % takes.length]);
    // Normalise each take to the same peak, then set it under the voice.
    const data = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 8) peak = Math.max(peak, Math.abs(data[i]));
    const pen = cue.sound.startsWith('pen_');
    const target = (pen ? 0.16 : 0.25) * Math.max(0.3, Math.min(1.5, intensity));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = peak > 0.001 ? Math.min(6, target / peak) : 1;
    src.connect(gain).connect(ctx.destination);
    src.start(cue.at);
    last = cue.at;
    placed++;
  }

  const rendered = await ctx.startRendering();
  const blob = new Blob([encodeWav(rendered)], { type: 'audio/wav' });
  useEditor.getState().addAudioBed({
    id: nanoid(8), name: 'Sound design — desk sounds', type: 'audio',
    url: URL.createObjectURL(blob),
    file: new File([blob], 'desk-sfx.wav', { type: 'audio/wav' }),
    thumb: null, duration: len, width: 0, height: 0,
  }, 'sfx');
  return { sounds: placed, duration: len };
}

/** Lay a kit music bed under the voice. Replaces any earlier music bed. */
export async function addKitMusic(file = 'mus01_signature_calm', level = 0.14) {
  const res = await fetch(`${MUSIC}${file}.mp3`);
  if (!res.ok) throw new Error(`Music bed missing: ${file}`);
  const blob = await res.blob();
  const asset = await probeFile(new File([blob], `${file}.mp3`, { type: 'audio/mpeg' }));
  const total = useEditor.getState().duration();
  asset.name = `Music bed — ${file.replace(/^mus\d+_/, '').replace(/_/g, ' ')}`;
  useEditor.getState().addAudioBed({ ...asset, duration: Math.min(asset.duration || total, Math.max(total, 1)) }, 'music');
  // addAudioBed sets a generic level; the Signature bed sits well under speech.
  const st = useEditor.getState();
  const track = st.tracks.find((t) => t.kind === 'audio');
  const clip = track?.clips.find((c) => c.bed === 'music');
  if (track && clip) st.updateClip(track.id, clip.id, { volume: level });
  return { bed: file, level };
}
