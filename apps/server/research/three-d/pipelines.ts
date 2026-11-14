import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../../src/config.js';
import { complete, completeWithTools, type ChatMessage, type Completion, type ContentPart, type LlmTarget } from '../../src/llm.js';
import { dryRun } from '../../src/sandbox.js';
import { extractCode, validateModule } from '../../src/validate.js';
import { repairText, systemPrompt, type Pipeline } from '../../src/three-d/prompts.js';
import { exportModuleToGlb } from '../../src/three-d/render.js';

/**
 * The three Phase 3 pipelines behind one interface: build a model from a request, then revise it
 * from feedback. P1 and P2 are code-writing conversations (Three.js, CadQuery); P3 is a tool-using
 * agent working in a live Blender scene through the Blender MCP server.
 *
 * Agent-written Python runs on the 3D backend: the Python service on Modal (apps/worker3d/research/modal_app.py,
 * one Modal Sandbox per job) when WORKER3D_URL is set, otherwise local workers in a macOS sandbox.
 */

export type Backend = 'modal' | 'local';
export const defaultBackend = (): Backend => (config.worker3dUrl ? 'modal' : 'local');

const WORKER = fileURLToPath(new URL('../../../worker3d/', import.meta.url));
const PYTHON = join(WORKER, '.venv/bin/python3');
const MAX_REPAIRS = 2;
/** Model turns per build or revision in Blender; each turn can run several tool calls. */
const MAX_TOOL_TURNS = 16;
const MAX_TOOL_RESULT_CHARS = 8000;

export type Usage = { calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; llmMs: number; toolCalls: number };
export type StepResult =
  | { ok: true; glb: Buffer; code?: string; repairs: number }
  | { ok: false; error: string; code?: string; repairs: number };

export interface Session {
  /** First build from the request, optionally with a reference image (data URL). */
  start(text: string, image?: string): Promise<StepResult>;
  /** Revise after review; `image` is the render grid the reviewer saw (data URL). */
  revise(text: string, image: string): Promise<StepResult>;
  usage: Usage;
  close(): Promise<void>;
}

export async function openSession(pipeline: Pipeline, target: LlmTarget, jobDir: string, backend: Backend = defaultBackend()): Promise<Session> {
  if (backend === 'modal' && !config.worker3dUrl) throw new Error('Set WORKER3D_URL and WORKER3D_TOKEN in .env to use the Modal backend.');
  if (pipeline === 'p3-blender') return BlenderSession.open(target, jobDir, backend);
  return new CodeSession(pipeline, target, jobDir, backend);
}

const authHeaders = () => ({ Authorization: `Bearer ${config.worker3dToken}` });

function userContent(text: string, image?: string): ContentPart[] | string {
  return image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;
}

function track(usage: Usage, reply: Completion) {
  usage.calls++;
  usage.promptTokens += reply.promptTokens;
  usage.cachedTokens += reply.cachedTokens;
  usage.completionTokens += reply.completionTokens;
  usage.llmMs += reply.ms;
}

const emptyUsage = (): Usage => ({ calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, llmMs: 0, toolCalls: 0 });

/** P1 (Three.js) and P2 (CadQuery): the model writes the whole program; errors go back for repair. */
class CodeSession implements Session {
  usage = emptyUsage();
  private messages: ChatMessage[];
  private version = 0;

  constructor(private pipeline: Pipeline, private target: LlmTarget, private jobDir: string, private backend: Backend) {
    this.messages = [{ role: 'system', content: systemPrompt(pipeline) }];
  }

  start(text: string, image?: string) {
    return this.step(userContent(text, image));
  }

  revise(text: string, image: string) {
    return this.step(userContent(text, image));
  }

  async close() {}

