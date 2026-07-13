import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Store } from '../src/indexer/store.js';
import { runStatusline, USAGE } from '../src/statusline/statusline.js';
import { refreshArchitecture } from '../src/architecture/architecture.js';
import type { SessionFacts } from '../src/types.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function facts(over: Partial<SessionFacts>): SessionFacts {
  return {
    sessionId: 'x', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'some goal',
    firstTs: '2026-07-06T08:00:00Z', lastTs: '2026-07-06T09:00:00Z',
    messageCount: 4, inputTokens: 10, outputTokens: 10,
    filesEdited: [], commandsRun: [], skillsInvoked: [], errorCount: 0,
    ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    rateLimitResetAt: null,
    ...over,
  };
}

function setup(): { dataDir: string; transcript: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-sl-'));
  const store = new Store(join(dataDir, 'index.db'));
  store.upsertSession(facts({
    sessionId: 'prev', goal: 'refactor the indexer', ending: 'abandoned',
    lastAssistantText: 'Should I also update the tests?',
  }));
  store.upsertSession(facts({
    sessionId: 'current', goal: 'goal of the running session', lastTs: '2026-07-06T10:00:00Z',
  }));
  store.close();
  const transcript = join(dataDir, 'live.jsonl');
  writeFileSync(transcript, JSON.stringify({
    type: 'assistant',
    message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } },
    ] },
  }) + '\n');
  return { dataDir, transcript };
}

const stdinFor = (dataDir: string, transcript: string) => JSON.stringify({
  session_id: 'current',
  transcript_path: transcript,
  workspace: { current_dir: 'C:\\work\\app', project_dir: 'C:\\work\\app' },
  model: { display_name: 'Fable 5' },
  cost: { total_cost_usd: 0.1234 },
});

