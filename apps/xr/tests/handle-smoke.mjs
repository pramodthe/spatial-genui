// The move handles (src/genui/handle.ts), in the managed browser's emulated XR session.
// Usage: npx @iwsdk/cli browser run tests/handle-smoke.mjs --timeout 60000
//   HANDLE_STEP=mount    (default) mount a lesson and report where it, its nearest content and its handle stand.
//                        HANDLE_LESSON=<course id>/<lesson index> mounts a saved course lesson (reading it starts
//                        no model call unless a later lesson is still unwritten); otherwise "/example" is used.
//   HANDLE_STEP=inspect  where the handles and their targets are now (after dragging one with xr look-at +
//                        a held trigger on target "Move handle: GenUI Anchor").

export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.inspectMoveHandles), null, { timeout: 30000 });
  const step = process.env.HANDLE_STEP || 'mount';
  const lesson = process.env.HANDLE_LESSON || '';
  if (step === 'mount') {
    await target.evaluate(async (lesson) => {
      const genui = window.genui;
      if (!lesson) return void (await genui.generate('/example'));
      const [id, index] = lesson.split('/');
      const reply = await (await fetch(`/api/courses/${id}/lessons/${index}`)).json();
      await genui.openWritten((reply.lesson ?? reply).code, 'handle-smoke'); // as the picker opens it, so the picker docks
    }, lesson);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return target.evaluate(() => {
    const genui = window.genui;
    const inspection = genui.inspect();
    const round = (v) => Math.round(v * 1000) / 1000;
    const nearest = (inspection?.grabbables ?? []).map((g) => ({ name: g.name, mode: g.mode, center: g.center.map(round) }));
    return { mount: genui.state.lastMount, runtimeErrors: genui.state.runtimeErrors, onSurface: inspection?.onSurface ?? null, handles: genui.inspectMoveHandles(), grabbables: nearest, picker: genui.inspectPicker()?.position };
  });
}
