import { fileURLToPath } from 'node:url';

// The repo-root .env holds the provider settings shared by every app.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(envPath);
} catch {
  // No .env file: fall back to the process environment.
}

export const config = {
  // Any OpenAI-compatible chat-completions endpoint; swap provider by editing .env.
  baseURL: process.env.LLM_BASE_URL || 'https://api.anthropic.com/v1/',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'claude-sonnet-5-5',
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
  port: Number(process.env.GENUI_PORT || 8787),
  maxRepairs: 2,
  // Thinking counts against this budget on reasoning models; 16k truncated 3 of 16 attempts.
  maxCompletionTokens: 32000,
  runsDir: fileURLToPath(new URL('../runs/', import.meta.url)),
};
