# ReelCraft

**An open-source, browser-based editor for short-form talking-head video, built for bilingual English/Arabic creators and small businesses.**

Drop in a video, pick a look, approve the preview, export. ReelCraft cuts the pauses, transcribes and captions the speech (word by word, including Arabic and right-to-left text), adds motion, b-roll and premium graphic scenes, and renders a finished 9:16 reel to MP4. The full timeline editor is always one click away.

Everything runs locally in the browser. No account is required: transcription uses Whisper in the browser, export uses a local canvas renderer, and the optional AI pilot works with any provider, including Ollama running on your own machine.

## Quick start

```bash
git clone https://github.com/Rawash2025/reelcraft.git
cd reelcraft
npm install
npm start          # editor + local helper, opens http://localhost:5173
# or: npm run dev  # editor only
```

Optional: copy `.env.example` to `.env.local` and add a free [Pexels](https://www.pexels.com/api/) key for stock b-roll.

## What is where

- **Home**: add a video, pick a look (Signature is the default), build, check, export.
- **Editor**: the full editor: timeline, panels, Pilot, Director.
- **Library**: your brand kit (`public/kit/manifest.json`) and a local materials folder (`~/Movies/ReelCraft Materials` by default, read through the helper; add more folders on that page).
- **Tools**: FFmpeg, yt-dlp, Whisper, Remotion and HyperFrames, run by the local helper in `server/helper.mjs` (install the ones you want on your machine).
- **Playbooks**: your own brand rules as markdown (`public/playbooks/`).

The repository ships code only. The brand asset kit (wall textures, props, desk sound effects, music beds) is not included; add your own files under `public/kit/` and list them in `public/kit/manifest.json`. Steps that need a missing asset are skipped, not fatal.

## Contributing

Issues and pull requests are welcome, especially new style packs, caption styles, premium scenes and better Arabic/RTL handling.

## License

[MIT](LICENSE)

---


A browser-based video editor: timeline editing, one-click design templates,
animated word-by-word captions, and a real render out to MP4.

## Running it for free

Nothing here requires a paid account:

| Feature | Free option |
|---|---|
| Editing, cuts, captions, graphics, b-roll frames | Always local |
| Auto-captions | Whisper in the browser — no key |
| Export | The local canvas exporter — no key, and higher fidelity than cloud |
| B-roll | Pexels API — free tier |
| AI pilot | Gemini or Groq free tier, or Ollama locally with no account at all |

Paid services are alternatives, never requirements. Cloud rendering and the
hosted speech APIs buy speed, not capability.

### Pilot with no account, ever

```bash
ollama pull qwen2.5
OLLAMA_ORIGINS="*" ollama serve
```

Then in the Pilot tab pick **Custom / local**, base URL `http://localhost:11434/v1`,
model `qwen2.5`, and leave the key blank. `OLLAMA_ORIGINS` matters — without it
the browser blocks the request.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. Nothing is uploaded anywhere — every file stays in
the browser tab.

## The Pilot

Two ways to get an edit built for you. Both drive the *same* tool surface
(`src/agent/tools.js`), so they produce the same kind of result and anything
either one does is a normal, undoable edit you can keep working on.

**Auto-edit — no API key, no network.** Pick a style pack, press the button. It
analyses the audio, cuts the pauses, remaps the caption timings through the
cut, styles the captions, highlights the payoff words, sets the framing moves
and the grade, and beat-locks the cuts if there is music. Entirely local DSP.

**AI pilot — any model provider, your key.** The same tools, driven with
judgment: it reads the transcript, decides how hard to cut, chooses which words
carry the claim, writes a hook if the video needs one, and explains what it did.
The key is stored in `localStorage` and sent straight to the provider you pick.

| Provider | Notes |
|---|---|
| Anthropic (Claude) | Streams token by token |
| OpenAI | |
| Google Gemini | |
| OpenRouter | One key, most models |
| Groq | |
| Custom / local | Any OpenAI-compatible server — Ollama, LM Studio, vLLM, LiteLLM |

Providers disagree about how tool calling is shaped, so the director keeps a
neutral transcript and each adapter converts it on the way out. That means
switching provider between runs does not corrupt the history. Only Anthropic
streams; the others deliver each turn complete. Model ids in the picker are
defaults, not promises — type whatever your provider currently serves.

### Style packs

| Pack | Cut | Captions | Motion |
|---|---|---|---|
| Creator fast-cut | Hard (0.18s) | 3 words, bold pop | Punch on alternating cuts |
| Podcast pull-quote | Gentle (0.32s) | 2 words, heavy stroke | Slow push |
| Tutorial | Light (0.45s) | 6 words, minimal | None |
| Hype montage | Aggressive (0.16s) | 3 words, neon | Punch every cut |
| Story voiceover | Gentle (0.4s) | 4 words, typewriter | Ken Burns drift |

### The pilot's tools

`get_project`, `analyze_speech`, `remove_silences`, `analyze_music`,
`snap_cuts_to_beats`, `set_template`, `set_caption_style`, `emphasize_words`,
`set_motion`, `add_text_overlay`, `set_grade`, `set_accent`, `trim_to_range`,
`set_captions_from_script`.

## Non-English captions — measured results

Whisper's `translate` task turns speech in any language into English captions in
one pass, so the English keeps the timing of the original speech. Tested against
known Arabic input, the results were mixed and the defaults here reflect that:

| Setting | Arabic transcription | English translation |
|---|---|---|
| No language code | **Nonsense** — misdetected the language entirely | Nonsense |
| `ar` + Base | Word boundaries mangled | Unusable |
| `ar` + Small | **Accurate** | Gets the gist; misreads ambiguous words |

Two things follow, and both are now the defaults:

1. **Always set the language code** for non-English speech. This mattered more
   than model size — left blank, Whisper misdetected Arabic and returned text
   with no relation to what was said.
2. **Small is the floor** for anything but English.

Even at Small, translation renders ambiguous words wrong — حساب became
"calculation" rather than "account". Treat translated captions as a draft and
fix them in Captions → Edit words. Transcription in the original language is
markedly more reliable than translation.

## Finish, sound design and graphics

### Premium scene system

The Templates panel now includes 15 parameterised premium scenes: Hook Punch,
Kinetic Caption, Text Behind Person, Floating Cards, Bank Comparison, Number
Impact, Problem Alert, Solution Reveal, Full-screen B-roll, Split Screen,
Phone/UI Demo, Logo Orbit, Process Steps, Testimonial and Premium CTA.

Each scene is one editable clip on the **Text & graphics** track. Select it on
the timeline to change copy, emphasis, values, labels, media, timing and whether
it temporarily replaces the running captions. The selected brand token
set supplies the olive, gold, cream, type, radius and CTA defaults.

The **Premium Kinetic Reel** Auto Edit pack and the Director both choose from
this same library based on sentence intent. They cannot invent arbitrary
layouts: hooks, comparisons, statistics, warnings, steps, benefits and CTAs map
to controlled compositions. Depth scenes share the person mask with
behind-person B-roll, so their back pass is drawn over the original room, the
isolated speaker is composited next, and foreground cards finish the shot.

**Finishing pass** — vignette, film grain, bloom, optional letterbox. Grain is
drawn from four pre-rendered noise tiles cycled and offset per frame; generating
noise per frame at 1080x1920 would be far too slow. This is the cheapest large
gain in perceived production value in the whole app.

**Sound design** — a whoosh through every cut, and a riser plus impact under the
hook. All synthesised at render time from noise and oscillators, so there is
nothing to license and no attribution to carry. The bed renders to one WAV and
drops on the music track, which means playback and export pick it up with no
special handling.

**Backing bed** — a quiet original bed (sub pulse, soft pad, off-beat ticks).
Deliberately plain: it removes silence rather than carrying the video. Drop a
real track on the Music track when you have one.

## Graphics, b-roll and audio

**Icon card rows** — the step-sequence look: glass panels with an emoji and a
label, one lit at a time, assembling with a staggered entrance. The row places
itself above the caption band automatically, so it never lands on the words.

**Framed b-roll from Pexels** — search stock footage, drop it over the take in
a frame. `luxury` floats it with an accent glow and corner ticks, `soft` is
rounded and plain, `hard` is a sharp rectangle, `full` is a straight cutaway.
`auto_broll` reads the transcript, picks concrete search terms and spaces the
cutaways through the body. Clips are **downloaded as blobs, not linked** — a
cross-origin video would taint the canvas and silently break export. Each asset
carries its Pexels credit; attribute the creator when you post.

**Voice enhance** — a real chain rendered offline: high-pass, de-esser,
presence lift, air shelf, compressor, then a smoothed downward-expansion gate
and normalise. It reports **signal-to-noise before and after**, not the raw
noise floor: normalising adds makeup gain to everything, so a raw floor reading
rises after a successful clean-up and reads as though it got worse. A gate only
cleans the gaps between words — noise underneath speech is unchanged, and the
report says so.

**Whip transitions** — a blurred pan through every cut on the video track.

**Camera moves** — `alternate`, `punch`, `push`, `kenburns`, `parallax`.

### Layout bands

The three graphic layers stack without colliding: b-roll in the upper third,
cards in the middle, captions below. The card row recomputes its own position
from the live caption settings rather than trusting a fixed default.

## What works today

**Editing** — import video/audio/images, multi-track timeline (video, overlay
text, music), drag to move, drag the edges to trim, split at the playhead,
duplicate, delete, close gaps, per-clip speed (0.5×–2×), volume, opacity,
fade in/out, zoom and pan, cover/contain framing, nine colour grades.

**Templates** — eight looks that set aspect ratio, caption style, grade, accent
colour and caption placement in one click. Canvas presets for 9:16, 1:1, 4:5
and 16:9.

**Captions** — eight animated styles with the spoken word highlighted as it
lands (pop, karaoke fill, neon glow, boxed, typewriter, gradient rise and
more). Three ways to get them:

- *On this machine* — Whisper running inside the tab via WebGPU (falling back
  to WASM), in a worker so the UI stays responsive. **Free, no key, no
  account**, and the audio never leaves the machine. The model downloads once
  (~40 MB tiny / ~80 MB base / ~240 MB small) and the browser caches it.
- *Auto* — OpenAI Whisper or Deepgram Nova-2, if you would rather pay for speed
  and accuracy. Key stored in `localStorage`, sent only to that provider.
- *From script* — paste what is said and the words are distributed across the
  timeline by syllable weight. No key, no network.
- *Edit words* — click any word to jump the playhead there. Export SRT or VTT.

**Text** — six overlay presets (hero title, lower third, badge, statement,
note, outline pop) with font, fill, outline, size, position and entrance
animation.

**Export** — the composited canvas is captured live with the audio mixed in, so
the file matches the preview exactly. MP4 where the browser supports it,
WebM otherwise. Full / fast / draft scales at 24, 30 or 60 fps.

**Shortcuts** — `Space` play·pause, `S` split, `⌫` delete, `⌘Z`/`⇧⌘Z` undo·redo,
`←`/`→` nudge a frame (hold `⇧` for a second), `⌘D` duplicate, `Home` to start.

## How it is put together

```
src/agent/
  tools.js          the editor's capabilities as one table: JSON schema + the
                    function that performs the edit, so the two cannot drift
  autoDirector.js   the deterministic pass — no model in the loop
  director.js       the provider-agnostic tool-use loop (manual, abortable)
  providers.js      adapters for Anthropic / OpenAI-compatible / Gemini wire
                    formats, over one neutral transcript
  stylePacks.js     genre recipes + the emphasis-picking heuristic
src/engine/
  analyze.js        silence detection (adaptive RMS gate) and beat tracking
                    (spectral flux); both run offline in the browser
  audioFx.js        the voice chain — filters, gate, compressor, normalise
  layers.js         icon cards, framed b-roll, whip-pan maths
  pexels.js         stock search + blob download + transcript->search terms
  renderer.js       one drawFrame(ctx, time, state, media) — the single source
                    of truth for what a frame looks like, shared by the live
                    preview and the exporter, so WYSIWYG holds by construction
  playback.js       timeline clock; keeps every <video>/<audio> element on the
                    right frame, hard-seeking when drift passes 0.25s
  exporter.js       canvas.captureStream + MediaRecorder, plus an AudioMixer
                    that routes every source into one recordable stream
  transcribe.js     Whisper / Deepgram / syllable-weighted fallback, SRT + VTT
  captionStyles.js  caption presets, consumed by the renderer
  templates.js      one-click looks; filters.js  colour grades
  media.js          file probing, poster frames, the shared element pool
  asr.worker.js     Whisper in a worker — local, free transcription
  finish.js         vignette, grain, bloom, letterbox
  sfx.js            synthesised whooshes, impacts, risers and a music bed
  json2video.js     timeline -> cloud movie JSON (pure), upload, poll
src/store/editorStore.js   zustand state with undo/redo snapshots
src/components/            sidebar panels, preview, timeline, inspector
```

## Cloud rendering (JSON2Video)

The local exporter captures the canvas in real time — a 60s video takes 60s and
the tab must stay in front. Export → **Cloud** instead uploads the media the
timeline references, translates the project into a JSON2Video movie, renders it
server-side and hands back an MP4 URL. You can close the tab while it runs.

| Translates | Does not translate |
|---|---|
| Cuts, trims (`seek`), clip timing | Camera moves — punch, push, parallax |
| Framed b-roll, positioned to match | Whip-pan transitions |
| Text overlays | The luxury frame's glow and corner ticks |
| Word-highlight captions | |
| Card rows (re-drawn as HTML) | |

Word highlighting is the interesting part. JSON2Video only does per-word
highlighting on supplied captions when they are **ASS with per-word timing** —
SRT and VTT throw it away. `buildASS()` emits karaoke `\k` tags from the word
timings already in the project. Two details that bite: ASS colours are
`&HAABBGGRR`, byte-reversed from CSS hex; and in karaoke the *secondary* colour
is the not-yet-spoken state while the *primary* is the spoken one.

`buildMovie()` is a pure function — timeline in, JSON out — so the translation
can be checked without an API key and without spending render credits.

## Known limits

- The local exporter renders in real time (a 60s video takes ~60s) and needs
  the tab in front. Cloud rendering avoids both, at the cost of the canvas-only
  effects listed above. A local frame-accurate offline render would still need
  WebCodecs or ffmpeg.wasm.
- Auto-captions need an API key. Everything else runs with no account.
- `parallax` is a dolly-and-drift that reads as depth. It is **not** depth-map
  parallax — there is no per-pixel displacement, so it will not match a true
  3D-photo tool on a still image. Real depth needs a depth-estimation model,
  which is not wired in.
- B-roll composites over the main shot; there is still one main video layer, so
  clip-to-clip dissolves are not implemented (whip is a per-cut effect, not a
  true cross-dissolve).
