// One place that brings files into the project. Used by the Media panel, the
// Home flow, the Library and the Tools page so they all behave the same.
import { useEditor } from '../store/editorStore.js';
import { probeFile, makeThumb } from './media.js';
import { buildFaceTrack } from './faceCache.js';

export async function ingestFiles(files, { toTimeline = 'first', quiet = false } = {}) {
  const { addAssets, updateAsset, addToTimeline, notify } = useEditor.getState();
  const list = [...files].filter((f) => /^(video|audio|image)\//.test(f.type));
  if (!list.length) {
    notify('Only video, audio and image files', 'bad');
    return [];
  }
  const hadAssets = useEditor.getState().assets.length > 0;
  const probed = [];
  for (const f of list) {
    try {
      probed.push(await probeFile(f));
    } catch (e) {
      notify(e.message, 'bad');
    }
  }
  if (!probed.length) return [];
  addAssets(probed);
  // The first video lands straight on the timeline so there is something to
  // look at immediately.
  const firstVideo = probed.find((a) => a.type !== 'audio');
  if (firstVideo && toTimeline === 'first' && !hadAssets) addToTimeline(firstVideo.id);
  probed.forEach(async (a) => {
    const thumb = await makeThumb(a);
    if (thumb) updateAsset(a.id, { thumb });
  });
  // Face track in the background so face-aware reframing is ready by export.
  probed.filter((a) => a.type === 'video').forEach((a) => {
    buildFaceTrack(a, { fps: 6 }).catch(() => {});
  });
  if (!quiet) notify(`${probed.length} file${probed.length > 1 ? 's' : ''} added`, 'good');
  return probed;
}

/** Bring a file by URL (brand kit, helper output) into the project. */
export async function ingestUrl(url, name, opts) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${name || url}`);
  const blob = await res.blob();
  const file = new File([blob], name || url.split('/').pop(), { type: blob.type });
  return ingestFiles([file], opts);
}
