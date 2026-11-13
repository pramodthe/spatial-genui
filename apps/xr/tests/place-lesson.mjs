// Open a ready-made lesson from the current viewpoint and report where the host placed it.
// Usage: npx @iwsdk/cli browser run tests/place-lesson.mjs --timeout 60000   (set the headset pose first)
export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui?.startLesson), null, { timeout: 30000 });
  return target.evaluate(async () => {
    window.genui.clear();
    await window.genui.startLesson('Show me how blood flows through the heart, step by step.');
    await new Promise((r) => setTimeout(r, 1500));
    const report = window.genui.inspect();
    return { mounted: window.genui.state.lastMount?.ok, onSurface: report?.onSurface, layout: report?.layout };
  });
}
