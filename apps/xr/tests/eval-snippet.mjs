// Evaluate a small read-only snippet against the mounted lesson, for debugging what the host built.
// Usage: GENUI_EVAL='root => root.children.length' npx @iwsdk/cli browser run tests/eval-snippet.mjs --timeout 30000
// The snippet gets the lesson's root Object3D and the IWSDK/three namespace: (root, THREE) => value.
export default async function run({ frame, page }) {
  const target = frame ?? page;
  await target.waitForFunction(() => Boolean(window.genui), null, { timeout: 30000 });
  return target.evaluate((source) => {
    const root = window.genui.debugRoot?.();
    if (!root) return { error: 'no lesson mounted (or debugRoot missing)' };
    // eslint-disable-next-line no-new-func
    return new Function('root', `return (${source})(root)`)(root);
  }, process.env.GENUI_EVAL || 'root => root.children.length');
}
