import {
  PREMIUM_SCENES,
  drawPremiumScene,
  sceneDefaults,
} from '../src/engine/premiumScenes.js';

if (PREMIUM_SCENES.length !== 15) {
  throw new Error(`Expected 15 premium scenes, found ${PREMIUM_SCENES.length}.`);
}

const ids = new Set(PREMIUM_SCENES.map((scene) => scene.id));
if (ids.size !== PREMIUM_SCENES.length) throw new Error('Premium scene ids must be unique.');

const gradient = { addColorStop() {} };
const state = {
  globalAlpha: 1,
  measureText: (value) => ({ width: String(value).length * 24 }),
  createLinearGradient: () => gradient,
};
const ctx = new Proxy(state, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});
const brand = {
  primary: '#5c6454', captionAccent: '#9aad00', text: '#ffffff', gold: '#d6b35a',
};

for (const scene of PREMIUM_SCENES) {
  const clip = {
    start: 0,
    duration: scene.duration,
    sceneType: scene.id,
    props: sceneDefaults(scene.id, brand),
  };
  drawPremiumScene(ctx, 1080, 1920, clip, 0.75, brand, {}, 'all');
}

console.log(`Premium scene validation passed: ${PREMIUM_SCENES.length}/15 rendered.`);
