import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { refreshArchitecture } from '../src/architecture/architecture.js';
import { getBriefingTool, getArchitectureTool, runAuditTool, refreshArchitectureTool } from '../src/mcp/tools.js';
import type { SessionFacts } from '../src/types.js';
import type { ArchRunner } from '../src/architecture/generate.js';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'ship the thing',
  firstTs: null, lastTs: '2026-07-01T00:00:00Z', messageCount: 1,
  inputTokens: 0, outputTokens: 0, filesEdited: [], commandsRun: ['npm install'],
  skillsInvoked: [], errorCount: 0, ending: 'clean',
  lastUserText: null, lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null,
  ...over,
});

function textOf(result: { content: { type: string; text: string }[] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe('getBriefingTool', () => {
  it('returns the briefing for the matching project', () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const body = textOf(getBriefingTool(store, 'C:\\work\\app')) as { cards: { goal: string }[] };
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].goal).toContain('ship the thing');
    store.close();
  });

  it('returns a calm error result for an unmatched cwd', () => {
    const store = new Store(':memory:');
    const body = textOf(getBriefingTool(store, 'C:\\nowhere')) as { error: string };
    expect(body.error).toContain('No indexed history');
    store.close();
  });
});

describe('getArchitectureTool', () => {
  it('returns null markdown with a helpful message when no doc has been generated', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const body = textOf(getArchitectureTool(store, dataDir, 'C:\\work\\app')) as { markdown: string | null; message: string };
    expect(body.markdown).toBeNull();
    expect(body.message).toContain('refresh_architecture');
    store.close();
  });

  it('returns the cached doc and staleness once one exists', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    await refreshArchitecture(store, 'proj', {
      dataDir,
      runner: async () =>
        '## What this app does\nx\n## The main parts\nx\n' +
        '## How the pieces work together\nx\n' +
        '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
        '## Recent changes\n- did a thing',
    });
    const body = textOf(getArchitectureTool(store, dataDir, 'C:\\work\\app')) as { markdown: string; staleBy: number };
    expect(body.markdown).toContain('What this app does');
    expect(body.staleBy).toBe(0);
    store.close();
  });
});

describe('runAuditTool', () => {
  it('scopes the audit to the global CLAUDE.md and only this project\'s own, not other projects\'', () => {
    const claudeDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-claude-'));
    writeFileSync(join(claudeDir, 'CLAUDE.md'), '- Always use `pnpm`, never `npm`\n');
    const projDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-proj-'));
    writeFileSync(join(projDir, 'CLAUDE.md'), '- Never commit `.env` files\n');

    const store = new Store(':memory:');
    store.upsertSession(facts({ projectDir: 'proj', cwd: projDir }));
    store.upsertSession(facts({ sessionId: 's2', projectDir: 'other-proj', cwd: 'C:\\other', goal: 'unrelated work' }));

    const body = textOf(runAuditTool(store, claudeDir, projDir)) as { reports: { source: string }[] };
    expect(body.reports).toHaveLength(2); // global CLAUDE.md + this project's own
    expect(body.reports.some((r) => r.source.includes('CLAUDE.md'))).toBe(true);
    store.close();
  });

  it('returns a calm message when no CLAUDE.md exists anywhere', () => {
    const claudeDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-claude-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const body = textOf(runAuditTool(store, claudeDir, 'C:\\work\\app')) as { reports: unknown[]; message: string };
    expect(body.reports).toEqual([]);
    expect(body.message).toContain('No CLAUDE.md');
    store.close();
  });
});

describe('refreshArchitectureTool', () => {
  it('refreshes and returns the outcome for a matching project', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-refresh-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const runner: ArchRunner = async () =>
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n' +
      '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
      '## Recent changes\n- did a thing';

    const result = await refreshArchitectureTool(store, dataDir, 'C:\\work\\app', {}, runner);
    const body = textOf(result) as { status: string; message: string };
    expect(body.status).toBe('generated');
    store.close();
  });

  it('passes full through to a real re-exploration', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-refresh-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const calls: { tools: boolean }[] = [];
    const runner: ArchRunner = async (_prompt, opts) => {
      calls.push({ tools: opts.tools });
      return '## What this app does\nx\n## The main parts\nx\n' +
        '## How the pieces work together\nx\n' +
        '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
        '## Recent changes\n- did a thing';
    };
    await refreshArchitectureTool(store, dataDir, 'C:\\work\\app', { full: true }, runner);
    expect(calls[0].tools).toBe(true);
    store.close();
  });

  it('returns a calm error result without calling the runner when no project matches', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcptools-refresh-'));
    const store = new Store(':memory:');
    let called = false;
    const runner: ArchRunner = async () => { called = true; return ''; };
    const result = await refreshArchitectureTool(store, dataDir, 'C:\\nowhere', {}, runner);
    const body = textOf(result) as { error: string };
    expect(body.error).toContain('No indexed history');
    expect(called).toBe(false);
    store.close();
  });
});
