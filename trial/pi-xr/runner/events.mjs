// Counts what a pi run did from its JSON event stream (pi --mode json; node_modules/@earendil-works/
// pi-coding-agent/docs/json.md): turns, tool calls by tool, tokens, dollars, the largest request, and when the game
// first passed a typecheck. The runner feeds it every record as it arrives, and a saved stream can be read again.
import { readFileSync } from 'node:fs';

export function newStats() {
  return {
    turns: 0, toolCalls: 0, failedCalls: 0, tools: {}, imageReads: 0, compactions: 0, retries: 0,
    input: 0, output: 0, cacheRead: 0, usd: 0, largestRequest: 0,
    firstTypecheckPassS: null, firstSequenceS: null, stopReason: null, settled: false, aborted: false, models: {},
    lastSaid: '', // the agent's last words: for a fix, what it tells the player it changed
  };
}

const text = (result) => (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

/** Add one record of the stream to the stats. `sinceS` is seconds since the run began (for the "first" times). */
export function count(stats, record, sinceS = 0) {
  switch (record.type) {
    case 'turn_end':
      stats.turns += 1;
      break;
    case 'message_end': {
      const m = record.message ?? {};
      if (m.role !== 'assistant') break;
      const u = m.usage ?? {};
      stats.input += u.input ?? 0;
      stats.output += u.output ?? 0;
      stats.cacheRead += u.cacheRead ?? 0;
      stats.usd += u.cost?.total ?? 0;
      stats.largestRequest = Math.max(stats.largestRequest, (u.input ?? 0) + (u.cacheRead ?? 0));
      stats.stopReason = m.stopReason ?? stats.stopReason;
      if (text(m).trim()) stats.lastSaid = text(m).trim();
      if (m.provider || m.model) stats.models[`${m.provider ?? '?'}/${m.model ?? '?'}`] = (stats.models[`${m.provider ?? '?'}/${m.model ?? '?'}`] ?? 0) + 1;
      break;
    }
    case 'tool_execution_start':
      // An image the model reads goes into every later request; they are counted (more than 30 in one fails).
      if (record.toolName === 'read' && /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(record.args?.path ?? ''))) stats.imageReads += 1;
      break;
    case 'tool_execution_end': {
      stats.toolCalls += 1;
      stats.tools[record.toolName] = (stats.tools[record.toolName] ?? 0) + 1;
      if (record.isError) stats.failedCalls += 1;
      const out = text(record.result);
      if (stats.firstSequenceS === null && /xr_run_sequence$/.test(record.toolName) && !record.isError) stats.firstSequenceS = Math.round(sinceS);
      if (stats.firstTypecheckPassS === null && record.toolName === 'bash' && !record.isError && /typecheck|tsc/.test(JSON.stringify(record.args ?? '')) && !/error TS\d+/.test(out)) stats.firstTypecheckPassS = Math.round(sinceS);
      break;
    }
    case 'compaction_end':
      stats.compactions += 1;
      stats.usd += record.result?.usage?.cost?.total ?? 0;
      break;
    case 'auto_retry_start':
      stats.retries += 1;
      break;
    case 'agent_settled':
      stats.settled = true;
      stats.aborted = Boolean(record.aborted);
      break;
  }
  return stats;
}

/** The records of a saved stream. Split on LF only: other Unicode line separators are valid inside the JSON. */
export function records(file) {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function statsOf(file) {
  const stats = newStats();
  let began = null;
  for (const record of records(file)) {
    if (record.type === 'session') began = Date.parse(record.timestamp);
    const at = record.message?.timestamp ?? null;
    count(stats, record, began && at ? (at - began) / 1000 : 0);
  }
  return stats;
}
