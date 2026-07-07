import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { refreshArchitecture, getArchitectureView } from '../src/architecture/architecture.js';
import { readArchitectureDoc } from '../src/architecture/state.js';
import type { ArchRunner } from '../src/architecture/generate.js';
import type { SessionFacts } from '../src/types.js';

const VALID_DOC =
  '## What this app does\nx\n## The main parts\nx\n' +
  '## How the pieces work together\nx\n' +
  '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
  '## Recent changes\n- did a thing';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'proj', cwd: 'C:\\work\\proj', goal: 'build the thing',
  firstTs: null, lastTs: '2026-07-01T00:00:00Z', messageCount: 1,
  inputTokens: 0, outputTokens: 0, filesEdited: ['src/a.ts'], commandsRun: [],
  skillsInvoked: [], errorCount: 0, ending: 'clean',
  lastUserText: null, lastAssistantText: null, skippedLines: 0,
  ...over,
});

function setup(): { dataDir: string; store: Store } {
  const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-archorch-'));
  const store = new Store(':memory:');
  store.upsertSession(facts({ sessionId: 's1' }));
  return { dataDir, store };
}

describe('refreshArchitecture', () => {
  it('does a full agentic generation when no doc exists yet, with tools enabled', async () => {
    const { dataDir, store } = setup();
    const calls: { prompt: string; opts: { cwd: string; tools: boolean; timeoutMs: number } }[] = [];
    const runner: ArchRunner = async (prompt, opts) => { calls.push({ prompt, opts }); return VALID_DOC; };

    const result = await refreshArchitecture(store, 'proj', { dataDir, runner });

    expect(result.status).toBe('generated');
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.tools).toBe(true);
    expect(calls[0].opts.cwd).toBe('C:\\work\\proj');
    const doc = readArchitectureDoc(dataDir, 'proj');
    expect(doc?.markdown).toBe(VALID_DOC);
    expect(doc?.meta.docVersion).toBe(1);
    expect(doc?.meta.coveredThroughTs).toBe('2026-07-01T00:00:00Z');
  });

  it('is a no-op when a doc exists and nothing is stale', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });

    let called = false;
    const result = await refreshArchitecture(store, 'proj', {
      dataDir, runner: async () => { called = true; return VALID_DOC; },
    });

    expect(result.status).toBe('up-to-date');
    expect(called).toBe(false);
  });

  it('does an incremental, tool-free refresh when new sessions exist', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });
    store.upsertSession(facts({
      sessionId: 's2', goal: 'add tests', lastTs: '2026-07-02T00:00:00Z', filesEdited: ['src/b.ts'],
    }));

    const calls: { prompt: string; opts: { tools: boolean } }[] = [];
    const runner: ArchRunner = async (prompt, opts) => { calls.push({ prompt, opts }); return VALID_DOC; };
    const result = await refreshArchitecture(store, 'proj', { dataDir, runner });

    expect(result.status).toBe('generated');
    expect(calls[0].opts.tools).toBe(false);
    expect(calls[0].prompt).toContain('src/b.ts');
    expect(calls[0].prompt).toContain('add tests');
    expect(calls[0].prompt).not.toContain('src/a.ts'); // s1 already covered by the first refresh
  });

  it('forces a full regeneration with the full option even when up to date', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });

    const calls: { opts: { tools: boolean } }[] = [];
    const runner: ArchRunner = async (_p, opts) => { calls.push({ opts }); return VALID_DOC; };
    const result = await refreshArchitecture(store, 'proj', { dataDir, runner, full: true });

    expect(result.status).toBe('generated');
    expect(calls[0].opts.tools).toBe(true);
  });

  it('forces a full regeneration when the existing doc predates the diagram heading, even if not stale', async () => {
    const { dataDir, store } = setup();
    const OLD_DOC_NO_DIAGRAM =
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n## Recent changes\n- did a thing';
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => OLD_DOC_NO_DIAGRAM });

    const calls: { opts: { tools: boolean } }[] = [];
    const runner: ArchRunner = async (_p, opts) => { calls.push({ opts }); return VALID_DOC; };
    const result = await refreshArchitecture(store, 'proj', { dataDir, runner });

    expect(result.status).toBe('generated');
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.tools).toBe(true);
    expect(readArchitectureDoc(dataDir, 'proj')?.markdown).toBe(VALID_DOC);
  });

  it('keeps the previous doc when the runner throws', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });
    store.upsertSession(facts({ sessionId: 's2', lastTs: '2026-07-02T00:00:00Z' }));

    const result = await refreshArchitecture(store, 'proj', {
      dataDir, runner: async () => { throw new Error('claude not found'); },
    });

    expect(result.status).toBe('error');
    expect(readArchitectureDoc(dataDir, 'proj')?.markdown).toBe(VALID_DOC);
  });

  it('rejects and keeps the previous doc when output is missing required sections', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });
    store.upsertSession(facts({ sessionId: 's2', lastTs: '2026-07-02T00:00:00Z' }));

    const result = await refreshArchitecture(store, 'proj', {
      dataDir, runner: async () => 'not a real doc',
    });

    expect(result.status).toBe('rejected');
    expect(readArchitectureDoc(dataDir, 'proj')?.markdown).toBe(VALID_DOC);
  });
});

describe('getArchitectureView', () => {
  it('reports null markdown and 0 staleBy when nothing has been generated', () => {
    const { dataDir, store } = setup();
    expect(getArchitectureView(store, 'proj', dataDir)).toEqual({ markdown: null, meta: null, staleBy: 0 });
  });

  it('reports staleBy excluding the current session', async () => {
    const { dataDir, store } = setup();
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });
    store.upsertSession(facts({ sessionId: 'current', lastTs: '2026-07-02T00:00:00Z' }));

    expect(getArchitectureView(store, 'proj', dataDir, 'current').staleBy).toBe(0);
    expect(getArchitectureView(store, 'proj', dataDir).staleBy).toBe(1);
  });
});
