import { describe, it, expect } from 'vitest';
import {
  renderStatusline, formatTokenCount, formatResetCountdown, renderBar, contextSuffix, getContextLimit,
  type StatuslineView,
} from '../src/statusline/render.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const base: StatuslineView = {
  last: null, indexed: true, modelName: 'Fable 5', costUsd: 0.42,
  liveFiles: 3, liveCommands: 12, sessionCount: 47,
  resetMinutesRemaining: null, context: null, oversight: null,
};

describe('formatTokenCount', () => {
  it('formats representative magnitudes', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1500)).toBe('1.5K');
    expect(formatTokenCount(342_000)).toBe('342K');
    expect(formatTokenCount(1_234_567)).toBe('1.2M');
  });
});

describe('formatResetCountdown', () => {
  it('formats minutes-only under an hour', () => {
    expect(formatResetCountdown(0)).toBe('resets in 0m');
    expect(formatResetCountdown(45)).toBe('resets in 45m');
  });

  it('formats hours and minutes at and above 60 minutes', () => {
    expect(formatResetCountdown(60)).toBe('resets in 1h 0m');
    expect(formatResetCountdown(90)).toBe('resets in 1h 30m');
    expect(formatResetCountdown(125)).toBe('resets in 2h 5m');
  });
});

describe('renderBar', () => {
  it('fills proportionally at representative percentages, clamped to 10 chars', () => {
    expect(renderBar(0, 200_000)).toBe('░░░░░░░░░░');
    expect(renderBar(100_000, 200_000)).toBe('█████░░░░░');
    expect(renderBar(125_000, 200_000)).toBe('██████░░░░'); // 6.25 -> rounds to 6
    expect(renderBar(185_000, 200_000)).toBe('█████████░'); // 9.25 -> rounds to 9
    expect(renderBar(200_000, 200_000)).toBe('██████████');
    expect(renderBar(250_000, 200_000)).toBe('██████████'); // over 100%, clamped
  });
});

describe('contextSuffix', () => {
  it('returns the right suffix at representative percentages, boundaries exclusive', () => {
    expect(contextSuffix(50_000, 200_000)).toBe(''); // 25%
    expect(contextSuffix(140_000, 200_000)).toBe(''); // exactly 70%, not > 70
    expect(contextSuffix(140_001, 200_000)).toBe(' (large codebase loaded)'); // just over 70%
    expect(contextSuffix(180_000, 200_000)).toBe(' (large codebase loaded)'); // exactly 90%, not > 90
    expect(contextSuffix(180_001, 200_000)).toBe(' (near limit — consider /compact)'); // just over 90%
  });
});

describe('getContextLimit', () => {
  it('defaults to 200K for any model name, including unknown or null', () => {
    expect(getContextLimit('Fable 5')).toBe(200_000);
    expect(getContextLimit('Some Future Model')).toBe(200_000);
    expect(getContextLimit(null)).toBe(200_000);
  });
});

