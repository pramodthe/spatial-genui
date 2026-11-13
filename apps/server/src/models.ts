import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import type { LlmTarget } from './llm.js';

export type ModelEntry = LlmTarget & {
  family: string;
  apiKeyEnv: string;
  priceIn?: number;
  priceOut?: number;
  /** USD per 1M input tokens served from the provider's prompt cache. */
  priceCached?: number;
  enabled?: boolean;
};

export const MODELS_FILE = fileURLToPath(new URL('../../../bench/models.json', import.meta.url));

/** A model from bench/models.json by id, with its API key resolved from the environment. */
export async function loadModel(id: string, file = MODELS_FILE): Promise<ModelEntry> {
  const models = (JSON.parse(await readFile(file, 'utf8')) as { models: ModelEntry[] }).models;
  const entry = models.find((m) => m.id === id);
  if (!entry) throw new Error(`Unknown model ${id}; known: ${models.map((m) => m.id).join(', ')}`);
  // Same endpoint as the app itself: reuse the app's key.
  const apiKey = process.env[entry.apiKeyEnv]
    || (new URL(entry.baseURL).host === new URL(config.baseURL).host ? config.apiKey : '');
  if (!apiKey) throw new Error(`No API key for ${id}: set ${entry.apiKeyEnv} in .env.`);
  return { ...entry, apiKey };
}
