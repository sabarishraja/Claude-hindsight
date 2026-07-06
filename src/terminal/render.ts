import type { Briefing, BriefingCard } from '../analyzer/briefing.js';

export interface RenderOptions {
  color: boolean;   // ANSI colors + box drawing; false = plain text (hook/pipe mode)
  width?: number;   // panel width, default 72
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  orange: '\x1b[38;5;209m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

const ENDING_LABEL: Record<BriefingCard['ending'], { text: string; color: string }> = {
  clean: { text: 'clean', color: ANSI.green },
  error: { text: 'error', color: ANSI.red },
  abandoned: { text: 'left open', color: ANSI.yellow },
};

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…';
}

// Wraps text to lines of at most `width` chars, breaking on spaces.
function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderBriefing(briefing: Briefing, projectName: string, opts: RenderOptions): string {
  const width = opts.width ?? 72;
  const inner = width - 4; // "│ " + " │"
  const c = opts.color;
  const paint = (code: string, text: string) => (c ? code + text + ANSI.reset : text);

  const lines: string[] = [];
  const push = (text = '') => {
    if (!c) {
      lines.push(text);
      return;
    }
    // pad based on visible length (strip ANSI when measuring)
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = ' '.repeat(Math.max(0, inner - visible.length));
    lines.push(paint(ANSI.orange, '│ ') + text + pad + paint(ANSI.orange, ' │'));
  };
  const rule = (label?: string) => {
    if (!c) {
      lines.push(label ? `--- ${label} ---` : '');
      return;
    }
    const title = label ? ` ${label} ` : '';
    const bar = '─'.repeat(Math.max(0, width - 4 - title.length));
    lines.push(paint(ANSI.orange, `├─${title}${bar}─┤`));
  };

  if (c) {
    const title = 'Claude Hindsight';
    lines.push(
      paint(ANSI.orange, '╭─ ') +
      paint(ANSI.bold + ANSI.orange, title) +
      paint(ANSI.orange, ' ' + '─'.repeat(Math.max(0, width - title.length - 5)) + '╮'),
    );
  } else {
    lines.push(`=== Claude Hindsight: ${projectName} ===`);
  }

  if (c) {
    push(paint(ANSI.bold, projectName) + (briefing.cwd ? paint(ANSI.dim, `  ${truncate(briefing.cwd, inner - projectName.length - 2)}`) : ''));
  }

  if (briefing.leftOff) {
    rule('Where you left off');
    const latest = briefing.cards[0];
    if (latest) {
      const badge = ENDING_LABEL[latest.ending];
      push(`${paint(badge.color, `[${badge.text}]`)} ${paint(ANSI.dim, relativeTime(latest.when))}`);
      for (const l of wrap(latest.goal, inner)) push(l);
      if (latest.outcome) for (const l of wrap(latest.outcome, inner)) push(paint(ANSI.dim, l));
    }
    if (briefing.leftOff.ending === 'abandoned' && briefing.leftOff.lastAssistantText) {
      push('');
      push(paint(ANSI.dim, 'Claude was asking:'));
      for (const l of wrap(truncate(briefing.leftOff.lastAssistantText, 200), inner)) push(l);
    }
  }

  const recent = briefing.cards.slice(1, 6);
  if (recent.length > 0) {
    rule('Recent sessions');
    for (const card of recent) {
      const badge = ENDING_LABEL[card.ending];
      const when = relativeTime(card.when).padEnd(8);
      const stats: string[] = [];
      if (card.filesEdited.length > 0) stats.push(`${card.filesEdited.length} files`);
      if (card.commandCount > 0) stats.push(`${card.commandCount} cmds`);
      const statText = stats.length > 0 ? ` (${stats.join(', ')})` : '';
      const room = inner - when.length - badge.text.length - 3 - statText.length;
      push(`${paint(ANSI.dim, when)} ${truncate(card.goal, Math.max(20, room))}${paint(ANSI.dim, statText)} ${paint(badge.color, `[${badge.text}]`)}`);
    }
  }

  if (briefing.cards.length === 0) {
    push('No sessions with substantive work found for this project yet.');
  }

  rule();
  const total = briefing.cards.length;
  push(paint(ANSI.dim, `${total} session${total === 1 ? '' : 's'} indexed · run with --web for the full dashboard & CLAUDE.md audit`));

  if (c) lines.push(paint(ANSI.orange, `╰${'─'.repeat(width - 2)}╯`));
  return lines.join('\n');
}

export function renderProjectList(
  projects: { projectDir: string; cwd: string | null; sessionCount: number; lastTs: string | null }[],
  opts: RenderOptions,
): string {
  const c = opts.color;
  const paint = (code: string, text: string) => (c ? code + text + ANSI.reset : text);
  const lines = [paint(ANSI.bold, 'No indexed project matches this directory. Projects with history:'), ''];
  for (const p of projects.slice(0, 15)) {
    const name = p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop()! : p.projectDir;
    lines.push(`  ${name.padEnd(30)} ${paint(ANSI.dim, `${p.sessionCount} sessions · ${relativeTime(p.lastTs)}`)}`);
  }
  lines.push('', paint(ANSI.dim, 'cd into one of those directories and re-run, or use --web for the dashboard.'));
  return lines.join('\n');
}
