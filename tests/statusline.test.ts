import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { runStatusline, USAGE } from '../src/statusline/statusline.js';
import type { SessionFacts } from '../src/types.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function facts(over: Partial<SessionFacts>): SessionFacts {
  return {
    sessionId: 'x', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'some goal',
    firstTs: '2026-07-06T08:00:00Z', lastTs: '2026-07-06T09:00:00Z',
    messageCount: 4, inputTokens: 10, outputTokens: 10,
    filesEdited: [], commandsRun: [], skillsInvoked: [], errorCount: 0,
    ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
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
    expect(row2).toContain('1 session indexed');
  });

  it('matches a subdirectory of the project cwd', () => {
    const { dataDir, transcript } = setup();
    const stdin = JSON.stringify({
      ...JSON.parse(stdinFor(dataDir, transcript)) as object,
      workspace: { current_dir: 'C:\\work\\app\\src', project_dir: 'C:\\work\\app\\src' },
    });
    expect(strip(runStatusline(stdin, dataDir))).toContain('refactor the indexer');
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
});
