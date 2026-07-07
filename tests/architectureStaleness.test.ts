import { describe, it, expect } from 'vitest';
import { computeStaleBy } from '../src/architecture/staleness.js';
import type { SessionFacts } from '../src/types.js';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'p', cwd: null, goal: 'do work',
  firstTs: null, lastTs: '2026-07-01T00:00:00Z', messageCount: 1,
  inputTokens: 0, outputTokens: 0, filesEdited: [], commandsRun: [],
  skillsInvoked: [], errorCount: 0, ending: 'clean',
  lastUserText: null, lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null,
  ...over,
});

describe('computeStaleBy', () => {
  it('counts real sessions newer than the watermark', () => {
    const sessions = [
      facts({ sessionId: 'a', lastTs: '2026-07-01T00:00:00Z' }),
      facts({ sessionId: 'b', lastTs: '2026-07-02T00:00:00Z' }),
      facts({ sessionId: 'c', lastTs: '2026-07-03T00:00:00Z' }),
    ];
    expect(computeStaleBy(sessions, '2026-07-01T00:00:00Z')).toBe(2);
  });

  it('counts everything when there is no watermark yet', () => {
    const sessions = [facts({ sessionId: 'a' }), facts({ sessionId: 'b' })];
    expect(computeStaleBy(sessions, null)).toBe(2);
  });

  it('excludes noise sessions (goal null) and the current session', () => {
    const sessions = [
      facts({ sessionId: 'noise', goal: null, lastTs: '2026-07-05T00:00:00Z' }),
      facts({ sessionId: 'current', lastTs: '2026-07-05T00:00:00Z' }),
      facts({ sessionId: 'real', lastTs: '2026-07-05T00:00:00Z' }),
    ];
    expect(computeStaleBy(sessions, '2026-07-01T00:00:00Z', 'current')).toBe(1);
  });

  it('returns 0 when nothing is newer than the watermark', () => {
    const sessions = [facts({ sessionId: 'a', lastTs: '2026-07-01T00:00:00Z' })];
    expect(computeStaleBy(sessions, '2026-07-01T00:00:00Z')).toBe(0);
  });
});
