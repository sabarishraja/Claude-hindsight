import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { snapshotFixture, formatReport, runEvalCli } from '../src/eval/cli.js';
import { sha256 } from '../src/eval/fixtures.js';
import type { ScoreReport } from '../src/eval/types.js';

let dir: string;
let store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalcli-')); store = new Store(':memory:'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('snapshotFixture', () => {
  it('freezes live sessions into input.json with a matching empty labels.json', () => {
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: null, goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: ['npx vitest run'], skillsInvoked: [],
      errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });
    snapshotFixture(store, 'proj', '- Run `npx vitest run`.', 'CLAUDE.md', dir, 'proj');
    expect(existsSync(join(dir, 'proj.input.json'))).toBe(true);
    const inputText = readFileSync(join(dir, 'proj.input.json'), 'utf8');
    const labels = JSON.parse(readFileSync(join(dir, 'proj.labels.json'), 'utf8'));
    expect(labels.inputSha256).toBe(sha256(inputText));
    expect(labels.labels).toEqual({});
    expect(JSON.parse(inputText).sessions).toHaveLength(1);
  });
});

describe('runEvalCli snapshot', () => {
  it('freezes the current project (sessions + CLAUDE.md) into a fixture', async () => {
    const projectCwd = mkdtempSync(join(tmpdir(), 'evalcli-cwd-'));
    writeFileSync(join(projectCwd, 'CLAUDE.md'), '- Run `npx vitest run`.');
    const claudeDir = mkdtempSync(join(tmpdir(), 'evalcli-claudedir-'));
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: projectCwd, goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: ['npx vitest run'], skillsInvoked: [],
      errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });

    await runEvalCli(['snapshot', 'myfix'], { store, fixturesDir: dir, claudeDir, cwd: projectCwd });

    expect(existsSync(join(dir, 'myfix.input.json'))).toBe(true);
    expect(existsSync(join(dir, 'myfix.labels.json'))).toBe(true);
    const inputText = readFileSync(join(dir, 'myfix.input.json'), 'utf8');
    expect(JSON.parse(inputText).sessions).toHaveLength(1);
    const labels = JSON.parse(readFileSync(join(dir, 'myfix.labels.json'), 'utf8'));
    expect(labels.inputSha256).toBe(sha256(inputText));

    rmSync(projectCwd, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it('does nothing (calmly) when no indexed project matches the cwd', async () => {
    const noMatchCwd = mkdtempSync(join(tmpdir(), 'evalcli-nomatch-'));
    const claudeDir = mkdtempSync(join(tmpdir(), 'evalcli-claudedir2-'));
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: mkdtempSync(join(tmpdir(), 'evalcli-otherproj-')), goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: [], skillsInvoked: [],
      errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });

    await expect(
      runEvalCli(['snapshot', 'myfix'], { store, fixturesDir: dir, claudeDir, cwd: noMatchCwd }),
    ).resolves.not.toThrow();

    expect(existsSync(join(dir, 'myfix.input.json'))).toBe(false);
    expect(existsSync(join(dir, 'myfix.labels.json'))).toBe(false);

    rmSync(noMatchCwd, { recursive: true, force: true });
    rmSync(claudeDir, { recursive: true, force: true });
  });
});

describe('formatReport', () => {
  it('renders confident accuracy and the severity count', () => {
    const report: ScoreReport = {
      ruleCount: 3, confusion: {} as ScoreReport['confusion'],
      confidentTotal: 2, confidentCorrect: 1, confidentAccuracy: 0.5,
      abstentionRate: 0.33, violatedMisses: 1, deadPrecision: null, deadRecall: null,
      orphanedLabels: [], unlabeledRules: [],
    };
    const text = formatReport(report);
    expect(text).toMatch(/confident accuracy/i);
    expect(text).toMatch(/violated misses.*1/i);
    expect(text).toMatch(/confusion matrix/i);
  });
});
