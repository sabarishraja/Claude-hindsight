import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOversightStats } from '../src/statusline/oversight.js';

let tsCounter = 1720000000;
function nextTs(): number {
  tsCounter += 300; // keep auto-generated events far outside any dedupe window
  return tsCounter;
}

interface ResultSpec {
  kind?: string;
  status: string;
  detail?: string;
  target?: string | null;
}

function eventWith(
  sessionId: string,
  results: ResultSpec[],
  opts: { claim?: string; ts?: number | null } = {},
): string {
  const obj: Record<string, unknown> = {
    session_id: sessionId,
    claim: opts.claim ?? 'All tests pass',
    decision: 'allow',
    results: results.map((r) => ({
      kind: r.kind ?? 'tests_pass',
      target: r.target ?? 'npm test',
      status: r.status,
      source: 'tests pass',
      detail: r.detail ?? '',
    })),
  };
  if (opts.ts !== null) obj.ts = opts.ts ?? nextTs();
  return JSON.stringify(obj);
}

function event(sessionId: string, statuses: string[]): string {
  return eventWith(sessionId, statuses.map((status) => ({ status })));
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
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 3, fail: 1, lastFailKind: 'tests_pass', extraFailKinds: 0 });
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
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 1, fail: 0, lastFailKind: null, extraFailKinds: 0 });
  });

  it('falls back to the legacy .lie-detector directory (pre-rename hook data)', () => {
    const cwd = writeHistory(tmpdir(), [event('sess-1', ['pass', 'fail'])], '.lie-detector');
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 1, fail: 1, lastFailKind: 'tests_pass', extraFailKinds: 0 });
  });

  it('only counts the last 200 lines of a large history file', () => {
    const old = Array.from({ length: 250 }, () => event('sess-1', ['fail']));
    const recent = Array.from({ length: 200 }, () => event('sess-1', ['pass']));
    const cwd = writeHistory(tmpdir(), [...old, ...recent]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({ pass: 200, fail: 0, lastFailKind: null, extraFailKinds: 0 });
  });

  it('reports the most recent failed kind, sticky across later passes', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ kind: 'file_created', status: 'fail' }]),
      eventWith('sess-1', [{ kind: 'tests_pass', status: 'pass' }]),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 1, fail: 1, lastFailKind: 'file_created', extraFailKinds: 0,
    });
  });

  it('counts other distinct failed kinds, not repeats of the same kind', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ kind: 'tests_pass', status: 'fail' }]),
      eventWith('sess-1', [{ kind: 'tests_pass', status: 'fail' }], { claim: 'Second try' }),
      eventWith('sess-1', [{ kind: 'build_succeeds', status: 'fail' }]),
      eventWith('sess-1', [{ kind: 'file_created', status: 'fail' }]),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 0, fail: 4, lastFailKind: 'file_created', extraFailKinds: 2,
    });
  });

  it('treats a failed result with a missing kind as "unknown"', () => {
    const cwd = writeHistory(tmpdir(), [
      JSON.stringify({
        ts: nextTs(), session_id: 'sess-1', claim: 'x', decision: 'block',
        results: [{ status: 'fail' }],
      }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 0, fail: 1, lastFailKind: 'unknown', extraFailKinds: 0,
    });
  });

  it('collapses an identical double-fired pair within 120s', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ kind: 'file_created', status: 'fail', detail: 'file missing' }],
        { claim: 'Done — created it', ts: 1000 }),
      eventWith('sess-1', [{ kind: 'file_created', status: 'fail', detail: 'file missing' }],
        { claim: 'Done — created it', ts: 1060 }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 0, fail: 1, lastFailKind: 'file_created', extraFailKinds: 0,
    });
  });

  it('keeps identical events more than 120s apart (a genuine repeat)', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: 1000 }),
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: 1200 }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 2, fail: 0, lastFailKind: null, extraFailKinds: 0,
    });
  });

  it('keeps same-claim events whose detail differs (real re-verification)', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ status: 'pass', detail: 'exited 0 in 2.3s' }], { claim: 'Done', ts: 1000 }),
      eventWith('sess-1', [{ status: 'pass', detail: 'exited 0 in 3.0s' }], { claim: 'Done', ts: 1060 }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 2, fail: 0, lastFailKind: null, extraFailKinds: 0,
    });
  });

  it('never dedupes when ts is missing on either event', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: null }),
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: null }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 2, fail: 0, lastFailKind: null, extraFailKinds: 0,
    });
  });

  it('dedupes a triple-fire chain against the first kept event', () => {
    const cwd = writeHistory(tmpdir(), [
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: 1000 }),
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: 1060 }),
      eventWith('sess-1', [{ status: 'pass' }], { claim: 'Done', ts: 1120 }),
    ]);
    expect(readOversightStats(cwd, 'sess-1')).toEqual({
      pass: 1, fail: 0, lastFailKind: null, extraFailKinds: 0,
    });
  });
});
