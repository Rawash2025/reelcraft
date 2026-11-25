import { addDeskSfx, addKitMusic } from '../engine/kitAudio.js';
import { useEditor } from '../store/editorStore.js';
import { runTool } from './tools.js';
import { packById, pickEmphasis } from './stylePacks.js';
import { transcribeLocal } from '../engine/transcribe.js';
import { classifyTranscript } from '../director/classify.js';
import { makeHero, makeNumberHero } from '../engine/heroText.js';
import { initSegmenter } from '../engine/segment.js';
import { deriveMeta, matchProof, overlayForAsset } from '../director/assetMeta.js';
import { CARD_POS } from '../engine/overlays.js';

/**
 * The full edit with no model in the loop: transcribe, cut, style, frame,
 * grade, finish, and score. It drives the same tools the AI pilot uses, so
 * everything it does is a normal undoable edit.
 *
 * Order matters. Sound design and the music bed run last because they depend
 * on the final cut points and the final duration — generate them earlier and
 * the whooshes land where the cuts *used* to be.
 */
export async function autoDirect({
  packId,
  assetId,
  hook,
  transcribe = 'off',      // 'off' | 'transcribe' | 'translate'
  asrModel = 'Xenova/whisper-small',
  language = '',
  enhanceAudio = true,
  soundDesign = true,
  musicBed = null,          // null = follow the pack
  brollCount = 0,
  cards = null,
  onStep = () => {},
}) {
  const pack = packById(packId);
  const st = useEditor.getState();
  const asset =
    st.assets.find((a) => a.id === assetId) ||
    st.assets.find((a) => a.type === 'video') ||
    st.assets[0];
  if (!asset) throw new Error('Import a clip first.');

  const steps = [];
  const step = async (label, fn) => {
    onStep({ label, state: 'running' });
    try {
      const detail = await fn();
      steps.push({ label, detail });
      onStep({ label, state: 'done', detail });
      return detail;
    } catch (e) {
      steps.push({ label, error: e.message });
      onStep({ label, state: 'error', detail: e.message });
      return null;
    }
  };

  /* 1. Words first — everything downstream reads the transcript. */
  if (transcribe !== 'off' && !useEditor.getState().captions.words.length) {
    await step(
      transcribe === 'translate' ? 'Transcribing and translating to English' : 'Transcribing',
      async () => {
        const words = await transcribeLocal(asset.file, {
          model: asrModel,
          language: language || undefined,
          translate: transcribe === 'translate',
          onProgress: (p) => {
            const label =
              p.phase === 'download' && p.total
                ? `Downloading model ${Math.round((p.loaded / p.total) * 100)}%`
                : p.phase === 'transcribing'
                  ? 'Listening…'
                  : p.phase === 'fallback'
                    ? 'WebGPU unavailable — using CPU'
                    : 'Loading model…';
            onStep({ label, state: 'running' });
          },
        });
        if (!words.length) throw new Error('No speech detected.');
        useEditor.getState().setWords(words);
        return { words: words.length, english: transcribe === 'translate' };
      }
    );
  }

  /* 2. Look. */
  await step(`Look — ${pack.name}`, () => runTool('set_template', { template_id: pack.template }));
  if (pack.brand) await step('Brand system', () => useEditor.getState().setBrand(pack.brand));
  await step('Accent colour', () => runTool('set_accent', { hex: pack.accent }));

  /* 3. Pace. */
  if (asset.type !== 'image') {
    const analysis = await step('Listening for pauses', () =>
      runTool('analyze_speech', {
        asset_id: asset.id,
        min_silence: pack.silence.minSilence,
        sensitivity: pack.silence.sensitivity,
      })
    );
    if (analysis && analysis.seconds_removable > 0.35) {
      await step(`Cutting ${analysis.gaps} pauses (−${analysis.seconds_removable}s)`, () =>
        runTool('remove_silences', {
          asset_id: asset.id,
          min_silence: pack.silence.minSilence,
          padding: pack.silence.padding,
          sensitivity: pack.silence.sensitivity,
        })
      );
    } else {
      steps.push({ label: 'Pauses', detail: { note: 'Already tight — left alone.' } });
      onStep({ label: 'Take is already tight — no cuts needed', state: 'done' });
    }
  }

  /* 4. Captions. */
  await step('Caption style', () =>
    runTool('set_caption_style', {
      style_id: pack.captions.styleId,
      words_on_screen: pack.captions.groupSize,
      vertical_position: pack.captions.y,
      size: pack.captions.scale,
    })
  );

  const words = useEditor.getState().captions.words;
  if (words.length) {
    await step('Highlighting the payoff words', async () => {
      const picks = pickEmphasis(words, pack.emphasisRate);
      const r = await runTool('emphasize_words', { words: picks });
      return { ...r, words: picks.slice(0, 8) };
    });
    // Keyword icons on top of the emphasis, when the pack wants them.
    if (pack.icons !== false) {
      await step('Keyword icons', async () => {
        const n = useEditor.getState().addWordIcons({ onlyEmphasised: true, max: pack.iconMax ?? 5 });
        return { icons: n };
      });
    }
  }

  /* 4b. Hero typography — the reference signature. Small supporting line +
     one huge keyword on hooks; big-number treatment for figures. One hero word
     is placed behind the speaker when segmentation is available. */
  if (pack.hero && words.length) {
    await step('Hero typography', async () => {
      const sentences = classifyTranscript(words);
      let placed = 0;
      let behindOk = false;
      try { await initSegmenter(); behindOk = true; } catch { behindOk = false; }

      for (const sen of sentences) {
        const strong = sen.keywords[0];
        if (!strong) continue;
        // Keyword objects carry {text,index,score} but NO timing — the word's
        // real start comes from sen.words[index]. Using strong.start here was
        // undefined -> NaN duration, which poisoned the whole timeline.
        const kwWord = sen.words[strong.index] || sen.words[0];
        const kwStart = Number.isFinite(kwWord?.start) ? kwWord.start : sen.start;
        const senEnd = Number.isFinite(sen.end) ? sen.end : kwStart + 1.6;
        const isNumber = /\d/.test(strong.text) || sen.kind === 'NUMBER' || sen.kind === 'STATISTIC';

        if (placed >= Math.max(2, Math.round(useEditor.getState().duration() / 6))) break;

        if (isNumber) {
          const label = sen.text.replace(strong.text, '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
          useEditor.getState().addHero(makeNumberHero({
            value: strong.text.replace(/[^\d.,%$€kKmM]/g, '') || strong.text,
            label,
            start: kwStart,
            duration: Math.min(1.8, Math.max(0.8, senEnd - kwStart + 0.4)),
            y: 0.3,
          }));
          placed++;
        } else if (sen.kind === 'HOOK' || strong.score > 12) {
          const support = sen.words.map(w => w.text).find(t => t.toLowerCase() !== strong.text.toLowerCase() && t.length > 3);
          useEditor.getState().addHero(makeHero({
            phrase: sen.text.split(/\s+/).slice(0, 4).join(' '),
            keyword: strong.text,
            start: kwStart,
            duration: Math.min(1.8, Math.max(0.8, senEnd - kwStart + 0.3)),
            y: 0.3,
            behindWord: behindOk && support ? support : null,
            accentKeyword: sen.kind === 'CTA',
          }));
          placed++;
        }
      }
      return { heroes: placed, behindEnabled: behindOk };
    });
  }

  /* 4c. Premium scenes — whole compositions selected from sentence intent.
     The selector is deliberately bounded: it may choose from the scene
     library, but cannot invent arbitrary overlays or stack a scene on every
     line. That keeps the reel designed rather than effect-heavy. */
  if (pack.premiumScenes && words.length) {
    await step('Premium scene direction', async () => {
      const sentences = classifyTranscript(words);
      try { await initSegmenter(); } catch { /* depth scenes fall back to a flat pass */ }
      const limit = Math.max(3, Math.min(8, Math.round(useEditor.getState().duration() / 5)));
      let placed = 0;
      let lastAt = -99;
      for (const sen of sentences) {
        if (placed >= limit || sen.start - lastAt < 2.15) continue;
        const scene = premiumSceneForSentence(sen, placed);
        if (!scene) continue;
        useEditor.getState().addPremiumScene(scene.type, {
          start: sen.start,
          duration: Math.min(scene.maxDuration || 2.8, Math.max(1.15, sen.end - sen.start + .3)),
          props: scene.props,
        });
        placed++;
        lastAt = sen.start;
      }
      return { scenes: placed, library: 15 };
    });
  }

  /* 5. Camera, grade, finish. */
  if (pack.motion.pattern !== 'none') {
    await step(`Framing — ${pack.motion.pattern}`, () =>
      runTool('set_motion', { pattern: pack.motion.pattern, strength: pack.motion.strength })
    );
  }
  await step('Grade', () => runTool('set_grade', { filter_id: pack.grade }));

  if (pack.transition && pack.transition !== 'none') {
    await step(`Transitions — ${pack.transition}`, () =>
      runTool('set_transition', { kind: pack.transition })
    );
  }
  if (pack.finish && pack.finish !== 'none') {
    await step(`Finish — ${pack.finish}`, () => runTool('set_finish', { preset: pack.finish }));
  }

  /* 6. Graphics. */
  if (hook && hook.trim()) {
    await step('Hook card', () =>
      runTool('add_text_overlay', {
        text: hook.trim(),
        start: 0,
        duration: Math.min(2.4, useEditor.getState().duration()),
        position: 'top',
        size: 0.075,
        style: 'badge',
      })
    );
  }
  if (cards && cards.length >= 2) {
    await step('Graphic cards', () =>
      runTool('add_graphic_cards', {
        items: cards,
        start: Math.min(1.2, useEditor.getState().duration() * 0.15),
        duration: Math.min(3.2, useEditor.getState().duration() * 0.5),
        walk: true,
      })
    );
  }
  if (brollCount > 0) {
    await step(`Fetching ${brollCount} b-roll cutaway${brollCount > 1 ? 's' : ''}`, () =>
      runTool('auto_broll', { count: brollCount, frame: pack.brollFrame || 'luxury' })
    );
  }

  /* 6b. Proof overlays — the reference's signature support. Uses the user's
     OWN image assets (screenshots, client photos, documents): derive metadata,
     match to sentences, place cards / collage / document / pip. Places nothing
     when nothing matches confidently — never irrelevant proof. */
  if (pack.proof !== false) {
    await step('Proof overlays', async () => {
      const st2 = useEditor.getState();
      // Candidate proof images: imported images that are not b-roll or backgrounds.
      const imgs = st2.assets.filter((a) => a.type === 'image' && !a.credit && a.id !== st2.project.background_asset);
      if (!imgs.length) return { placed: 0, note: 'no proof images imported' };
      const metas = imgs.map((a) => deriveMeta(a));
      const sentences = classifyTranscript(useEditor.getState().captions.words);
      if (!sentences.length) return { placed: 0, note: 'no transcript' };

      const placements = matchProof(sentences, metas, { minConfidence: 0.26 });
      let placed = 0;
      // Group same-beat client photos into a collage when 3+ portrait photos match.
      const photoMatches = placements.filter((p) => p.type === 'photo' || p.type === 'testimonial');
      if (photoMatches.length >= 3) {
        const first = photoMatches[0];
        useEditor.getState().addCollage(photoMatches.slice(0, 4).map((p) => p.assetId), {
          layout: photoMatches.length >= 4 ? 'COLLAGE_4_CORNERS' : 'COLLAGE_3_AROUND_SUBJECT',
          start: first.sentence.start,
          duration: Math.min(2.4, first.sentence.end - first.sentence.start + 0.6),
        });
        placed++;
      } else {
        for (const pl of placements) {
          const meta = metas.find((m) => m.id === pl.assetId);
          const how = overlayForAsset(meta, pl.sentence);
          const start = pl.sentence.start;
          const duration = Math.min(2.2, pl.sentence.end - start + 0.4);
          if (how.overlay === 'document') useEditor.getState().addDocument(pl.assetId, { start, duration });
          else if (how.overlay === 'pip') useEditor.getState().addPIP(pl.assetId, { pos: how.pos, start, duration });
          else {
            const pos = CARD_POS[how.pos] || CARD_POS.SINGLE_LEFT;
            useEditor.getState().addCard(pl.assetId, { ...pos, anim: pos.x < 0.5 ? 'slide-left' : 'slide-right', start, duration, label: meta.type === 'screenshot' ? 'PROOF' : null });
          }
          placed++;
        }
      }
      return { placed, matched: placements.length, images: imgs.length };
    });
  }

  /* 7. Audio. Voice before beds so the beds are mixed under a clean take. */
  if (enhanceAudio && asset.type === 'video') {
    await step('Cleaning up the voice', () =>
      runTool('enhance_audio', { asset_id: asset.id, preset: pack.audio || 'podcast' })
    );
  }

  // These must be last: they read the final cut points and final duration.
  if (soundDesign && pack.sfx > 0 && pack.sfxKit === 'desk') {
    await step('Sound design — desk sounds', () => addDeskSfx(pack.sfx));
  } else if (soundDesign && pack.sfx > 0) {
    await step('Sound design — whooshes and impact', () =>
      runTool('add_sound_design', { intensity: pack.sfx, hook_at: hook?.trim() ? 0.35 : 0 })
    );
  }
  const wantMusic = musicBed == null ? pack.music : musicBed;
  if (wantMusic && !useEditor.getState().assets.some((a) => a.type === 'audio' && !a.name.includes('enhanced') && !a.name.includes('Sound design') && !a.name.includes('Music bed'))) {
    if (pack.musicFile) await step('Music bed', () => addKitMusic(pack.musicFile));
    else await step('Backing bed', () => runTool('add_music_bed', { bpm: 90, level: 0.14 }));
  }

  return { pack: pack.name, steps, duration: +useEditor.getState().duration().toFixed(2) };
}

function premiumSceneForSentence(sen, ordinal) {
  const keyword = sen.keywords?.[0]?.text || sen.words?.slice(-2).map((w) => w.text).join(' ') || '';
  const number = sen.keywords?.find((w) => /\d/.test(w.text))?.text || '';
  switch (sen.kind) {
    case 'HOOK':
      return { type: 'hook-punch', props: { text: sen.text, emphasis: keyword, eyebrow: 'BEFORE YOU DECIDE' }, maxDuration: 2.4 };
    case 'NUMBER':
    case 'STATISTIC':
      return { type: 'number-impact', props: { value: number || keyword, text: sen.text.replace(number || keyword, '').trim(), eyebrow: 'THE NUMBER TO KNOW' }, maxDuration: 2.4 };
    case 'WARNING':
    case 'PROBLEM':
      return { type: 'problem-alert', props: { text: sen.text, emphasis: keyword, eyebrow: 'COMMON MISTAKE' }, maxDuration: 2.4 };
    case 'COMPARISON':
      return { type: 'bank-comparison', props: { text: sen.text, leftLabel: 'OPTION A', leftValue: 'COMPARE', rightLabel: 'OPTION B', rightValue: 'COMPARE', footnote: 'Illustrative comparison — eligibility and terms vary.' }, maxDuration: 3 };
    case 'LIST':
    case 'STEPS':
      return { type: 'process-steps', props: { text: sen.text, steps: ['ASSESS', 'COMPARE', 'APPLY'] }, maxDuration: 3.2 };
    case 'BENEFIT':
      return { type: 'solution-reveal', props: { text: sen.text, emphasis: keyword, eyebrow: 'THE SMARTER OPTION' }, maxDuration: 2.5 };
    case 'BRAND':
      return { type: 'logo-orbit', props: { text: sen.text, labels: ['FAB', 'ADIB', 'DIB', 'ENBD', 'CBD'] }, maxDuration: 3 };
    case 'CTA':
      return { type: 'premium-cta', props: { text: sen.text, emphasis: keyword, eyebrow: 'YOUR BRAND', cta: 'APPLY NOW', url: 'yourwebsite.com' }, maxDuration: 3 };
    default:
      // One restrained depth beat in a longer explanation; the remaining body
      // copy stays in the running caption system.
      if (ordinal === 1 && sen.duration > 1.2) {
        return { type: 'kinetic-caption', props: { text: sen.text, emphasis: keyword }, maxDuration: 2.4 };
      }
      return null;
  }
}
