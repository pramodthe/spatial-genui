// Prints the published prompt strings from the benchmark harness (apps/gate/src/prompt.ts) so the Python
// API's frozen copy can be compared with them live.
import { GAME_SYSTEM_PROMPT, REVIEW_MESSAGE, SYSTEM_PROMPT, repairMessage } from '../../gate/src/prompt.ts';
import { librarySection } from '../../gate/src/library.ts';

const ids = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  SYSTEM_PROMPT,
  GAME_SYSTEM_PROMPT,
  REVIEW_MESSAGE,
  repair: repairMessage('Boom at line 1'),
  library: librarySection(ids.length ? ids : undefined),
}));
