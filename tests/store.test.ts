import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { Store, INDEX_VERSION } from '../src/indexer/store.js';
import type { SessionFacts } from '../src/types.js';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'proj-a', cwd: 'C:\\proj', goal: 'do the thing properly',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z', messageCount: 4,
  inputTokens: 1000, outputTokens: 200, filesEdited: ['a.ts'], commandsRun: ['npm test'],
  skillsInvoked: [], errorCount: 0, ending: 'clean', lastUserText: 'thanks',
  lastAssistantText: 'done', skippedLines: 0, ...over,
});

describe('Store', () => {
  it('round-trips a session including array fields', () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const rows = store.getSessions('proj-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].filesEdited).toEqual(['a.ts']);
    expect(rows[0].commandsRun).toEqual(['npm test']);
    expect(rows[0].ending).toBe('clean');
    store.close();
  });

  it('upsert replaces rather than duplicates', () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    store.upsertSession(facts({ goal: 'updated goal text for the session' }));
    const rows = store.getSessions('proj-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].goal).toBe('updated goal text for the session');
    store.close();
  });

  it('sorts sessions by lastTs descending', () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({ sessionId: 'old', lastTs: '2026-06-01T00:00:00Z' }));
    store.upsertSession(facts({ sessionId: 'new', lastTs: '2026-07-02T00:00:00Z' }));
    expect(store.getSessions('proj-a').map((s) => s.sessionId)).toEqual(['new', 'old']);
    store.close();
  });

  it('lists projects with session counts and latest activity', () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({ sessionId: 'a1' }));
    store.upsertSession(facts({ sessionId: 'a2', lastTs: '2026-07-03T00:00:00Z' }));
    store.upsertSession(facts({ sessionId: 'b1', projectDir: 'proj-b' }));
    const projects = store.listProjects();
    expect(projects).toHaveLength(2);
    const a = projects.find((p) => p.projectDir === 'proj-a')!;
    expect(a.sessionCount).toBe(2);
    expect(a.lastTs).toBe('2026-07-03T00:00:00Z');
    store.close();
  });

  it('tracks file metadata for incremental indexing', () => {
    const store = new Store(':memory:');
    expect(store.getFileMeta('x.jsonl')).toBe(null);
    store.setFileMeta('x.jsonl', 123.5, 999);
    expect(store.getFileMeta('x.jsonl')).toEqual({ mtimeMs: 123.5, size: 999 });
    store.close();
  });

  it('clears file metadata when the index version is outdated, keeping polish cache', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-store-'));
    const dbPath = join(dir, 'index.db');
    try {
      const store = new Store(dbPath);
      store.setFileMeta('x.jsonl', 123.5, 999);
      store.setPolish('s1', { goal: 'Fix login bug', outcome: 'Fixed and tested' });
      store.close();

      expect(INDEX_VERSION).toBeGreaterThan(0);
      // Simulate a database written by an older version of the extraction logic
      // (pre-versioning databases have user_version 0).
      const raw = new Database(dbPath);
      raw.pragma('user_version = 0');
      raw.close();

      const reopened = new Store(dbPath);
      expect(reopened.getFileMeta('x.jsonl')).toBe(null);
      expect(reopened.getPolish('s1')).toEqual({ goal: 'Fix login bug', outcome: 'Fixed and tested' });
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps file metadata across reopen at the current index version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-store-'));
    const dbPath = join(dir, 'index.db');
    try {
      const store = new Store(dbPath);
      store.setFileMeta('x.jsonl', 123.5, 999);
      store.close();
      const reopened = new Store(dbPath);
      expect(reopened.getFileMeta('x.jsonl')).toEqual({ mtimeMs: 123.5, size: 999 });
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caches polish results', () => {
    const store = new Store(':memory:');
    expect(store.getPolish('s1')).toBe(null);
    store.setPolish('s1', { goal: 'Fix login bug', outcome: 'Fixed and tested' });
    expect(store.getPolish('s1')).toEqual({ goal: 'Fix login bug', outcome: 'Fixed and tested' });
    store.close();
  });

  describe('getTokensSince', () => {
    it('sums tokens across all projects with lastTs at or after the cutoff', () => {
      const store = new Store(':memory:');
      store.upsertSession(facts({
        sessionId: 'a-old', projectDir: 'proj-a', lastTs: '2026-07-01T05:00:00Z',
        inputTokens: 1000, outputTokens: 100,
      }));
      store.upsertSession(facts({
        sessionId: 'a-new', projectDir: 'proj-a', lastTs: '2026-07-01T10:00:00Z',
        inputTokens: 2000, outputTokens: 200,
      }));
      store.upsertSession(facts({
        sessionId: 'b-new', projectDir: 'proj-b', lastTs: '2026-07-01T11:00:00Z',
        inputTokens: 3000, outputTokens: 300,
      }));
      // a-old is before the cutoff and excluded; a-new and b-new (different projects) are included.
      expect(store.getTokensSince('2026-07-01T09:00:00Z')).toBe(2000 + 200 + 3000 + 300);
      store.close();
    });

    it('includes a session exactly at the cutoff (inclusive boundary)', () => {
      const store = new Store(':memory:');
      store.upsertSession(facts({
        sessionId: 'boundary', lastTs: '2026-07-01T09:00:00Z', inputTokens: 500, outputTokens: 50,
      }));
      expect(store.getTokensSince('2026-07-01T09:00:00Z')).toBe(550);
      store.close();
    });

    it('excludes sessions with a null lastTs', () => {
      const store = new Store(':memory:');
      store.upsertSession(facts({
        sessionId: 'null-ts', lastTs: null, inputTokens: 9999, outputTokens: 9999,
      }));
      expect(store.getTokensSince('2026-01-01T00:00:00Z')).toBe(0);
      store.close();
    });

    it('returns 0 when there are no sessions at all', () => {
      const store = new Store(':memory:');
      expect(store.getTokensSince('2026-01-01T00:00:00Z')).toBe(0);
      store.close();
    });
  });
});
