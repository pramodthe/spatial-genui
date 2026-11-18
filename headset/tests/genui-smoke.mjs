// Drive the GenUI prompt box in the managed browser and report the outcome.
// Usage: GENUI_PROMPT="teach me the solar system" npx @iwsdk/cli browser run tests/genui-smoke.mjs --timeout 300000
// GENUI_PROMPT defaults to "/example" (the system prompt's example module, no API call).

export default async function run({ frame, page }) {
  const target = frame ?? page;
  const prompt = process.env.GENUI_PROMPT || '/example';
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  return target.evaluate(async (p) => {
    const s = await window.genui.generate(p);
    // Give panels a few frames to load their UIKitML documents.
    await new Promise((r) => setTimeout(r, 1500));
    const res = s.lastResponse ?? {};
    return {
      prompt: p,
      generated: Boolean(res.ok),
      model: res.model,
      totalMs: res.totalMs,
      attempts: res.attempts?.map((a) => `${a.stage}${a.error ? `: ${a.error.slice(0, 160)}` : ''}`),
      stats: res.stats,
      mounted: s.lastMount,
      runtimeErrors: s.runtimeErrors,
    };
  }, prompt);
}
