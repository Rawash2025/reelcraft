import Anthropic from '@anthropic-ai/sdk';

// The pilot talks to whatever model you point it at.
//
// Providers disagree about how tool calling is shaped, so the director keeps a
// neutral transcript and each adapter converts it on the way out. That also
// means you can switch provider mid-session without the history breaking.
//
// Neutral turn shapes:
//   { role: 'user',      content: string }
//   { role: 'assistant', text: string, toolCalls: [{ id, name, input }] }
//   { role: 'results',   results: [{ id, name, output, isError }] }

export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyHint: 'sk-ant-...',
    console: 'console.anthropic.com',
    streams: true,
  },
  openai: {
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    keyHint: 'sk-...',
    console: 'platform.openai.com/api-keys',
  },
  google: {
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    keyHint: 'AIza...',
    console: 'aistudio.google.com/apikey',
  },
  openrouter: {
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
    keyHint: 'sk-or-...',
    console: 'openrouter.ai/keys',
  },
  groq: {
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'qwen-2.5-32b'],
    keyHint: 'gsk_...',
    console: 'console.groq.com/keys',
  },
  custom: {
    name: 'Custom / local (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyHint: 'optional for local servers',
    console: 'Ollama, LM Studio, vLLM, LiteLLM…',
    needsBaseUrl: true,
  },
};

// Model ids move fast. These are defaults, not a promise — set the field to
// whatever your provider currently serves.
export const providerIds = () => Object.keys(PROVIDERS);

/* --------------------------------------------------------- schema shaping */

// Gemini rejects `additionalProperties`, and every provider dislikes an
// entirely empty parameter object in its own way.
function cleanSchema(schema, { dropAdditional }) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = Array.isArray(schema) ? [] : {};
  for (const [k, v] of Object.entries(schema)) {
    if (dropAdditional && k === 'additionalProperties') continue;
    out[k] = v && typeof v === 'object' ? cleanSchema(v, { dropAdditional }) : v;
  }
  return out;
}

const isEmptySchema = (s) => !s?.properties || !Object.keys(s.properties).length;

/* -------------------------------------------------------------- adapters */