  private async step(content: ContentPart[] | string): Promise<StepResult> {
    this.messages.push({ role: 'user', content });
    let lastCode: string | undefined;
    for (let attempt = 0; ; attempt++) {
      const reply = await complete(this.messages, this.target);
      track(this.usage, reply);
      this.messages.push({ role: 'assistant', content: reply.text });
      const code = this.pipeline === 'p1-threejs' ? extractCode(reply.text) : extractPython(reply.text);
      let error: string;
      if (!code) {
        error = reply.finishReason === 'length'
          ? 'The reply was cut off before the code block finished. Write shorter code.'
          : 'No code block found in the reply.';
      } else {
        lastCode = code;
        const out = this.pipeline === 'p1-threejs' ? await this.runThree(code) : await this.runCadQuery(code);
        if ('glb' in out) return { ok: true, glb: out.glb, code, repairs: attempt };
        error = out.error;
      }
      if (attempt >= MAX_REPAIRS) return { ok: false, error, code: lastCode, repairs: attempt };
      this.messages.push({ role: 'user', content: repairText(error) });
    }
  }

  private async runThree(code: string): Promise<{ glb: Buffer } | { error: string }> {
    await writeFile(join(this.jobDir, `v${++this.version}.js`), code);
    const validation = validateModule(code);
    if (!validation.ok) return { error: validation.error };
    const run = await dryRun(validation.transformed);
    if (!run.ok) return { error: run.error };
    return exportModuleToGlb(code);
  }

  private runCadQueryRemote(code: string) {
    return runCadQueryRemoteImpl(code);
  }

