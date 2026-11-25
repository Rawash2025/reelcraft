import { useEditor } from '../store/editorStore.js';
import { toolDefs, runTool } from './tools.js';
import { packById } from './stylePacks.js';
import { sendTurn } from './providers.js';

const SYSTEM = `You are the editor on a short-form video team. You cut vertical
social video — the fast, caption-led kind that has to hold someone in the first
second and never give them a reason to leave.

You work by calling the editing tools available to you. You are operating a real
timeline: every call changes what the viewer will see, and the user is watching
the preview update as you work.

How you edit:

- Look before you cut. Call get_project first. Read the transcript — it tells you
  what the video is actually about, and that determines every choice after it.
- Pace is the whole job. Dead air is where people leave. Use analyze_speech to
  see what is there, then remove_silences. Judge the numbers: if there is almost
  nothing to remove, say so and leave the take alone rather than cutting for the
  sake of it.
- Emphasise the words that carry the claim — numbers, outcomes, the turn in the
  argument. Six to twelve words in a short video, not thirty; the accent stops
  meaning anything if half the script is coloured. Only pass words that appear
  in the transcript verbatim.
- Motion is punctuation. A punch-in on alternating cuts keeps a talking head
  alive. Punching every cut in a calm explainer is noise.
- If the user gave you a hook line, put it on screen over the opening. If they
  did not, and the video would clearly benefit, write one from the transcript
  and add it — short, concrete, no clickbait the video does not pay off.

Work in one continuous pass — chain the tool calls without stopping to ask
permission between them. Everything you do is undoable, so prefer acting over
checking in. Stop and ask only if the project is empty or the request is
genuinely ambiguous.

When you are done, write three or four sentences: what you changed and why you
made the calls you made. Name the actual numbers — how many cuts, how much time
came out. No preamble, no bullet lists, no restating these instructions.`;

/**
 * Run the director against whichever model is configured.
 *
 * `history` is a neutral transcript (see providers.js), not a provider-shaped
 * message array — so switching provider between runs does not corrupt it.
 *
 * onEvent receives: {type:'text'|'tool'|'result'|'error'|'done', ...}
 */
export async function direct({
  cfg,
  instruction,
  packId,
  history = [],
  onEvent = () => {},
  signal,
}) {
  if (!cfg?.provider) throw new Error('Choose a model provider first.');
  if (cfg.provider !== 'custom' && !cfg.apiKey)
    throw new Error('Add an API key for this provider.');

  const pack = packById(packId);
  const summary = useEditor.getState().summary();

  const brief = [
    `Style brief — ${pack.name}: ${pack.brief}`,
    ``,
    `Project state at the start of this turn:`,
    JSON.stringify(summary, null, 1),
    ``,
    `What the user asked for: ${instruction}`,
  ].join('\n');

  const turns = [...history, { role: 'user', content: brief }];
  const tools = toolDefs();
  let guard = 0;

  while (guard++ < 24) {
    if (signal?.aborted) return { turns, stopped: true };

    let reply;
    try {
      reply = await sendTurn({
        cfg,
        apiKey: cfg.apiKey,
        system: SYSTEM,
        turns,
        tools,
        onText: (t) => onEvent({ type: 'text', text: t }),
        signal,
      });
    } catch (e) {
      const msg = readableError(e, cfg);
      onEvent({ type: 'error', text: msg });
      throw new Error(msg);
    }

    // Anthropic can decline via a safety classifier. Surface it, do not retry.
    if (reply.stopReason === 'refusal') {
      onEvent({
        type: 'error',
        text: `The model declined this request (${reply.refusalCategory ?? 'unspecified'}).`,
      });
      return { turns, refused: true };
    }

    turns.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls });

    if (!reply.toolCalls?.length) {
      onEvent({ type: 'done' });
      return { turns };
    }

    const results = [];
    for (const call of reply.toolCalls) {
      if (!call.name) continue;
      onEvent({ type: 'tool', name: call.name, input: call.input });
      try {
        const out = await runTool(call.name, call.input);
        onEvent({ type: 'result', name: call.name, output: out });
        results.push({ id: call.id, name: call.name, output: out });
      } catch (e) {
        // Hand the failure back so the model can adapt instead of stalling.
        onEvent({ type: 'result', name: call.name, error: e.message });
        results.push({ id: call.id, name: call.name, output: e.message, isError: true });
      }
    }
    turns.push({ role: 'results', results });
  }

  onEvent({ type: 'error', text: 'Stopped after 24 steps to avoid running away.' });
  return { turns, exhausted: true };
}

function readableError(e, cfg) {
  const raw = String(e?.message || e);
  if (e?.status === 401 || /401|unauthor|invalid.*api.?key/i.test(raw))
    return 'That API key was rejected. Check the key and the selected provider.';
  if (e?.status === 429 || /429|rate.?limit/i.test(raw))
    return 'Rate limited — wait a moment and retry.';
  if (/credit|quota|billing|insufficient/i.test(raw))
    return 'The account has no credit or quota left for this provider.';
  if (e?.status === 404 || /model.*not.*found|unknown model/i.test(raw))
    return `That provider does not serve "${cfg?.model}". Pick a different model name.`;
  if (e?.name === 'AbortError') return 'Stopped.';
  if (/failed to fetch|networkerror|load failed/i.test(raw))
    return cfg?.provider === 'custom'
      ? 'Could not reach that base URL. For a local server, allow this origin in its CORS settings.'
      : 'Could not reach the API — network, CORS, or an ad blocker.';
  return raw.slice(0, 220);
}
