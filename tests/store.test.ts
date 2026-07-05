import { describe, it, expect } from 'vitest';
import { Store } from '../src/indexer/store.js';
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

  it('caches polish results', () => {
    const store = new Store(':memory:');
    expect(store.getPolish('s1')).toBe(null);
    store.setPolish('s1', { goal: 'Fix login bug', outcome: 'Fixed and tested' });
    expect(store.getPolish('s1')).toEqual({ goal: 'Fix login bug', outcome: 'Fixed and tested' });
    store.close();
  });
});
