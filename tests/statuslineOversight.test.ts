import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOversightStats } from '../src/statusline/oversight.js';

function event(sessionId: string, statuses: string[]): string {
  return JSON.stringify({
    ts: 1720000000.5,
    session_id: sessionId,
    claim: 'All tests pass',
    decision: 'allow',
    results: statuses.map((status) => ({
      kind: 'tests', target: 'npm test', status, source: 'tests pass', detail: '',
    })),
  });
}

function writeHistory(dir: string, lines: string[], sub = '.oversight'): string {
  const cwd = mkdtempSync(join(dir, 'ov-'));
  mkdirSync(join(cwd, sub), { recursive: true });
  writeFileSync(join(cwd, sub, 'history.jsonl'), lines.join('\n') + '\n');
  return cwd;
}

describe('readOversightStats', () => {
  it('aggregates pass/fail across events for the current session, mixed results', () => {
    const cwd = writeHistory(tmpdir(), [
      event('sess-1', ['pass', 'pass', 'fail']),
      event('sess-1', ['pass', 'unverifiable', 'skipped']),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 3, fail: 1 });
  });

  it('returns null when the history file is absent', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ov-none-'));
    expect(readOversightStats(cwd, 'sess-1')).toBeNull();
  });

  it('returns null when only other sessions have events', () => {
    const cwd = writeHistory(tmpdir(), [event('other-session', ['pass', 'fail'])]);
    expect(readOversightStats(cwd, 'sess-1')).toBeNull();
  });

  it('returns null when the session has only unverifiable/skipped results', () => {
    const cwd = writeHistory(tmpdir(), [event('sess-1', ['unverifiable', 'skipped'])]);
    expect(readOversightStats(cwd, 'sess-1')).toBeNull();
  });

  it('skips corrupt lines and blank lines without throwing', () => {
    const cwd = writeHistory(tmpdir(), [
      'not json at all {{{',
      '',
      JSON.stringify(['an', 'array', 'not', 'an', 'object']),
      JSON.stringify({ session_id: 'sess-1' }), // no results array
      event('sess-1', ['pass']),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 1, fail: 0 });
  });

  it('falls back to the legacy .lie-detector directory (pre-rename hook data)', () => {
    const cwd = writeHistory(tmpdir(), [event('sess-1', ['pass', 'fail'])], '.lie-detector');
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 1, fail: 1 });
  });

  it('only counts the last 200 lines of a large history file', () => {
    const old = Array.from({ length: 250 }, () => event('sess-1', ['fail']));
    const recent = Array.from({ length: 200 }, () => event('sess-1', ['pass']));
    const cwd = writeHistory(tmpdir(), [...old, ...recent]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 200, fail: 0 });
  });
});
