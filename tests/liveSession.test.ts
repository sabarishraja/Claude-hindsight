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
    expect(updateLiveStats(state, transcript)).toEqual({ files: 1, commands: 1, tokens: 0, rateLimitResetAt: null, contextTokens: null });

    appendFileSync(transcript, toolUseLine([edit('a.ts'), edit('b.ts'), bash('git status')]));
    // a.ts deduped across increments; commands accumulate
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2, tokens: 0, rateLimitResetAt: null, contextTokens: null });

    // no growth: same result, nothing re-parsed
    expect(updateLiveStats(state, transcript)).toEqual({ files: 2, commands: 2, tokens: 0, rateLimitResetAt: null, contextTokens: null });
  });

  it('ignores a trailing partial line until it is completed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    const full = toolUseLine([bash('one')]);
    writeFileSync(transcript, full + '{"type":"assist'); // partial second line
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0, rateLimitResetAt: null, contextTokens: null });

    appendFileSync(transcript, 'ant","message":{"content":[' + JSON.stringify(bash('two')) + ']}}\n');
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2, tokens: 0, rateLimitResetAt: null, contextTokens: null });
  });

  it('resets when the transcript shrinks, and survives a missing transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, toolUseLine([bash('a')]) + toolUseLine([bash('b')]));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 2, tokens: 0, rateLimitResetAt: null, contextTokens: null });

    writeFileSync(transcript, toolUseLine([bash('only')])); // truncated/rotated
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0, rateLimitResetAt: null, contextTokens: null });

    expect(updateLiveStats(state, join(dir, 'missing.jsonl'))).toEqual({ files: 0, commands: 0, tokens: 0, rateLimitResetAt: null, contextTokens: null });
  });

  it('accumulates tokens from usage blocks across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({
      input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5, output_tokens: 50,
    }));
    // 100 + 20 + 5 + 50 = 175
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 175, rateLimitResetAt: null, contextTokens: 125 });

    appendFileSync(transcript, assistantWithUsage({ input_tokens: 10, output_tokens: 10 }));
    // + 20
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 195, rateLimitResetAt: null, contextTokens: 10 });
  });

  it('skips non-numeric or missing usage fields without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({ input_tokens: 'not a number', output_tokens: 30 }));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 30, rateLimitResetAt: null, contextTokens: 0 });
  });

  it('resets tokens to 0 when the transcript shrinks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({ input_tokens: 100, output_tokens: 100 }));
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 200, rateLimitResetAt: null, contextTokens: 100 });

    // Genuinely shorter than the first write (46 bytes vs 95) so it actually triggers the
    // rotated/truncated reset path (size < state.bytesRead) rather than being read as a suffix.
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [] } }) + '\n');
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 0, tokens: 0, rateLimitResetAt: null, contextTokens: null });
  });

  it('treats a pre-existing state file without a tokens field as tokens: 0, not corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    // Simulate a state file written before this feature shipped.
    writeFileSync(transcript, toolUseLine([bash('a')]));
    writeFileSync(state, JSON.stringify({ bytesRead: 0, filesEdited: [], commandCount: 0 }));

    // bytesRead: 0 means the whole transcript is re-parsed, contributing 1 command and 0 tokens.
    expect(updateLiveStats(state, transcript)).toEqual({ files: 0, commands: 1, tokens: 0, rateLimitResetAt: null, contextTokens: null });
  });

  it('tracks the latest rate-limit reset time seen live', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    const rateLimitLine = (text: string, ts: string) => JSON.stringify({
      type: 'assistant', timestamp: ts,
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      error: 'rate_limit', isApiErrorMessage: true,
    }) + '\n';

    writeFileSync(transcript, rateLimitLine('resets 1:00pm (America/Chicago)', '2026-06-23T10:00:00.000Z'));
    let result = updateLiveStats(state, transcript);
    expect(result.rateLimitResetAt).toBe('2026-06-23T18:00:00.000Z');

    appendFileSync(transcript, rateLimitLine('resets 3:00pm (America/Chicago)', '2026-06-23T14:00:00.000Z'));
    result = updateLiveStats(state, transcript);
    expect(result.rateLimitResetAt).toBe('2026-06-23T20:00:00.000Z');
  });

  it('tracks context tokens as the latest turn snapshot, not a running sum', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, assistantWithUsage({
      input_tokens: 1000, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000, output_tokens: 50,
    }));
    // context = 1000 + 500 + 2000 = 3500 (output_tokens excluded: it's not part of context size)
    expect(updateLiveStats(state, transcript).contextTokens).toBe(3500);

    appendFileSync(transcript, assistantWithUsage({ input_tokens: 10, output_tokens: 5 }));
    // overwritten, not added: 10 (no cache fields present this turn)
    expect(updateLiveStats(state, transcript).contextTokens).toBe(10);
  });

  it('contextTokens stays null until an assistant usage block is seen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, toolUseLine([bash('a')]));
    expect(updateLiveStats(state, transcript).contextTokens).toBe(null);
  });

  it('treats a pre-existing state file without rateLimitResetAt/contextTokens as null, not corrupt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-live-'));
    const transcript = join(dir, 't.jsonl');
    const state = join(dir, 's.json');

    writeFileSync(transcript, toolUseLine([bash('a')]));
    writeFileSync(state, JSON.stringify({ bytesRead: 0, filesEdited: [], commandCount: 0, tokens: 0 }));
    const result = updateLiveStats(state, transcript);
    expect(result.rateLimitResetAt).toBe(null);
    expect(result.contextTokens).toBe(null);
    expect(result.commands).toBe(1);
  });
});
