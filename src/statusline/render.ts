import { ANSI, ENDING_LABEL, relativeTime, truncate } from '../terminal/render.js';
import type { OversightStats } from './oversight.js';

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
  resetMinutesRemaining: number | null;  // null => no real, still-future reset time detected
  context: { used: number; limit: number } | null; // null => no assistant turn yet this session
  oversight: OversightStats | null;      // null => nothing verified this session; omit segment
  archStaleBy?: number;          // undefined/0 => no nudge; >0 => sessions behind
}

const MAX_WIDTH = 110; // keep rows on one line in typical terminals

// Short, fixed-width hint for the most recent failed Oversight check.
const OVERSIGHT_FAIL_LABEL: Record<string, string> = {
  tests_pass: 'tests failed',
  build_succeeds: 'build failed',
  lint_clean: 'lint failed',
  file_created: 'file missing',
  file_modified: 'file not changed',
  command_succeeded: 'command failed',
  generic_done: 'claim unverified',
};

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return (n < 10_000 ? k.toFixed(1) : Math.round(k).toString()) + 'K';
  }
  const m = n / 1_000_000;
  return (n < 10_000_000 ? m.toFixed(1) : Math.round(m).toString()) + 'M';
}

export function formatResetCountdown(minutes: number): string {
  if (minutes < 60) return `resets in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `resets in ${h}h ${m}m`;
}

export function renderBar(used: number, limit: number): string {
  const filled = Math.max(0, Math.min(10, Math.round((used / limit) * 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function contextSuffix(used: number, limit: number): string {
  const pct = used / limit;
  if (pct > 0.9) return ' (near limit — consider /compact)';
  if (pct > 0.7) return ' (large codebase loaded)';
  return '';
}

// Empty today: no locally-visible signal distinguishes a model running with the opt-in
// 1M-context beta from one on the 200K default, so every known display name resolves to the
// same safe default below. Add entries here only when a model's *default* (non-beta) context
// window genuinely differs from 200K.
const MODEL_CONTEXT_LIMITS: Record<string, number> = {};
const DEFAULT_CONTEXT_LIMIT = 200_000;

export function getContextLimit(modelName: string | null): number {
  if (modelName && modelName in MODEL_CONTEXT_LIMITS) return MODEL_CONTEXT_LIMITS[modelName];
  return DEFAULT_CONTEXT_LIMIT;
}

function contextColor(used: number, limit: number): string {
  const pct = used / limit;
  if (pct > 0.9) return ANSI.red;
  if (pct > 0.7) return ANSI.yellow;
  return '';
}

export function renderStatusline(view: StatuslineView, now: Date = new Date()): string {
  const p = (code: string, t: string) => code + t + ANSI.reset;

  let row1: string;
  if (!view.indexed) {
    row1 = p(ANSI.dim, 'run claude-hindsight to index your session history');
  } else if (!view.last) {
    row1 = p(ANSI.dim, 'no previous sessions here');
  } else {
    const badge = ENDING_LABEL[view.last.ending] ?? ENDING_LABEL.clean;
    const head = `◷ ${relativeTime(view.last.when, now)} `;
    const tail = view.last.pendingQuestion ? ' · ⚠ pending question' : '';
    const room = Math.max(20, MAX_WIDTH - head.length - badge.text.length - 3 - tail.length);
    row1 =
      p(ANSI.dim, head) +
      p(badge.color, `[${badge.text}]`) +
      ' ' + truncate(view.last.goal, room) +
      (tail ? p(ANSI.yellow, tail) : '');
  }

  if (typeof view.archStaleBy === 'number' && view.archStaleBy > 0) {
    row1 += p(ANSI.yellow, ` · ▲ arch doc ${view.archStaleBy} session${view.archStaleBy === 1 ? '' : 's'} behind`);
  }

  const segments: string[] = [p(ANSI.bold + ANSI.orange, '🕶 Hindsight')];
  if (view.modelName) segments.push(view.modelName);
  if (view.costUsd !== null) segments.push(`$${view.costUsd.toFixed(2)}`);
  if (view.resetMinutesRemaining !== null) segments.push(formatResetCountdown(view.resetMinutesRemaining));
  segments.push(`${view.liveFiles} files · ${view.liveCommands} cmds`);
  if (view.oversight !== null) {
    const parts: string[] = [];
    if (view.oversight.pass > 0) parts.push(`${view.oversight.pass}✓`);
    if (view.oversight.fail > 0) {
      parts.push(p(ANSI.red, `${view.oversight.fail}✗`));
      const label = OVERSIGHT_FAIL_LABEL[view.oversight.lastFailKind ?? ''] ?? 'check failed';
      const extra = view.oversight.extraFailKinds > 0 ? ` +${view.oversight.extraFailKinds}` : '';
      parts.push(p(ANSI.red, `· ${label}${extra}`));
    }
    segments.push(`🕵 ${parts.join(' ')}`);
  }
  segments.push(p(ANSI.dim, `${view.sessionCount} session${view.sessionCount === 1 ? '' : 's'} indexed`));

  const row2 = row1 + '\n' + segments.join(p(ANSI.orange, ' │ '));

  if (view.context === null) return row2;

  const { used, limit } = view.context;
  const color = contextColor(used, limit);
  const bar = color ? p(color, renderBar(used, limit)) : renderBar(used, limit);
  const row3 = `Context  ${bar} ${formatTokenCount(used)}/${formatTokenCount(limit)}${contextSuffix(used, limit)}`;

  return row2 + '\n' + row3;
}
