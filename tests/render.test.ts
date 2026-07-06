import { describe, it, expect } from 'vitest';
import { renderBriefing, renderProjectList, relativeTime } from '../src/terminal/render.js';
import type { Briefing, BriefingCard } from '../src/analyzer/briefing.js';

const card = (over: Partial<BriefingCard>): BriefingCard => ({
  sessionId: 's1', goal: 'fix the login redirect bug in the auth module', outcome: null,
  when: '2026-07-05T10:00:00Z', durationMinutes: 30, messageCount: 6, totalTokens: 5000,
  filesEdited: ['a.ts'], commandCount: 2, skillsInvoked: [], ending: 'clean', ...over,
});

const briefing = (cards: BriefingCard[]): Briefing => ({
  projectDir: 'proj', cwd: 'C:\\dev\\proj', cards,
  leftOff: cards.length > 0 ? {
    sessionId: cards[0].sessionId, lastUserText: 'thanks',
    lastAssistantText: 'Should I also update the tests?', ending: cards[0].ending,
  } : null,
  hiddenNoiseSessions: 0,
});

describe('relativeTime', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('formats minutes, hours, days, weeks', () => {
    expect(relativeTime('2026-07-05T11:55:00Z', now)).toBe('5m ago');
    expect(relativeTime('2026-07-05T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-07-03T12:00:00Z', now)).toBe('2d ago');
    expect(relativeTime('2026-06-20T12:00:00Z', now)).toBe('2w ago');
  });
  it('returns empty for null or invalid input', () => {
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime('garbage', now)).toBe('');
  });
});

describe('renderBriefing', () => {
  it('plain mode contains goal, ending, and section labels with no ANSI codes', () => {
    const out = renderBriefing(briefing([card({})]), 'proj', { color: false });
    expect(out).toContain('Claude Hindsight');
    expect(out).toContain('Where you left off');
    expect(out).toContain('login redirect bug');
    expect(out).toContain('[clean]');
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('color mode emits ANSI and box-drawing characters', () => {
    const out = renderBriefing(briefing([card({})]), 'proj', { color: true });
    expect(out).toMatch(/\x1b\[/);
    expect(out).toContain('╭');
    expect(out).toContain('╰');
  });

  it('shows the pending question for abandoned sessions', () => {
    const out = renderBriefing(briefing([card({ ending: 'abandoned' })]), 'proj', { color: false });
    expect(out).toContain('Claude was asking:');
    expect(out).toContain('update the tests?');
  });

  it('lists recent sessions after the first', () => {
    const cards = [
      card({ sessionId: 'new' }),
      card({ sessionId: 'old', goal: 'add dark mode toggle to settings', ending: 'error' }),
    ];
    const out = renderBriefing(briefing(cards), 'proj', { color: false });
    expect(out).toContain('Recent sessions');
    expect(out).toContain('dark mode toggle');
    expect(out).toContain('[error]');
  });

  it('handles empty briefing without crashing', () => {
    const out = renderBriefing(briefing([]), 'proj', { color: false });
    expect(out).toContain('No sessions with substantive work');
  });
});

describe('renderProjectList', () => {
  it('lists project names with session counts', () => {
    const out = renderProjectList(
      [{ projectDir: 'p1', cwd: 'C:\\dev\\alpha', sessionCount: 4, lastTs: '2026-07-01T00:00:00Z' }],
      { color: false },
    );
    expect(out).toContain('alpha');
    expect(out).toContain('4 sessions');
  });
});