const adapters = {
  /* ------------------------------------------------------------ anthropic */
  anthropic: {
    async send({ cfg, apiKey, system, turns, tools, onText, signal }) {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const messages = [];
      for (const t of turns) {
        if (t.role === 'user') messages.push({ role: 'user', content: t.content });
        else if (t.role === 'assistant') {
          const content = [];
          if (t.text) content.push({ type: 'text', text: t.text });
          for (const c of t.toolCalls || [])
            content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
          if (content.length) messages.push({ role: 'assistant', content });
        } else if (t.role === 'results') {
          messages.push({
            role: 'user',
            content: t.results.map((r) => ({
              type: 'tool_result',
              tool_use_id: r.id,
              content: r.isError ? `Error: ${r.output}` : JSON.stringify(r.output ?? { ok: true }),
              ...(r.isError ? { is_error: true } : {}),
            })),
          });
        }
      }

      const params = {
        model: cfg.model,
        max_tokens: 8000,
        system,
        thinking: { type: 'adaptive' },
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.schema,
        })),
        messages,
      };

      const stream = client.messages.stream(params, { signal });
      stream.on('text', (d) => onText(d));
      const msg = await stream.finalMessage();

      return {
        text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        toolCalls: msg.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input })),
        stopReason: msg.stop_reason,
        refusalCategory: msg.stop_details?.category,
      };
    },
  },

  /* ---------------------------------------------- openai-compatible (many) */
  openai: {
    async send({ cfg, apiKey, system, turns, tools, onText, signal }) {
      const messages = [{ role: 'system', content: system }];
      for (const t of turns) {
        if (t.role === 'user') messages.push({ role: 'user', content: t.content });
        else if (t.role === 'assistant') {
          const m = { role: 'assistant', content: t.text || null };
          if (t.toolCalls?.length)
            m.tool_calls = t.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
            }));
          messages.push(m);
        } else if (t.role === 'results') {
          for (const r of t.results)
            messages.push({
              role: 'tool',
              tool_call_id: r.id,
              content: r.isError ? `Error: ${r.output}` : JSON.stringify(r.output ?? { ok: true }),
            });
        }
      }

      // No token cap sent deliberately. Reasoning models on OpenAI reject
      // `max_tokens` and want `max_completion_tokens`, while several
      // OpenAI-compatible servers only understand `max_tokens` — omitting it
      // works everywhere and each server applies its own default.
      const body = {
        model: cfg.model,
        messages,
        tools: tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: isEmptySchema(t.schema)
              ? { type: 'object', properties: {} }
              : cleanSchema(t.schema, { dropAdditional: false }),
          },
        })),
      };

      const base = (cfg.baseUrl || '').replace(/\/$/, '');
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw httpError(res.status, await res.text());

      const json = await res.json();
      const choice = json.choices?.[0];
      const msg = choice?.message || {};
      if (msg.content) onText(msg.content);

      return {
        text: msg.content || '',
        toolCalls: (msg.tool_calls || []).map((c) => ({
          id: c.id,
          name: c.function?.name,
          input: safeParse(c.function?.arguments),
        })),
        stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      };
    },
  },

  /* ---------------------------------------------------------- google gemini */
  google: {
    async send({ cfg, apiKey, system, turns, tools, onText, signal }) {
      const contents = [];
      for (const t of turns) {
        if (t.role === 'user') contents.push({ role: 'user', parts: [{ text: t.content }] });
        else if (t.role === 'assistant') {
          const parts = [];
          if (t.text) parts.push({ text: t.text });
          for (const c of t.toolCalls || [])
            parts.push({ functionCall: { name: c.name, args: c.input ?? {} } });
          if (parts.length) contents.push({ role: 'model', parts });
        } else if (t.role === 'results') {
          contents.push({
            role: 'user',
            parts: t.results.map((r) => ({
              functionResponse: {
                name: r.name,
                response: r.isError
                  ? { error: String(r.output) }
                  : { result: r.output ?? { ok: true } },
              },
            })),
          });
        }
      }

      const declarations = tools.map((t) => {
        const d = { name: t.name, description: t.description };
        if (!isEmptySchema(t.schema))
          d.parameters = cleanSchema(t.schema, { dropAdditional: true });
        return d;
      });

      const base = (cfg.baseUrl || '').replace(/\/$/, '');
      const res = await fetch(
        `${base}/models/${encodeURIComponent(cfg.model)}:generateContent`,
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            tools: [{ functionDeclarations: declarations }],
          }),
        }
      );
      if (!res.ok) throw httpError(res.status, await res.text());

      const json = await res.json();
      const parts = json.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => p.text).map((p) => p.text).join('');
      if (text) onText(text);

      const toolCalls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          // Gemini does not issue call ids; synthesise stable ones.
          id: `${p.functionCall.name}-${i}`,
          name: p.functionCall.name,
          input: p.functionCall.args || {},
        }));

      return {
        text,
        toolCalls,
        stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
      };
    },
  },
};

function safeParse(s) {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function httpError(status, body) {
  const e = new Error(`${status}: ${String(body).slice(0, 300)}`);
  e.status = status;
  return e;
}

/** Send one turn to whichever provider is configured. */
export function sendTurn({ cfg, ...rest }) {
  const provider = PROVIDERS[cfg.provider];
  if (!provider) throw new Error(`Unknown provider ${cfg.provider}`);
  const adapter = adapters[provider.kind];
  const merged = { ...cfg, baseUrl: cfg.baseUrl || provider.baseUrl };
  if (provider.kind !== 'anthropic' && !merged.baseUrl)
    throw new Error('Set the API base URL for this provider.');
  if (!merged.model) throw new Error('Set a model name.');
  return adapter.send({ cfg: merged, ...rest });
}
