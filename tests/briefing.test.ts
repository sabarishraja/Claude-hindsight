import { describe, it, expect } from 'vitest';
import { buildBriefing } from '../src/analyzer/briefing.js';
import type { SessionFacts, PolishResult } from '../src/types.js';

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'p', cwd: 'C:\\proj', goal: 'a substantive goal for the test',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T10:30:00Z', messageCount: 6,
  inputTokens: 5000, outputTokens: 800, filesEdited: ['a.ts'], commandsRun: ['npm test', 'git add .'],
  skillsInvoked: [], errorCount: 0, ending: 'clean', lastUserText: 'thanks',
  lastAssistantText: 'All done.', skippedLines: 0, rateLimitResetAt: null, ...over,
});

describe('buildBriefing', () => {
  it('builds cards newest-first, excluding noise sessions', () => {
    const b = buildBriefing('p', [
      session({ sessionId: 'new', lastTs: '2026-07-02T10:00:00Z' }),
      session({ sessionId: 'noise', goal: null }),
      session({ sessionId: 'old', lastTs: '2026-06-01T10:00:00Z' }),
    ], new Map());
    expect(b.cards.map((c) => c.sessionId)).toEqual(['new', 'old']);
    expect(b.hiddenNoiseSessions).toBe(1);
    expect(b.cwd).toBe('C:\\proj');
  });

  it('computes duration and total tokens', () => {
    const b = buildBriefing('p', [session({})], new Map());
    expect(b.cards[0].durationMinutes).toBe(30);
    expect(b.cards[0].totalTokens).toBe(5800);
    expect(b.cards[0].commandCount).toBe(2);
  });

  it('truncates long goals at a word boundary near 200 chars', () => {
    const long = 'word '.repeat(60).trim(); // 299 chars
    const b = buildBriefing('p', [session({ goal: long })], new Map());
    expect(b.cards[0].goal.length).toBeLessThanOrEqual(201);
    expect(b.cards[0].goal.endsWith('…')).toBe(true);
    expect(b.cards[0].goal).not.toContain('  ');
  });

  it('prefers polished goal and outcome when available', () => {
    const polish = new Map<string, PolishResult>([
      ['s1', { goal: 'Fix the login bug', outcome: 'Fixed and covered by tests' }],
    ]);
    const b = buildBriefing('p', [session({})], polish);
    expect(b.cards[0].goal).toBe('Fix the login bug');
    expect(b.cards[0].outcome).toBe('Fixed and covered by tests');
  });

  it('surfaces where-you-left-off from the newest non-noise session', () => {
    const b = buildBriefing('p', [
      session({ sessionId: 'latest', lastTs: '2026-07-03T10:00:00Z', ending: 'abandoned',
        lastAssistantText: 'Should I proceed with option B?' }),
      session({ sessionId: 'older' }),
    ], new Map());
    expect(b.leftOff?.sessionId).toBe('latest');
    expect(b.leftOff?.lastAssistantText).toContain('option B');
  });

  it('returns null leftOff and empty cards for all-noise projects', () => {
    const b = buildBriefing('p', [session({ goal: null })], new Map());
    expect(b.cards).toEqual([]);
    expect(b.leftOff).toBe(null);
  });
});
