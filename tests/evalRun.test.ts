import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEval, setLabel } from '../src/eval/run.js';
import { sha256 } from '../src/eval/fixtures.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalrun-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const input = {
  markdown: '- Always run `npx vitest run` before committing.',
  source: 'CLAUDE.md',
  sessions: [{
    sessionId: 's1', projectDir: 'p', cwd: null, goal: 'g',
    firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
    messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
    filesEdited: [], commandsRun: ['npx vitest run'], skillsInvoked: [],
    errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
  }],
};

function seed() {
  const inputText = JSON.stringify(input, null, 2);
  writeFileSync(join(dir, 'foo.input.json'), inputText);
  writeFileSync(join(dir, 'foo.labels.json'),
    JSON.stringify({ inputSha256: sha256(inputText), labels: {} }, null, 2));
  return inputText;
}

describe('setLabel', () => {
  it('writes a label without mutating the frozen input file', () => {
    const before = seed();
    setLabel(dir, 'foo', 'CLAUDE.md:1', 'followed');
    expect(readFileSync(join(dir, 'foo.input.json'), 'utf8')).toBe(before); // input untouched
    const labels = JSON.parse(readFileSync(join(dir, 'foo.labels.json'), 'utf8'));
    expect(labels.labels['CLAUDE.md:1']).toBe('followed');
    expect(labels.inputSha256).toBe(sha256(before)); // sha still matches input
  });
});

describe('runEval', () => {
  it('scores a labeled fixture directory end to end', () => {
    seed();
    setLabel(dir, 'foo', 'CLAUDE.md:1', 'followed');
    const r = runEval(dir);
    expect(r.ruleCount).toBe(1);
    expect(r.confidentAccuracy).toBe(1);
    expect(r.orphanedLabels).toEqual([]);
    expect(r.unlabeledRules).toEqual([]);
  });
});
