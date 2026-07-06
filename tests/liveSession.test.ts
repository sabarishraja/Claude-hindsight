import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateLiveStats } from '../src/statusline/liveSession.js';

function toolUseLine(blocks: Record<string, unknown>[]): string {
  return JSON.stringify({ type: 'assistant', message: { content: blocks } }) + '\n';
}
const edit = (file: string) => ({ type: 'tool_use', name: 'Edit', input: { file_path: file } });
const bash = (cmd: string) => ({ type: 'tool_use', name: 'Bash', input: { command: cmd } });

describe('updateLiveStats', () => {
  it('counts files and commands incrementally across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 'state', 's.json');

    writeFileSync(transcript, toolUseLine([edit('a.ts'), bash('npm test')]));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 1, commands: 1 });

    appendFileSync(transcript, toolUseLine([edit('a.ts'), edit('b.ts'), bash('git status')]));
    // a.ts deduped across increments; commands accumulate
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2 });

    // no growth: same result, nothing re-parsed
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2 });
  });

  it('ignores a trailing partial line until it is completed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    const full = toolUseLine([bash('one')]);
    writeFileSync(transcript, full + '{"type":"assist'); // partial second line
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1 });

    appendFileSync(transcript, 'ant","message":{"content":[' + JSON.stringify(bash('two')) + ']}}\n');
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2 });
  });

  it('resets when the transcript shrinks, and survives a missing transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, toolUseLine([bash('a')]) + toolUseLine([bash('b')]));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2 });

    writeFileSync(transcript, toolUseLine([bash('only')])); // truncated/rotated
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1 });

    expect(updateLiveStats(state, join(dir, 'missing.jsonl'))).toEqual({ files: 0, commands: 0 });
  });
});
