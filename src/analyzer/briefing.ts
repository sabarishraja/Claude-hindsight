import type { SessionFacts, PolishResult } from '../types.js';

export interface BriefingCard {
  sessionId: string;
  goal: string;
  outcome: string | null;
  when: string | null;
  durationMinutes: number | null;
  messageCount: number;
  totalTokens: number;
  filesEdited: string[];
  commandCount: number;
  skillsInvoked: string[];
  ending: 'clean' | 'error' | 'abandoned';
}

export interface Briefing {
  projectDir: string;
  cwd: string | null;
  cards: BriefingCard[];
  leftOff: { sessionId: string; lastUserText: string | null; lastAssistantText: string | null; ending: string } | null;
  hiddenNoiseSessions: number;
}

function truncateGoal(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
}

export function buildBriefing(
  projectDir: string, sessions: SessionFacts[], polish: Map<string, PolishResult>,
): Briefing {
  const real = sessions
    .filter((s) => s.goal !== null)
    .sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''));
  const noise = sessions.length - real.length;

  const cards: BriefingCard[] = real.map((s) => {
    const p = polish.get(s.sessionId) ?? null;
    return {
      sessionId: s.sessionId,
      goal: p ? p.goal : truncateGoal(s.goal!),
      outcome: p ? p.outcome : null,
      when: s.lastTs,
      durationMinutes: minutesBetween(s.firstTs, s.lastTs),
      messageCount: s.messageCount,
      totalTokens: s.inputTokens + s.outputTokens,
      filesEdited: s.filesEdited,
      commandCount: s.commandsRun.length,
      skillsInvoked: s.skillsInvoked,
      ending: s.ending,
    };
  });

  const latest = real[0] ?? null;
  return {
    projectDir,
    cwd: sessions.find((s) => s.cwd)?.cwd ?? null,
    cards,
    leftOff: latest ? {
      sessionId: latest.sessionId,
      lastUserText: latest.lastUserText,
      lastAssistantText: latest.lastAssistantText,
      ending: latest.ending,
    } : null,
    hiddenNoiseSessions: noise,
  };
}
