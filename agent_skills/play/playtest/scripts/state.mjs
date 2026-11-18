// Runs inside Meta's managed browser (`iwsdk browser run`, copied into the app's workspace by playtest.mjs --state):
// reports what the open game looks like to the app right now, as text, without a picture. Compare it before and
// after driving a hand with `npx iwsdk xr run-sequence`.
export default async function run({ frame, page }) {
  const t = frame ?? page;
  await t.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  return t.evaluate(() => {
    const seen = window.genui.inspect?.();
    if (!seen) return { open: false };
    const round = (v) => v.map((n) => Math.round(n * 1000) / 1000);
    return {
      open: true,
      errors: (window.genui.state?.runtimeErrors || []).slice(-5),
      // Where each piece the hands can pick up is now, in metres in the room, whether a hand holds it, and how it is
      // taken: `touch` by a pinch at it, `ray` by pointing at it and pinching (pieces too close together for a near pinch).
      grabbables: (seen.grabbables || []).map((g) => ({ name: g.name, center: round(g.center), held: g.held, mode: g.mode })),
      pressables: (seen.pressables || []).map((p) => ({ name: p.name, center: round(p.center) })),
      glowing: seen.glowing || [],
      // How many presses and clicks the game's own handlers have answered since it opened.
      handlerCalls: seen.handlerCalls,
      // What the game's play.state() returns now: phase, move, result, stars, and any values its design's checks name.
      game: seen.game ?? null,
    };
  });
}
