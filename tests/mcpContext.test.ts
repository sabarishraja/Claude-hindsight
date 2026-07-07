import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { resolveProject, findProjectForCwd } from '../src/mcp/context.js';
import type { SessionFacts } from '../src/types.js';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'do work',
  firstTs: null, lastTs: '2026-07-01T00:00:00Z', messageCount: 1,
  inputTokens: 0, outputTokens: 0, filesEdited: [], commandsRun: [],
  skillsInvoked: [], errorCount: 0, ending: 'clean',
  lastUserText: null, lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null,
  ...over,
});

describe('findProjectForCwd', () => {
  it('matches an exact cwd and a subdirectory of it, case-insensitively', () => {
    const projects = [{ projectDir: 'proj', cwd: 'C:\\work\\App', sessionCount: 1, lastTs: null }];
    expect(findProjectForCwd(projects, 'c:\\work\\app')?.projectDir).toBe('proj');
    expect(findProjectForCwd(projects, 'C:\\work\\App\\src')?.projectDir).toBe('proj');
    expect(findProjectForCwd(projects, 'C:\\other')).toBeUndefined();
  });
});

describe('resolveProject', () => {
  it('returns ok:false when the store is null (no index.db yet)', () => {
    const result = resolveProject(null, 'C:\\work\\app');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('not indexed');
  });

  it('returns ok:false when no project matches the cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-mcpctx-'));
    const store = new Store(join(dir, 'index.db'));
    store.upsertSession(facts({}));
    const result = resolveProject(store, 'C:\\nowhere');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('No indexed history');
    store.close();
  });

  it('returns ok:true with the matching project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-mcpctx-'));
    const store = new Store(join(dir, 'index.db'));
    store.upsertSession(facts({}));
    const result = resolveProject(store, 'C:\\work\\app');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.projectDir).toBe('proj');
    store.close();
  });
});
