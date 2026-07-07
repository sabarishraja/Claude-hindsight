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
function assistantWithUsage(usage: Record<string, unknown>): string {
  return JSON.stringify({ type: 'assistant', message: { content: [], usage } }) + '\n';
}

describe('updateLiveStats', () => {
  it('counts files and commands incrementally across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 'state', 's.json');

    writeFileSync(transcript, toolUseLine([edit('a.ts'), bash('npm test')]));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 1, commands: 1, tokens: 0 });

    appendFileSync(transcript, toolUseLine([edit('a.ts'), edit('b.ts'), bash('git status')]));
    // a.ts deduped across increments; commands accumulate
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2, tokens: 0 });

    // no growth: same result, nothing re-parsed
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2, tokens: 0 });
  });

  it('ignores a trailing partial line until it is completed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    const full = toolUseLine([bash('one')]);
    writeFileSync(transcript, full + '{"type":"assist'); // partial second line
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0 });

    appendFileSync(transcript, 'ant","message":{"content":[' + JSON.stringify(bash('two')) + ']}}\n');
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2, tokens: 0 });
  });

  it('resets when the transcript shrinks, and survives a missing transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, toolUseLine([bash('a')]) + toolUseLine([bash('b')]));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2, tokens: 0 });

    writeFileSync(transcript, toolUseLine([bash('only')])); // truncated/rotated
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0 });

    expect(updateLiveStats(state, join(dir, 'missing.jsonl'))).toEqual({ files: 0, commands: 0, tokens: 0 });
  });

  it('accumulates tokens from usage blocks across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({
      input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5, output_tokens: 50,
    }));
    // 100 + 20 + 5 + 50 = 175
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 175 });

    appendFileSync(transcript, assistantWithUsage({ input_tokens: 10, output_tokens: 10 }));
    // + 20
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 195 });
  });

  it('skips non-numeric or missing usage fields without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({ input_tokens: 'not a number', output_tokens: 30 }));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 30 });
  });

  it('resets tokens to 0 when the transcript shrinks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({ input_tokens: 100, output_tokens: 100 }));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 200 });

    // Genuinely shorter than the first write (46 bytes vs 95) so it actually triggers the
    // rotated/truncated reset path (size < state.bytesRead) rather than being read as a suffix.
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [] } }) + '\n');
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 0 });
  });

  it('treats a pre-existing state file without a tokens field as tokens: 0, not corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    // Simulate a state file written before this feature shipped.
    writeFileSync(transcript, toolUseLine([bash('a')]));
    writeFileSync(state, JSON.stringify({ bytesRead: 0, filesEdited: [], commandCount: 0 }));

    // bytesRead: 0 means the whole transcript is re-parsed, contributing 1 command and 0 tokens.
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0 });
  });
});
