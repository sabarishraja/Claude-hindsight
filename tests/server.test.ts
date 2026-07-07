import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Store } from '../src/indexer/store.js';
import { createServer } from '../src/server/server.js';
import type { SessionFacts } from '../src/types.js';
import { refreshArchitecture } from '../src/architecture/architecture.js';

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'proj-a', cwd: null, goal: 'ship the briefing view for the dashboard',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T10:30:00Z', messageCount: 4,
  inputTokens: 1000, outputTokens: 100, filesEdited: [], commandsRun: ['npm install'],
  skillsInvoked: [], errorCount: 0, ending: 'clean', lastUserText: null,
  lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null, ...over,
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

  it('GET /api/projects/:dir/architecture returns nulls when dataDir is not configured', async () => {
    const res = await fetch(`${base}/api/projects/proj-a/architecture`);
    expect(res.status).toBe(200);
    const body = await res.json() as { markdown: string | null; meta: unknown; staleBy: number };
    expect(body).toEqual({ markdown: null, meta: null, staleBy: 0 });
  });

  it('GET /api/projects/:dir/architecture returns the generated doc and staleness', async () => {
    const archClaudeDir = mkdtempSync(join(tmpdir(), 'dost-arch-claude-'));
    const archDataDir = mkdtempSync(join(tmpdir(), 'dost-arch-data-'));
    const archStore = new Store(':memory:');
    archStore.upsertSession(session({ sessionId: 'arch-1', projectDir: 'proj-arch' }));
    await refreshArchitecture(archStore, 'proj-arch', {
      dataDir: archDataDir,
      runner: async () =>
        '## What this app does\nx\n## The main parts\nx\n' +
        '## How the pieces work together\nx\n' +
        '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
        '## Recent changes\n- did a thing',
    });
    const archApp = createServer(archStore, { uiDist: null, claudeDir: archClaudeDir, dataDir: archDataDir });
    let archServer: Server;
    await new Promise<void>((resolve) => { archServer = archApp.listen(0, resolve); });
    const archAddr = archServer!.address();
    const archBase = `http://127.0.0.1:${typeof archAddr === 'object' && archAddr ? archAddr.port : 0}`;

    const res = await fetch(`${archBase}/api/projects/proj-arch/architecture`);
    const body = await res.json() as { markdown: string; staleBy: number };
    expect(body.markdown).toContain('What this app does');
    expect(body.staleBy).toBe(0);

    archServer!.close();
    archStore.close();
    rmSync(archClaudeDir, { recursive: true, force: true });
    rmSync(archDataDir, { recursive: true, force: true });
  });

  it('GET /api/audit returns JSON 500 when CLAUDE.md is a directory', async () => {
    const badClaudeDir = mkdtempSync(join(tmpdir(), 'dost-bad-claude-'));
    mkdirSync(join(badClaudeDir, 'CLAUDE.md'));
    const badStore = new Store(':memory:');
    badStore.upsertSession(session({}));
    const badApp = createServer(badStore, { uiDist: null, claudeDir: badClaudeDir });
    let badServer: Server;
    await new Promise<void>((resolve) => { badServer = badApp.listen(0, resolve); });
    const badAddr = badServer.address();
    const badBase = `http://127.0.0.1:${typeof badAddr === 'object' && badAddr ? badAddr.port : 0}`;

    const res = await fetch(`${badBase}/api/audit`);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');

    badServer.close();
    badStore.close();
    rmSync(badClaudeDir, { recursive: true, force: true });
  });

  it('POST polish caps at 10 sessions per request and reports remaining', async () => {
    const capClaudeDir = mkdtempSync(join(tmpdir(), 'dost-cap-claude-'));
    const capStore = new Store(':memory:');
    for (let i = 0; i < 12; i++) {
      capStore.upsertSession(session({
        sessionId: `cap-${i}`,
        projectDir: 'proj-cap',
        goal: `do the thing number ${i} for this session`,
        lastTs: `2026-07-01T10:${String(i).padStart(2, '0')}:00Z`,
      }));
    }
    const capApp = createServer(capStore, {
      uiDist: null, claudeDir: capClaudeDir,
      claudeRunner: async () => '{"goal": "g", "outcome": "o"}',
    });
    let capServer: Server;
    await new Promise<void>((resolve) => { capServer = capApp.listen(0, resolve); });
    const capAddr = capServer!.address();
    const capBase = `http://127.0.0.1:${typeof capAddr === 'object' && capAddr ? capAddr.port : 0}`;

    const res = await fetch(`${capBase}/api/projects/proj-cap/polish`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { polished: number; failed: number; remaining: number };
    expect(body.polished).toBe(10);
    expect(body.remaining).toBe(2);

    capServer!.close();
    capStore.close();
    rmSync(capClaudeDir, { recursive: true, force: true });
  });

  it('POST polish returns 409 when already in-flight for the same project', async () => {
    const cClaudeDir = mkdtempSync(join(tmpdir(), 'dost-conc-claude-'));
    const cStore = new Store(':memory:');
    cStore.upsertSession(session({ sessionId: 'conc-1', projectDir: 'proj-conc', goal: 'work on the concurrent test session' }));

    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const cApp = createServer(cStore, {
      uiDist: null, claudeDir: cClaudeDir,
      claudeRunner: async () => { await gate; return '{"goal": "g", "outcome": "o"}'; },
    });
    let cServer: Server;
    await new Promise<void>((resolve) => { cServer = cApp.listen(0, resolve); });
    const cAddr = cServer!.address();
    const cBase = `http://127.0.0.1:${typeof cAddr === 'object' && cAddr ? cAddr.port : 0}`;

    const firstReq = fetch(`${cBase}/api/projects/proj-conc/polish`, { method: 'POST' });
    // give the first request a tick to register itself as in-flight
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondRes = await fetch(`${cBase}/api/projects/proj-conc/polish`, { method: 'POST' });
    expect(secondRes.status).toBe(409);
    const secondBody = await secondRes.json() as { error: string };
    expect(secondBody.error).toBe('polish already running for this project');

    releaseFirst();
    const firstRes = await firstReq;
    expect(firstRes.status).toBe(200);

    cServer!.close();
    cStore.close();
    rmSync(cClaudeDir, { recursive: true, force: true });
  });
});