  private async runCadQuery(code: string): Promise<{ glb: Buffer } | { error: string }> {
    const n = ++this.version;
    const script = join(this.jobDir, `v${n}.py`);
    const out = join(this.jobDir, `v${n}.glb`);
    await writeFile(script, code);
    if (this.backend === 'modal') return this.runCadQueryRemote(code);
    const stdout = await new Promise<string>((resolve) => {
      // The wrapper is trusted; it runs the script itself inside the sandbox with a time limit.
      const child = spawn(PYTHON, [join(WORKER, 'research/cadquery_job.py'), this.jobDir, script, out], {
        cwd: WORKER, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.on('close', () => resolve(text));
    });
    try {
      const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '');
      if (!result.ok) return { error: result.error };
      return { glb: await readFile(out) };
    } catch {
      return { error: `The CadQuery runner gave no result: ${stdout.slice(-300)}` };
    }
  }
}

/** The same CadQuery runner, in a fresh Modal Sandbox per script (network blocked, no secrets). */
async function runCadQueryRemoteImpl(code: string): Promise<{ glb: Buffer } | { error: string }> {
  try {
    const res = await fetch(`${config.worker3dUrl}/cadquery`, {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: code }), signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`3D backend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const result = (await res.json()) as { ok: boolean; error?: string; glb_base64?: string };
    if (!result.ok || !result.glb_base64) return { error: result.error ?? 'The CadQuery runner returned no model.' };
    return { glb: Buffer.from(result.glb_base64, 'base64') };
  } catch (err) {
    // The backend itself failing is not the model's fault: surface it as a harness error, not a repair.
    throw new Error(`3D backend unreachable: ${(err as Error).message}`);
  }
}

function extractPython(reply: string): string | null {
  const fence = reply.match(/```(?:python|py)?\s*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return /def\s+build\s*\(/.test(reply) ? reply.trim() : null;
}

/** P3: an agent with Blender tools, served by the Blender MCP server (apps/worker3d/research). */
/**
 * Options for a Blender agent session. Defaults are Phase 3's P3 (build a model from scratch).
 * - system: the agent's instructions.
 * - maxTurns: model turns per step.
 * - turnTimeoutMs: give up on one model turn after this long and retry it (default: the client's 30 minutes).
 * - look: adds a `look` tool. The harness exports the scene, `render` turns the GLB into pictures and a
 *   caption, and the agent gets them, so it can see its work instead of inferring it from numbers.
 */
export type BlenderSessionOptions = {
  system?: string;
  maxTurns?: number;
  turnTimeoutMs?: number;
  look?: { description: string; render: (glb: Buffer) => Promise<{ text: string; images: Buffer[] }> };
};

export class BlenderSession implements Session {
  usage = emptyUsage();
  private messages: OpenAI.Chat.ChatCompletionMessageParam[];
  private version = 0;
  private maxTurns: number;

  private constructor(private client: Client, private tools: OpenAI.Chat.ChatCompletionTool[], private target: LlmTarget, private jobDir: string, private backend: Backend, private options: BlenderSessionOptions) {
    this.messages = [{ role: 'system', content: options.system ?? systemPrompt('p3-blender') }];
    this.maxTurns = options.maxTurns ?? MAX_TOOL_TURNS;
    if (options.look) this.tools.push({ type: 'function', function: { name: 'look', description: options.look.description, parameters: { type: 'object', properties: {} } } });
  }

  static async open(target: LlmTarget, jobDir: string, backend: Backend, options: BlenderSessionOptions = {}): Promise<BlenderSession> {
    // Local: the MCP server gets the SDK's minimal default environment (no API keys) and runs Blender
    // in the macOS sandbox. Modal: the hosted MCP server gives this session its own Blender sandbox.
    const transport = backend === 'modal'
      ? new StreamableHTTPClientTransport(new URL(`${config.worker3dUrl}/mcp`), { requestInit: { headers: authHeaders() } })
      : new StdioClientTransport({ command: PYTHON, args: [join(WORKER, 'research/blender_mcp_server.py'), '--job', jobDir], cwd: WORKER, stderr: 'ignore' });
    const client = new Client({ name: 'spatial-genui-3d', version: '0.1.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    // Export and session control are the harness's job, not the agent's.
    const tools = listed.tools
      .filter((t) => t.name !== 'export_glb' && t.name !== 'close_session')
      .map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema as Record<string, unknown> } }));
    return new BlenderSession(client, tools, target, jobDir, backend, options);
  }

  /**
   * A long session outlives brief network drops (DNS, Wi-Fi) and stalled requests: wait and retry them
   * instead of failing the job. With a turn timeout the client's own retries are off, so this loop is
   * the only one: up to 10 tries per turn, which rides out about 6 minutes without a connection.
   */
  private async completeRetrying() {
    const timeoutMs = this.options.turnTimeoutMs;
    for (let attempt = 1; ; attempt++) {
      try {
        return await completeWithTools(this.messages, this.tools, this.target, timeoutMs ? { timeoutMs, maxRetries: 0 } : {});
      } catch (err) {
        const connection = /APIConnection/.test((err as Error).constructor?.name ?? '') || /timed out|fetch failed|ENOTFOUND|ECONNRESET/i.test(String((err as Error).message));
        if (!connection || attempt >= 10) throw err;
        await this.log(`no reply (${(err as Error).message}); retrying in 30 s`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  }

  /** The `look` tool: export the scene and let the session's renderer turn it into pictures for the agent. */
  private async lookAtScene(): Promise<{ text: string; images: Buffer[] }> {
    try {
      const out = await this.export();
      if ('error' in out) return { text: out.error, images: [] };
      return await this.options.look!.render(out.glb);
    } catch (err) {
      return { text: `Could not render the scene: ${(err as Error).message}`, images: [] };
    }
  }

  /** The agent's turns and tool calls, for reviewing a run afterwards (<job>/transcript.log). */
  private log(line: string) {
    return appendFile(join(this.jobDir, 'transcript.log'), `[${new Date().toISOString().slice(11, 19)}] ${line}\n\n`).catch(() => undefined);
  }

  /** The harness's own Blender code (e.g. importing the model to repair); not shown to the agent. */
  exec(code: string) {
    return this.callTool('execute_blender_code', JSON.stringify({ code }), false);
  }

  start(text: string, image?: string) {
    return this.step(userContent(text, image));
  }

  revise(text: string, image: string) {
    return this.step(userContent(text, image));
  }

  async close() {
    // On Modal, end the session's Blender sandbox now instead of waiting for its idle timeout.
    if (this.backend === 'modal') await this.callTool('close_session', '{}', false);
    await this.client.close().catch(() => undefined);
  }

  private async step(content: ContentPart[] | string): Promise<StepResult> {
    this.messages.push({ role: 'user', content } as OpenAI.Chat.ChatCompletionUserMessageParam);
    for (let attempt = 0; ; attempt++) {
      await this.agentLoop();
      const out = await this.export();
      if ('glb' in out) return { ok: true, glb: out.glb, repairs: attempt };
      if (attempt >= MAX_REPAIRS) return { ok: false, error: out.error, repairs: attempt };
      this.messages.push({ role: 'user', content: `${out.error}\nFix it with your tools, then reply with a one-line summary and no tool call.` });
    }
  }

  /** Let the model call tools until it answers without one (done) or runs out of turns. */
  private async agentLoop() {
    for (let turn = 0; turn < this.maxTurns; turn++) {
      const reply = await this.completeRetrying();
      track(this.usage, reply);
      this.messages.push(reply.message);
      if (reply.text) await this.log(`assistant: ${reply.text}`);
      if (!reply.toolCalls.length) return;
      const pictures: Buffer[] = [];
      for (const call of reply.toolCalls) {
        this.usage.toolCalls++;
        let result: string;
        if (call.name === 'look' && this.options.look) {
          const seen = await this.lookAtScene();
          result = seen.images.length ? `${seen.text}\nThe pictures follow in the next message.` : seen.text;
          pictures.push(...seen.images);
        } else {
          result = await this.callTool(call.name, call.arguments);
        }
        await this.log(`tool ${call.name}: ${call.arguments.slice(0, 4000)}\n=> ${result.slice(0, 1500)}`);
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      // Tool results carry text only, so pictures go in a user message right after them.
      if (pictures.length) {
        this.messages.push({ role: 'user', content: [{ type: 'text', text: 'The pictures from look:' }, ...pictures.map((p) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${p.toString('base64')}` } }))] });
      }
    }
    // Out of turns: export whatever the scene holds; the model gets a chance to finish on the next step.
  }

  /** Results for the model are truncated to keep its context small; the harness's own calls are not. */
  private async callTool(name: string, rawArgs: string, truncate = true): Promise<string> {
    try {
      const result = await this.client.callTool({ name, arguments: JSON.parse(rawArgs || '{}') }, undefined, { timeout: 180_000 });
      const text = (result.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
      return truncate && text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)` : text;
    } catch (err) {
      return JSON.stringify({ ok: false, error: `Tool call failed: ${(err as Error).message}` });
    }
  }

  /** The scene as a GLB (also left in the job folder as v<n>.glb). */
  async export(): Promise<{ glb: Buffer } | { error: string }> {
    const name = `v${++this.version}.glb`;
    const raw = await this.callTool('export_glb', this.backend === 'modal' ? '{}' : JSON.stringify({ filename: name }), false);
    try {
      const result = JSON.parse(raw);
      if (!result.ok) return { error: `Export failed: ${result.error}` };
      const meshes = (result.scene?.objects ?? []).filter((o: { type: string }) => o.type === 'MESH');
      if (!meshes.length) return { error: 'The scene has no mesh objects to export.' };
      // Both servers return the GLB inline; the local one also leaves the file in the job folder.
      const glb = result.glb_base64 ? Buffer.from(result.glb_base64, 'base64') : await readFile(join(this.jobDir, name));
      await writeFile(join(this.jobDir, name), glb);
      return { glb };
    } catch {
      return { error: `Export failed: ${raw.slice(0, 300)}` };
    }
  }
}
