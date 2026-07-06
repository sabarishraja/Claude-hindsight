import { describe, it, expect } from 'vitest';
import { renderStatusline, type StatuslineView } from '../src/statusline/render.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const base: StatuslineView = {
  last: null, indexed: true, modelName: 'Fable 5', costUsd: 0.42,
  liveFiles: 3, liveCommands: 12, sessionCount: 47,
};

describe('renderStatusline', () => {
  it('renders two rows with last-session story and live segments', () => {
    const view: StatuslineView = {
      ...base,
      last: { when: '2026-07-06T08:00:00Z', ending: 'error', goal: 'fix: strip BOMs from rename script', pendingQuestion: false },
    };
    const out = strip(renderStatusline(view, new Date('2026-07-06T10:00:00Z')));
    const [row1, row2] = out.split('\n');
    expect(row1).toContain('2h ago');
    expect(row1).toContain('[error]');
    expect(row1).toContain('fix: strip BOMs from rename script');
    expect(row1).not.toContain('pending question');
    expect(row2).toContain('🕶 Hindsight');
    expect(row2).toContain('Fable 5');
    expect(row2).toContain('$0.42');
    expect(row2).toContain('3 files · 12 cmds');
    expect(row2).toContain('47 sessions indexed');
    expect(out.split('\n')).toHaveLength(2);
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

  it('omits model/cost segments when absent and truncates long goals', () => {
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
});
