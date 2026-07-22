import { describe, it, expect } from 'vitest';
import { computeObserved } from '../src/eval/observed.js';
import type { SessionFacts } from '../src/types.js';

const s = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'p', cwd: null, goal: 'g',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
  messageCount: 10, inputTokens: 0, outputTokens: 100, rateLimitResetAt: null,
  filesEdited: [], commandsRun: [], skillsInvoked: [],
  errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null,
  skippedLines: 0, ...over,
});

describe('computeObserved', () => {
  it('summarizes ending mix and tool-error density', () => {
    const m = computeObserved([
      s({ sessionId: 'a', ending: 'clean', errorCount: 1, messageCount: 10 }),
      s({ sessionId: 'b', ending: 'error', errorCount: 3, messageCount: 10 }),
    ]);
    expect(m.endingMix).toEqual({ clean: 1, error: 1, abandoned: 0 });
    expect(m.toolErrorDensity).toBeCloseTo(4 / 20);
  });

  it('computes file carry-over rate over adjacent sessions by time', () => {
    // ordered by firstTs ascending: s1 then s2; s2 re-edits 1 of its 2 files from s1
    const m = computeObserved([
      s({ sessionId: 's2', firstTs: '2026-07-02T10:00:00Z', filesEdited: ['A.ts', 'B.ts'] }),
      s({ sessionId: 's1', firstTs: '2026-07-01T10:00:00Z', filesEdited: ['A.ts'] }),
    ]);
    expect(m.fileCarryOverRate).toBeCloseTo(1 / 2);
  });

  it('normalizes file paths case-insensitively for carry-over', () => {
    const m = computeObserved([
      s({ sessionId: 's1', firstTs: '2026-07-01T10:00:00Z', filesEdited: ['src/A.ts'] }),
      s({ sessionId: 's2', firstTs: '2026-07-02T10:00:00Z', filesEdited: ['SRC\\a.ts'] }),
    ]);
    expect(m.fileCarryOverRate).toBe(1);
  });

  it('returns null carry-over when there is only one session', () => {
    expect(computeObserved([s({})]).fileCarryOverRate).toBeNull();
  });
});
