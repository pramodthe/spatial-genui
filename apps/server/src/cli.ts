// Usage: npm run gen -- "teach me the solar system"
//        npm run gen -- --check-example   (runs the prompt's example through the host checks, no API call)
import { generate } from './agent.js';
import { dryRun } from './sandbox.js';
import { EXAMPLE_MODULE } from './prompt.js';
import { validateModule } from './validate.js';

const args = process.argv.slice(2);

if (args[0] === '--check-example') {
  const validation = validateModule(EXAMPLE_MODULE);
  if (!validation.ok) {
    console.error('Example failed validation:\n' + validation.error);
    process.exit(1);
  }
  const run = await dryRun(validation.transformed);
  console.log(JSON.stringify(run, null, 2));
  process.exit(run.ok ? 0 : 1);
}

const prompt = args.join(' ').trim();
if (!prompt) {
  console.error('Usage: npm run gen -- "<prompt>"');
  process.exit(1);
}

const result = await generate(prompt);
const { code, ...summary } = result;
console.log(JSON.stringify(summary, null, 2));
if (code) console.log('\n----- code -----\n' + code);
process.exit(result.ok ? 0 : 1);
