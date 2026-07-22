import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { snapshotFixture, formatReport } from '../src/eval/cli.js';
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
  });
});
