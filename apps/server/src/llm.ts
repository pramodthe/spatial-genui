import OpenAI from 'openai';
import { config } from './config.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Completion = {
  text: string;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  ms: number;
};

let client: OpenAI | null = null;

function getClient(): OpenAI {
  client ??= new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    defaultHeaders: config.anthropicWorkspaceId
      ? { 'anthropic-workspace-id': config.anthropicWorkspaceId }
      : undefined,
  });
  return client;
}

/**
 * One chat completion through the OpenAI-compatible API.
 * Sampling parameters are left at provider defaults on purpose: Claude 5 models
 * reject non-default temperature/top_p, and the benchmark needs identical
 * requests across providers.
 */
export async function complete(messages: ChatMessage[], model = config.model): Promise<Completion> {
  if (!config.apiKey) {
    throw new Error('LLM_API_KEY is empty. Add your key to the .env file at the repo root.');
  }
  const started = performance.now();
  const res = await getClient().chat.completions.create({
    model,
    messages,
    max_completion_tokens: config.maxCompletionTokens,
  });
  const choice = res.choices[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    ms: Math.round(performance.now() - started),
  };
}
