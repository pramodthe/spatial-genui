// The guard's shell rules, tried on commands an agent really writes: the everyday ones must pass, and the ones that
// would leave the project, stop a process, install or download must be refused.
// Run: node --experimental-strip-types runner/test-guard.mjs
process.env.PI_XR_WORKSPACE = '/games/river-dam';
process.env.PI_XR_RUN_DIR = '/runs/river-dam-1';
const { refuseBash } = await import('./guard.ts');

const allowed = [
  'npm run typecheck',
  'npm run --if-present typecheck && npm run build',
  'npx @iwsdk/cli dev status',
  'npx @iwsdk/cli xr list-targets',
  `npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[{"target":"Log 1","press":{}}]}' --timeout 45000`,
  'npx tsc --noEmit',
  'for f in package.json iwsdk.config.json src/*.ts public/scenes/*.json; do echo "--- $f"; sed -n \'1,260p\' "$f"; done',
  'grep -n "import.meta.env" src/assets.ts',
  'ls .agents/skills && sed -n 1,20p .gitignore',
  'cat /games/river-dam/src/index.ts',
  'cat /tmp/iwsdk-shot.png | wc -c',
  'rm -rf dist && node -e "console.log(1)"',
  'cat .agents/skills/xr-learning-game/references/hand-actions.md',
];
const refused = [
  'npx @iwsdk/cli dev restart',
  'npx @iwsdk/cli dev up --ai-mode agent',
  'npm run dev',
  'npx vite --port 9000',
  'pkill -f vite',
  'kill 4242',
  'npm install three',
  'npm i -D playwright',
  'npx cowsay hi',
  'git status',
  'curl -s https://example.com/model.glb -o public/model.glb',
  'cat ../../pi-home/mcp.json',
  'cd .. && ls',
  'cat ~/.npmrc',
  'echo $HOME',
  'cat .env',
  'cat /Users/someone/Desktop/meta-AR/.env',
  'ls /Users/someone/Desktop',
  'sudo rm -rf /tmp/x',
];

let wrong = 0;
for (const command of allowed) {
  const why = refuseBash(command);
  if (why) { wrong += 1; console.log(`WRONG, refused: ${command}\n   ${why}`); }
}
for (const command of refused) {
  if (!refuseBash(command)) { wrong += 1; console.log(`WRONG, allowed: ${command}`); }
}
console.log(wrong ? `${wrong} wrong` : `guard ok: ${allowed.length} everyday commands pass, ${refused.length} are refused`);
process.exit(wrong ? 1 : 0);
