import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from './config.js';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | ContentPart[] };

export type Completion = {
  text: string;
  finishReason: string | null;
  promptTokens: number;
  /** Of promptTokens, how many the provider served from its prompt cache (billed at the cached rate). */
  cachedTokens: number;
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
  /** Provider-specific request fields, e.g. a reasoning-effort setting. */
  extraBody?: Record<string, unknown>;
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
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
// Node's built-in fetch gives up if response headers take more than 5 minutes, and a non-streaming
// request sends none until the model is done thinking (Kimi can think for 10+ minutes on a complex
// app). This agent waits as long as the SDK timeout instead.
const longWaitAgent = new Agent({ headersTimeout: REQUEST_TIMEOUT_MS, bodyTimeout: REQUEST_TIMEOUT_MS });
const longWaitFetch = ((url: string, init?: RequestInit) =>
  undiciFetch(url, { ...(init as object), dispatcher: longWaitAgent } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;

function clientFor(target: LlmTarget): OpenAI {
  // Headers are baked into the client, so targets that differ only in headers need their own.
  const key = `${target.baseURL}\n${target.apiKey}\n${JSON.stringify(target.headers ?? {})}`;
  let client = clients.get(key);
  if (!client) {
    // The SDK retries 429s, 5xx and dropped connections itself, so transient
    // provider trouble isn't counted as a model failure.
    // Reasoning models can think for over 10 minutes on complex apps (the SDK's default timeout).
    client = new OpenAI({
      baseURL: target.baseURL, apiKey: target.apiKey, defaultHeaders: target.headers,
      maxRetries: 3, timeout: REQUEST_TIMEOUT_MS, fetch: longWaitFetch,
    });
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
    ...target.extraBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const choice = res.choices[0];
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    cachedTokens: (res.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)?.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    ms: Math.round(performance.now() - started),
  };
}

export type ToolCall = { id: string; name: string; arguments: string };
export type ToolCompletion = Completion & {
  toolCalls: ToolCall[];
  /** The assistant message to append to the history before the tool results. */
  message: OpenAI.Chat.ChatCompletionMessageParam;
};

/** A chat completion that may call tools (OpenAI function-calling format). */
export async function completeWithTools(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.ChatCompletionTool[],
  target: LlmTarget = defaultTarget,
  /** Per-request limits, for long agent sessions that do their own retrying (default: the client's). */
  request: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<ToolCompletion> {
  if (!target.apiKey) {
    throw new Error(`No API key for ${target.id}. Add it to the .env file at the repo root.`);
  }
  const started = performance.now();
  const res = await clientFor(target).chat.completions.create({
    model: target.model,
    messages,
    tools,
    [target.maxTokensParam ?? 'max_completion_tokens']: config.maxCompletionTokens,
    ...target.extraBody,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, {
    ...(request.timeoutMs != null ? { timeout: request.timeoutMs } : {}),
    ...(request.maxRetries != null ? { maxRetries: request.maxRetries } : {}),
  });
  const choice = res.choices[0];
  const toolCalls = (choice?.message?.tool_calls ?? [])
    .filter((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === 'function')
    .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    cachedTokens: (res.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)?.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
    ms: Math.round(performance.now() - started),
    toolCalls,
    message: {
      role: 'assistant',
      content: choice?.message?.content ?? '',
      ...(toolCalls.length
        ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) }
        : {}),
    },
  };
}