describe('renderStatusline', () => {
  it('renders two rows with last-session story and live segments when context is absent', () => {
    const view: StatuslineView = {
      ...base,
      last: { when: '2026-07-06T08:00:00Z', ending: 'error', goal: 'fix: strip BOMs from rename script', pendingQuestion: false },
    };
    const out = strip(renderStatusline(view, new Date('2026-07-06T10:00:00Z')));
    const rows = out.split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2h ago');
    expect(rows[0]).toContain('[error]');
    expect(rows[1]).toContain('🕶 Hindsight');
    expect(rows[1]).toContain('Fable 5');
    expect(rows[1]).toContain('$0.42');
    expect(rows[1]).not.toContain('resets in');
    expect(rows[1]).toContain('3 files · 12 cmds');
    expect(rows[1]).toContain('47 sessions indexed');
  });

  it('adds a reset countdown segment when resetMinutesRemaining is set', () => {
    const view: StatuslineView = { ...base, resetMinutesRemaining: 72 };
    const row2 = strip(renderStatusline(view)).split('\n')[1];
    expect(row2).toContain('resets in 1h 12m');
  });

  it('adds a third Context row when context is set, with bar/numbers/suffix', () => {
    const view: StatuslineView = { ...base, context: { used: 168_000, limit: 200_000 } };
    const out = strip(renderStatusline(view));
    const rows = out.split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('Context');
    expect(rows[2]).toContain('168K');
    expect(rows[2]).toContain('200K');
    expect(rows[2]).toContain('large codebase loaded');
  });

  it('omits the Context row entirely when context is null', () => {
    const out = strip(renderStatusline({ ...base, context: null }));
    expect(out.split('\n')).toHaveLength(2);
    expect(out).not.toContain('Context');
  });

  it('flags a pending question for abandoned sessions', () => {
    const view: StatuslineView = {
      ...base,
      last: { when: '2026-07-06T08:00:00Z', ending: 'abandoned', goal: 'add statusline', pendingQuestion: true },
    };
    const row1 = strip(renderStatusline(view)).split('\n')[0];
    expect(row1).toContain('[left open]');
    expect(row1).toContain('⚠ pending question');
  });

  it('handles no previous sessions and no index', () => {
    expect(strip(renderStatusline({ ...base, last: null })).split('\n')[0])
      .toContain('no previous sessions here');
    expect(strip(renderStatusline({ ...base, indexed: false })).split('\n')[0])
      .toContain('run claude-hindsight to index');
  });

  it('omits model/cost segments when absent, and truncates long goals', () => {
    const view: StatuslineView = {
      ...base, modelName: null, costUsd: null,
      last: { when: '2026-07-06T08:00:00Z', ending: 'clean', goal: 'x'.repeat(300), pendingQuestion: false },
    };
    const out = strip(renderStatusline(view));
    const [row1, row2] = out.split('\n');
    expect(row1.length).toBeLessThanOrEqual(120);
    expect(row2).not.toContain('$');
    expect(row2).not.toContain('Fable');
  });

  it('appends an arch-staleness segment to row 1 when set and positive', () => {
    const view: StatuslineView = {
      ...base,
      last: { when: '2026-07-06T08:00:00Z', ending: 'clean', goal: 'ship it', pendingQuestion: false },
      archStaleBy: 3,
    };
    const row1 = strip(renderStatusline(view, new Date('2026-07-06T10:00:00Z'))).split('\n')[0];
    expect(row1).toContain('▲ arch doc 3 sessions behind');
  });

  it('renders the oversight tally with mixed pass/fail counts', () => {
    const row2 = strip(renderStatusline({ ...base, oversight: { pass: 3, fail: 1, lastFailKind: 'tests_pass', extraFailKinds: 0 } })).split('\n')[1];
    expect(row2).toContain('🕵 3✓ 1✗');
  });

  it('omits zero counts within the oversight tally', () => {
    const passOnly = strip(renderStatusline({ ...base, oversight: { pass: 2, fail: 0, lastFailKind: null, extraFailKinds: 0 } })).split('\n')[1];
    expect(passOnly).toContain('🕵 2✓');
    expect(passOnly).not.toContain('✗');
    expect(strip(renderStatusline({ ...base, oversight: { pass: 0, fail: 4, lastFailKind: 'tests_pass', extraFailKinds: 0 } })).split('\n')[1])
      .toContain('🕵 4✗');
  });

  it('colors the fail count red', () => {
    const raw = renderStatusline({ ...base, oversight: { pass: 1, fail: 2, lastFailKind: 'tests_pass', extraFailKinds: 0 } }).split('\n')[1];
    expect(raw).toContain('\x1b[31m2✗');
  });

  it('omits the oversight segment entirely when null', () => {
    expect(strip(renderStatusline(base)).split('\n')[1]).not.toContain('🕵');
  });

  it('omits the arch-staleness segment when zero or unset', () => {
    const view: StatuslineView = {
      ...base,
      last: { when: '2026-07-06T08:00:00Z', ending: 'clean', goal: 'ship it', pendingQuestion: false },
      archStaleBy: 0,
    };
    expect(strip(renderStatusline(view)).split('\n')[0]).not.toContain('arch doc');
    const { archStaleBy: _drop, ...noField } = view;
    expect(strip(renderStatusline(noField)).split('\n')[0]).not.toContain('arch doc');
  });

  it('appends a red failure hint naming the last failed kind', () => {
    const view = { ...base, oversight: { pass: 4, fail: 2, lastFailKind: 'file_created', extraFailKinds: 0 } };
    const row2 = strip(renderStatusline(view)).split('\n')[1];
    expect(row2).toContain('🕵 4✓ 2✗ · file missing');
    const raw = renderStatusline(view).split('\n')[1];
    expect(raw).toContain('\x1b[31m· file missing');
  });

  it('appends +N for other distinct failed kinds', () => {
    const row2 = strip(renderStatusline({
      ...base, oversight: { pass: 1, fail: 3, lastFailKind: 'tests_pass', extraFailKinds: 2 },
    })).split('\n')[1];
    expect(row2).toContain('🕵 1✓ 3✗ · tests failed +2');
  });

  it('shows no hint when the session has no failures', () => {
    const row2 = strip(renderStatusline({
      ...base, oversight: { pass: 2, fail: 0, lastFailKind: null, extraFailKinds: 0 },
    })).split('\n')[1];
    expect(row2).toContain('🕵 2✓');
    expect(row2).not.toContain('failed');
    expect(row2).not.toContain('missing');
  });

  it('falls back to "check failed" for unknown kinds', () => {
    const row2 = strip(renderStatusline({
      ...base, oversight: { pass: 0, fail: 1, lastFailKind: 'quantum_entangled', extraFailKinds: 0 },
    })).split('\n')[1];
    expect(row2).toContain('🕵 1✗ · check failed');
  });
});
