import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Store } from '../src/indexer/store.js';
import { createServer } from '../src/server/server.js';
import type { SessionFacts } from '../src/types.js';

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'proj-a', cwd: null, goal: 'ship the briefing view for the dashboard',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T10:30:00Z', messageCount: 4,
  inputTokens: 1000, outputTokens: 100, filesEdited: [], commandsRun: ['npm install'],
  skillsInvoked: [], errorCount: 0, ending: 'clean', lastUserText: null,
  lastAssistantText: null, skippedLines: 0, ...over,
});

let server: Server;
let base: string;
let claudeDir: string;
let store: Store;

beforeAll(async () => {
  claudeDir = mkdtempSync(join(tmpdir(), 'dost-claude-'));
  writeFileSync(join(claudeDir, 'CLAUDE.md'), '- Always use `pnpm`, never `npm`\n');
  store = new Store(':memory:');
  store.upsertSession(session({}));
  store.upsertSession(session({ sessionId: 's2', projectDir: 'proj-b', goal: null }));
  const app = createServer(store, { uiDist: null, claudeDir });
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
  store.close();
  rmSync(claudeDir, { recursive: true, force: true });
});

describe('API', () => {
  it('GET /api/projects lists projects', async () => {
    const res = await fetch(`${base}/api/projects`);
    expect(res.status).toBe(200);
    const projects = await res.json() as { projectDir: string; sessionCount: number }[];
    expect(projects.map((p) => p.projectDir).sort()).toEqual(['proj-a', 'proj-b']);
  });

  it('GET /api/projects/:dir/briefing returns cards and leftOff', async () => {
    const res = await fetch(`${base}/api/projects/proj-a/briefing`);
    const briefing = await res.json() as { cards: { goal: string }[]; leftOff: unknown };
    expect(briefing.cards).toHaveLength(1);
    expect(briefing.cards[0].goal).toContain('briefing view');
    expect(briefing.leftOff).not.toBe(null);
  });

  it('GET /api/audit cross-examines global CLAUDE.md against all sessions', async () => {
    const res = await fetch(`${base}/api/audit`);
    const reports = await res.json() as { source: string; findings: { verdict: string; evidence: string[] }[] }[];
    expect(reports).toHaveLength(1);
    expect(reports[0].findings[0].verdict).toBe('violated'); // npm install ran in s1
    expect(reports[0].findings[0].evidence[0]).toContain('s1');
  });

  it('unknown project returns empty briefing, not an error', async () => {
    const res = await fetch(`${base}/api/projects/nope/briefing`);
    expect(res.status).toBe(200);
    const briefing = await res.json() as { cards: unknown[] };
    expect(briefing.cards).toEqual([]);
  });
});
