import { nanoid } from 'nanoid';

const kindOf = (file) =>
  file.type.startsWith('video')
    ? 'video'
    : file.type.startsWith('audio')
      ? 'audio'
      : 'image';

export async function probeFile(file) {
  const url = URL.createObjectURL(file);
  const type = kindOf(file);
  const meta = await new Promise((resolve, reject) => {
    if (type === 'image') {
      const img = new Image();
      img.onload = () =>
        resolve({ duration: 5, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = url;
      return;
    }
    const el = document.createElement(type === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.onloadedmetadata = () =>
      resolve({
        duration: isFinite(el.duration) ? el.duration : 0,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      });
    el.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    el.src = url;
  });

  return {
    id: nanoid(8),
    name: file.name,
    type,
    url,
    file,
    thumb: null,
    ...meta,
  };
}

// Grab a poster frame ~10% in, used for the media bin and timeline thumbs.
export async function makeThumb(asset) {
  if (asset.type === 'audio') return null;
  if (asset.type === 'image') return asset.url;
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.src = asset.url;
    v.muted = true;
    v.crossOrigin = 'anonymous';
    const grab = () => {
      const c = document.createElement('canvas');
      const w = 160;
      c.width = w;
      c.height = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    v.onseeked = grab;
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1 * (v.duration || 1), 1);
      } catch {
        grab();
      }
    };
    v.onerror = () => resolve(null);
  });
}

// One media element per asset, reused by preview and export.
export class MediaPool {
  constructor() {
    this.map = {};
  }
  ensure(asset) {
    if (this.map[asset.id]) return this.map[asset.id];
    let el;
    if (asset.type === 'image') {
      el = new Image();
      el.src = asset.url;
    } else {
      el = document.createElement(asset.type === 'audio' ? 'audio' : 'video');
      el.src = asset.url;
      el.preload = 'auto';
      el.playsInline = true;
      el.crossOrigin = 'anonymous';
    }
    this.map[asset.id] = el;
    return el;
  }
  sync(assets) {
    assets.forEach((a) => this.ensure(a));
    return this.map;
  }
  get(id) {
    return this.map[id];
  }
  pauseAll() {
    Object.values(this.map).forEach((el) => {
      if (el.pause) el.pause();
    });
  }
}
