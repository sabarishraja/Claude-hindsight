import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { buildEvalView } from '../src/eval/view.js';

let dir: string;
let store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalview-')); store = new Store(':memory:'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('buildEvalView', () => {
  it('returns null measured when there are no fixtures, but still computes observed', () => {
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: null, goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 4, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: [], skillsInvoked: [],
      errorCount: 1, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });
    const view = buildEvalView(store, { fixturesDir: dir, projectDir: 'proj' });
    expect(view.measured).toBeNull();
    expect(view.observed.sessionCount).toBe(1);
    expect(view.observed.endingMix.clean).toBe(1);
  });
});
