// The in-headset lesson picker (src/genui/picker.ts), in the managed browser's emulated XR session.
// Usage: npx @iwsdk/cli browser run tests/picker-smoke.mjs --timeout 105000
//   PICKER_STEP=inspect      (default) where the picker is and what it shows
//   PICKER_STEP=auto-repair  a lesson that crashes while loading is repaired once without asking, then the
//                            picker shows it ready. Uses "/example" (the server's built-in example module,
//                            no model call), so it costs nothing.
//   PICKER_STEP=break        right after auto-repair: a second crash is not repaired on its own; the picker
//                            shows "Fix it" (press it with xr look-at + xr select on target "fix").

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectPicker), null, { timeout: 30000 });
  const step = process.env.PICKER_STEP || 'inspect';
  if (step === 'inspect') {
    return target.evaluate(() => ({
      picker: window.genui.inspectPicker(),
      prompt: window.genui.state.prompt,
      busy: window.genui.state.busy,
      // Times a lesson panel button or pressable ran its handler: proves a press on the lesson landed.
      lessonHandlerCalls: window.genui.inspect()?.handlerCalls ?? null,
    }));
  }
  if (step === 'auto-repair') {
    return target.evaluate(async () => {
      const genui = window.genui;
      const phases = [];
      const seen = () => {
        const phase = genui.inspectPicker()?.phase;
        if (phases[phases.length - 1] !== phase) phases.push(phase);
      };
      const watch = setInterval(seen, 50);
      await genui.generate('/example');
      seen();
      // A module that throws as it loads, as a lesson with a mistake in it would.
      const broken = await genui.mount('throw new Error("picker-smoke: crash while loading");');
      // The automatic repair asks the server again with the error; wait for it to finish.
      const start = performance.now();
      await new Promise((r) => setTimeout(r, 300));
      while ((genui.state.busy || genui.inspectPicker()?.phase === 'fixing') && performance.now() - start < 60000) {
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 500));
      clearInterval(watch);
      seen();
      return {
        brokenMount: broken,
        phases,
        autoRepaired: genui.state.autoRepaired,
        finalMount: genui.state.lastMount,
        picker: genui.inspectPicker(),
      };
    });
  }
  if (step === 'break') {
    // After auto-repair has been used, a second crash waits for the learner: the picker shows "Fix it".
    return target.evaluate(async () => {
      const mounted = await window.genui.mount('throw new Error("picker-smoke: crash again");');
      await new Promise((r) => setTimeout(r, 300));
      return { mounted, autoRepaired: window.genui.state.autoRepaired, picker: window.genui.inspectPicker() };
    });
  }
  if (step === 'hidden') {
    // The benchmark hides all chrome before its screenshots; the picker must go too, and come back.
    return target.evaluate(async () => {
      window.genui.setOverlayHidden(true);
      await new Promise((r) => requestAnimationFrame(() => r()));
      const hidden = window.genui.inspectPicker().visible;
      window.genui.setOverlayHidden(false);
      return { visibleWhileHidden: hidden, visibleAfter: window.genui.inspectPicker().visible };
    });
  }
  return { error: `unknown PICKER_STEP ${step}` };
}
