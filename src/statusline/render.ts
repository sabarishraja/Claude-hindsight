import { ANSI, ENDING_LABEL, relativeTime, truncate } from '../terminal/render.js';

export interface LastSessionView {
  when: string | null;
  ending: 'clean' | 'error' | 'abandoned';
  goal: string;
  pendingQuestion: boolean;
}

export interface StatuslineView {
  last: LastSessionView | null;  // null => project has no previous sessions
  indexed: boolean;              // false => no index.db yet
  modelName: string | null;
  costUsd: number | null;
  liveFiles: number;
  liveCommands: number;
  sessionCount: number;
}

const MAX_WIDTH = 110; // keep rows on one line in typical terminals

export function renderStatusline(view: StatuslineView, now: Date = new Date()): string {
  const p = (code: string, t: string) => code + t + ANSI.reset;

  let row1: string;
  if (!view.indexed) {
    row1 = p(ANSI.dim, 'run claude-hindsight to index your session history');
  } else if (!view.last) {
    row1 = p(ANSI.dim, 'no previous sessions here');
  } else {
    const badge = ENDING_LABEL[view.last.ending];
    const head = `◷ ${relativeTime(view.last.when, now)} `;
    const tail = view.last.pendingQuestion ? ' · ⚠ pending question' : '';
    const room = Math.max(20, MAX_WIDTH - head.length - badge.text.length - 3 - tail.length);
    row1 =
      p(ANSI.dim, head) +
      p(badge.color, `[${badge.text}]`) +
      ' ' + truncate(view.last.goal, room) +
      (tail ? p(ANSI.yellow, tail) : '');
  }

  const segments: string[] = [p(ANSI.bold + ANSI.orange, '🕶 Hindsight')];
  if (view.modelName) segments.push(view.modelName);
  if (view.costUsd !== null) segments.push(`$${view.costUsd.toFixed(2)}`);
  segments.push(`${view.liveFiles} files · ${view.liveCommands} cmds`);
  segments.push(p(ANSI.dim, `${view.sessionCount} session${view.sessionCount === 1 ? '' : 's'} indexed`));

  return row1 + '\n' + segments.join(p(ANSI.orange, ' │ '));
}
