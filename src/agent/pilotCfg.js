// Load the Pilot's provider config + key from localStorage, in the shape the
// provider adapters expect. Returns null when nothing is configured.
import { loadKeys } from '../engine/transcribe.js';
import { PROVIDERS } from './providers.js';

export function loadPilotCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem('reelcraft.pilot') || '{}');
    const provider = raw.provider || 'anthropic';
    const keys = loadKeys();
    const apiKey = keys[provider] || '';
    if (!apiKey && provider !== 'custom') return null;
    return {
      provider,
      model: raw.model || PROVIDERS[provider]?.defaultModel,
      baseUrl: raw.baseUrl || '',
      apiKey,
    };
  } catch {
    return null;
  }
}
