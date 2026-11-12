import OpenAI from 'openai';
import { config } from './config.js';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | ContentPart[] };

export type Completion = {
  text: string;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  ms: number;
};

/** One model behind an OpenAI-compatible chat-completions endpoint. */
export type LlmTarget = {
  /** Stable label used in logs and benchmark results. */
  id: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Newer OpenAI-style APIs take max_completion_tokens; some gateways only accept max_tokens. */
  maxTokensParam?: 'max_completion_tokens' | 'max_tokens';
  headers?: Record<string, string>;
};

/** The app's own model, from .env. */
export const defaultTarget: LlmTarget = {
  id: config.model,
  baseURL: config.baseURL,
  apiKey: config.apiKey,
  model: config.model,
  headers: config.anthropicWorkspaceId ? { 'anthropic-workspace-id': config.anthropicWorkspaceId } : undefined,
};

const clients = new Map<string, OpenAI>();

function clientFor(target: LlmTarget): OpenAI {
  const key = `${target.baseURL}\n${target.apiKey}`;
  let client = clients.get(key);
  if (!client) {
    // The SDK retries 429s, 5xx and dropped connections itself, so transient
    // provider trouble isn't counted as a model failure.
    client = new OpenAI({ baseURL: target.baseURL, apiKey: target.apiKey, defaultHeaders: target.headers, maxRetries: 3 });
    clients.set(key, client);
  }
  return client;
}

/**
 * One chat completion through the OpenAI-compatible API.
 * Sampling parameters are left at provider defaults on purpose: Claude 5 models
 * reject non-default temperature/top_p, and the benchmark needs identical
 * requests across providers.
 */
export async function complete(messages: ChatMessage[], target: LlmTarget = defaultTarget): Promise<Completion> {
  if (!target.apiKey) {
    throw new Error(`No API key for ${target.id}. Add it to the .env file at the repo root.`);
  }
  const started = performance.now();
  const res = await clientFor(target).chat.completions.create({
    model: target.model,
    messages,
    [target.maxTokensParam ?? 'max_completion_tokens']: config.maxCompletionTokens,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const choice = res.choices[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    ms: Math.round(performance.now() - started),
  };
}
