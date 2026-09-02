import { configStore, defaultConfig, type StoredConfig } from '../store';
import { DEFAULT_AI_MODEL, type AppConfig } from '../types';

/**
 * Your configuration — the one record that decides what gets scraped.
 *
 * Everything here is read from and written to data/config.json. The Gemini API
 * key is the only value that does not come back out: `toDTO` replaces it with
 * a boolean and a masked hint, because this shape is what the Config page
 * receives over HTTP.
 */

function toDTO(row: StoredConfig): AppConfig {
  const { aiApiKey, ...rest } = row;
  return {
    ...rest,
    aiModel: rest.aiModel || DEFAULT_AI_MODEL,
    aiApiKeySet: Boolean(aiApiKey),
    // Enough to recognise a key, far too little to use one.
    aiApiKeyHint: aiApiKey ? `••••${aiApiKey.slice(-4)}` : '',
  };
}

/**
 * A config update. `aiApiKey` is write-only — it has no counterpart on
 * `AppConfig` because the key never travels back out. Sending '' clears it.
 */
export type ConfigPatch = Partial<Omit<AppConfig, 'updatedAt' | 'aiApiKeySet' | 'aiApiKeyHint'>> & {
  aiApiKey?: string;
};

export function getConfig(): AppConfig {
  return toDTO(configStore.data);
}

export function updateConfig(patch: ConfigPatch): AppConfig {
  const { aiApiKey, ...rest } = patch;
  const next: StoredConfig = { ...configStore.data, ...rest };

  // An empty string is a deliberate "forget my key", not a no-op.
  if (aiApiKey !== undefined) next.aiApiKey = aiApiKey.trim();

  next.updatedAt = new Date().toISOString();
  configStore.data = next;
  return toDTO(next);
}

/**
 * Your Gemini API key. '' when none is saved.
 *
 * Deliberately a separate call from `getConfig`: the key must reach the
 * qualifier and nothing else, and keeping it off the config DTO means it
 * cannot leak through /api/config by accident.
 */
export function getAiApiKey(): string {
  return configStore.data.aiApiKey;
}

/** Throw the config away and start over. */
export function resetConfig(): AppConfig {
  configStore.data = defaultConfig();
  return toDTO(configStore.data);
}