describe('runStatusline', () => {
  it('shows the previous session on row 1, never the current one', () => {
    const { dataDir, transcript } = setup();
    const out = strip(runStatusline(stdinFor(dataDir, transcript), dataDir));
    const [row1, row2] = out.split('\n');
    expect(row1).toContain('refactor the indexer');
    expect(row1).toContain('[left open]');
    expect(row1).toContain('⚠ pending question');
    expect(row1).not.toContain('goal of the running session');
    expect(row2).toContain('Fable 5');
    expect(row2).toContain('$0.12');
    expect(row2).toContain('1 files · 1 cmds');
    expect(row2).toContain('2 sessions indexed');
  });

  it('matches a subdirectory of the project cwd', () => {
    const { dataDir, transcript } = setup();
    const stdin = JSON.stringify({
      ...JSON.parse(stdinFor(dataDir, transcript)) as object,
      workspace: { current_dir: 'C:\\work\\app\\src', project_dir: 'C:\\work\\app\\src' },
    });
    expect(strip(runStatusline(stdin, dataDir))).toContain('refactor the indexer');
  });

  it('shows the oversight tally when the project has verification history for this session', () => {
    const { dataDir, transcript } = setup();
    const cwd = mkdtempSync(join(tmpdir(), 'hindsight-ov-'));
    mkdirSync(join(cwd, '.oversight'), { recursive: true });
    writeFileSync(join(cwd, '.oversight', 'history.jsonl'), JSON.stringify({
      ts: 1720000000.5, session_id: 'current', claim: 'done', decision: 'allow',
      results: [
        { kind: 'tests', target: 'npm test', status: 'pass', source: 't', detail: '' },
        { kind: 'tests', target: 'npm test', status: 'pass', source: 't', detail: '' },
        { kind: 'build', target: 'npm run build', status: 'fail', source: 'b', detail: '' },
      ],
    }) + '\n');
    const stdin = JSON.stringify({
      ...JSON.parse(stdinFor(dataDir, transcript)) as object,
      workspace: { current_dir: cwd, project_dir: cwd },
    });
    expect(strip(runStatusline(stdin, dataDir))).toContain('🕵 2✓ 1✗');
  });

  it('omits the oversight tally when history only covers other sessions', () => {
    const { dataDir, transcript } = setup();
    const cwd = mkdtempSync(join(tmpdir(), 'hindsight-ov-'));
    mkdirSync(join(cwd, '.oversight'), { recursive: true });
    writeFileSync(join(cwd, '.oversight', 'history.jsonl'), JSON.stringify({
      ts: 1, session_id: 'some-other-session', claim: 'x', decision: 'block',
      results: [{ kind: 'tests', target: 't', status: 'fail', source: '', detail: '' }],
    }) + '\n');
    const stdin = JSON.stringify({
      ...JSON.parse(stdinFor(dataDir, transcript)) as object,
      workspace: { current_dir: cwd, project_dir: cwd },
    });
    expect(strip(runStatusline(stdin, dataDir))).not.toContain('🕵');
  });

  it('omits the oversight tally when no history file exists', () => {
    const { dataDir, transcript } = setup();
    expect(strip(runStatusline(stdinFor(dataDir, transcript), dataDir))).not.toContain('🕵');
  });

  it('returns usage for bad or missing stdin', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-sl-'));
    expect(runStatusline('', dataDir)).toBe(USAGE);
    expect(runStatusline('not json', dataDir)).toBe(USAGE);
    expect(runStatusline('{}', dataDir)).toBe(USAGE);
  });

  it('renders a hint row when there is no index.db', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-sl-'));
    mkdirSync(dataDir, { recursive: true });
    const out = strip(runStatusline(JSON.stringify({ session_id: 's1' }), dataDir));
    expect(out.split('\n')[0]).toContain('run claude-hindsight to index');
    expect(out.split('\n')[1]).toContain('🕶 Hindsight');
  });

  it('never writes to the index db, even across a version bump', () => {
    const { dataDir, transcript } = setup();
    const dbPath = join(dataDir, 'index.db');

    // Simulate a version-skewed db with a marker row, using better-sqlite3 directly.
    const raw = new Database(dbPath);
    raw.pragma('user_version = 999');
    raw.prepare("INSERT INTO files (path, mtimeMs, size) VALUES ('m', 1, 1)").run();
    raw.close();

    runStatusline(stdinFor(dataDir, transcript), dataDir);

    const check = new Database(dbPath, { readonly: true });
    const marker = check.prepare("SELECT * FROM files WHERE path = 'm'").get();
    const version = check.pragma('user_version', { simple: true });
    check.close();
    expect(marker).toBeDefined();
    expect(version).toBe(999);
  });

  it('sanitizes session_id and never escapes the statusline state dir', () => {
    const { dataDir, transcript } = setup();
    const stdin = JSON.stringify({
      ...JSON.parse(stdinFor(dataDir, transcript)) as object,
      session_id: '..\\..\\escape',
    });
    const out = strip(runStatusline(stdin, dataDir));
    const rows = out.split('\n');
    expect(rows.length).toBe(2);

    const entries = readdirSync(dataDir);
    const allowed = /^(index\.db(-shm|-wal)?|statusline|live\.jsonl)$/;
    for (const entry of entries) {
      expect(entry).toMatch(allowed);
    }
    const statuslineDir = join(dataDir, 'statusline');
    if (existsSync(statuslineDir)) {
      expect(readdirSync(statuslineDir)).toEqual([]);
    }
  });

  it('adds the arch-staleness segment when an architecture doc has fallen behind', async () => {
    const { dataDir, transcript } = setup();
    const VALID_DOC =
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n' +
      '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
      '## Recent changes\n- did a thing';
    const store = new Store(join(dataDir, 'index.db'));
    await refreshArchitecture(store, 'proj', { dataDir, runner: async () => VALID_DOC });
    store.upsertSession(facts({
      sessionId: 'prev2', goal: 'a later prev session', lastTs: '2026-07-06T10:30:00Z',
    }));
    store.close();

    const row1 = strip(runStatusline(stdinFor(dataDir, transcript), dataDir)).split('\n')[0];
    expect(row1).toContain('arch doc 1 session behind');
  });

  it('surfaces a reset countdown when the most recent detected reset time is still in the future', () => {
    const { dataDir, transcript } = setup();
    const store = new Store(join(dataDir, 'index.db'));
    store.upsertSession(facts({
      sessionId: 'reset-hit', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'hit a limit',
      lastTs: '2026-07-06T09:00:00Z', rateLimitResetAt: '2026-07-06T11:12:00Z',
    }));
    store.close();

    const now = () => new Date('2026-07-06T10:00:00Z');
    const row2 = strip(runStatusline(stdinFor(dataDir, transcript), dataDir, now)).split('\n')[1];
    expect(row2).toContain('resets in 1h 12m');
  });

  it('does not show a reset countdown when the most recent detected reset time is already past', () => {
    const { dataDir, transcript } = setup();
    const store = new Store(join(dataDir, 'index.db'));
    store.upsertSession(facts({
      sessionId: 'old-reset', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'old limit hit',
      lastTs: '2026-07-06T05:00:00Z', rateLimitResetAt: '2026-07-06T09:00:00Z',
    }));
    store.close();

    const now = () => new Date('2026-07-06T10:00:00Z');
    const row2 = strip(runStatusline(stdinFor(dataDir, transcript), dataDir, now)).split('\n')[1];
    expect(row2).not.toContain('resets in');
  });

  it('renders a Context row from the live session\'s latest usage snapshot', () => {
    const { dataDir } = setup();
    const transcript = join(dataDir, 'ctx.jsonl');
    writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 168_000, output_tokens: 50 } },
    }) + '\n');
    const stdin = JSON.stringify({
      session_id: 'current', transcript_path: transcript,
      workspace: { current_dir: 'C:\\work\\app', project_dir: 'C:\\work\\app' },
      model: { display_name: 'Fable 5' }, cost: { total_cost_usd: 0.1 },
    });
    const out = strip(runStatusline(stdin, dataDir));
    const rows = out.split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('Context');
    expect(rows[2]).toContain('168K');
    expect(rows[2]).toContain('200K');
  });

  it('shows both the reset countdown and the Context row together when both are live in the same session', () => {
    const { dataDir } = setup();
    const transcript = join(dataDir, 'combined.jsonl');
    writeFileSync(transcript, [
      JSON.stringify({
        type: 'assistant', timestamp: '2026-07-06T09:48:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: "You've hit your session limit · resets 11:12am (UTC)" }],
        },
        error: 'rate_limit', isApiErrorMessage: true,
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [], usage: { input_tokens: 168_000, output_tokens: 50 } },
      }),
    ].join('\n') + '\n');

    const stdin = JSON.stringify({
      session_id: 'current', transcript_path: transcript,
      workspace: { current_dir: 'C:\\work\\app', project_dir: 'C:\\work\\app' },
      model: { display_name: 'Fable 5' }, cost: { total_cost_usd: 0.1 },
    });

    const now = () => new Date('2026-07-06T10:00:00Z');
    const out = strip(runStatusline(stdin, dataDir, now));
    const rows = out.split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('resets in 1h 12m');
    expect(rows[2]).toContain('Context');
    expect(rows[2]).toContain('168K');
  });

  it('omits the Context row when the live session has no assistant usage yet', () => {
    const { dataDir } = setup();
    const transcript = join(dataDir, 'ctx2.jsonl');
    writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    }) + '\n');
    const stdin = JSON.stringify({
      session_id: 'current', transcript_path: transcript,
      workspace: { current_dir: 'C:\\work\\app', project_dir: 'C:\\work\\app' },
    });
    const out = strip(runStatusline(stdin, dataDir));
    expect(out.split('\n')).toHaveLength(2);
  });

  it('shows a reset countdown from a pre-existing global broadcast file alone', () => {
    const { dataDir, transcript } = setup();
    mkdirSync(join(dataDir, 'statusline'), { recursive: true });
    writeFileSync(
      join(dataDir, 'statusline', 'global-reset.json'),
      JSON.stringify({ resetAt: '2026-07-06T11:12:00Z' }),
    );

    const now = () => new Date('2026-07-06T10:00:00Z');
    const row2 = strip(runStatusline(stdinFor(dataDir, transcript), dataDir, now)).split('\n')[1];
    expect(row2).toContain('resets in 1h 12m');
  });

  it('writes a newly-discovered live reset time to the global broadcast file', () => {
    const { dataDir } = setup();
    const transcript = join(dataDir, 'reset-live.jsonl');
    writeFileSync(transcript, JSON.stringify({
      type: 'assistant', timestamp: '2026-07-06T09:48:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: "You've hit your session limit · resets 11:12am (UTC)" }],
      },
      error: 'rate_limit', isApiErrorMessage: true,
    }) + '\n');

    const stdin = JSON.stringify({
      session_id: 'current', transcript_path: transcript,
      workspace: { current_dir: 'C:\\work\\app', project_dir: 'C:\\work\\app' },
    });

    const now = () => new Date('2026-07-06T10:00:00Z');
    runStatusline(stdin, dataDir, now);

    const broadcast = JSON.parse(
      readFileSync(join(dataDir, 'statusline', 'global-reset.json'), 'utf8'),
    ) as { resetAt: string };
    expect(broadcast.resetAt).toBe('2026-07-06T11:12:00.000Z');
  });

  it('does not let an older DB/live reset overwrite a fresher broadcast value', () => {
    const { dataDir, transcript } = setup();
    const store = new Store(join(dataDir, 'index.db'));
    store.upsertSession(facts({
      sessionId: 'older-reset', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'old limit hit',
      lastTs: '2026-07-06T09:00:00Z', rateLimitResetAt: '2026-07-06T11:12:00Z',
    }));
    store.close();

    mkdirSync(join(dataDir, 'statusline'), { recursive: true });
    writeFileSync(
      join(dataDir, 'statusline', 'global-reset.json'),
      JSON.stringify({ resetAt: '2026-07-06T13:00:00Z' }),
    );

    const now = () => new Date('2026-07-06T10:00:00Z');
    const row2 = strip(runStatusline(stdinFor(dataDir, transcript), dataDir, now)).split('\n')[1];
    expect(row2).toContain('resets in 3h 0m');

    const broadcast = JSON.parse(
      readFileSync(join(dataDir, 'statusline', 'global-reset.json'), 'utf8'),
    ) as { resetAt: string };
    expect(broadcast.resetAt).toBe('2026-07-06T13:00:00Z');
  });
});
