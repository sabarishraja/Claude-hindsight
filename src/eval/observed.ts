import type { SessionFacts } from '../types.js';

export interface ObservedMetrics {
  sessionCount: number;
  endingMix: { clean: number; error: number; abandoned: number };
  toolErrorDensity: number | null;
  fileCarryOverRate: number | null;
  costPerEndingOutcome: { clean: number | null; error: number | null; abandoned: number | null };
}

// Windows path comparisons are case-insensitive and slash-normalized project-wide.
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function meanCost(sessions: SessionFacts[]): number | null {
  if (sessions.length === 0) return null;
  const sum = sessions.reduce((a, x) => a + x.inputTokens + x.outputTokens, 0);
  return sum / sessions.length;
}

export function computeObserved(sessions: SessionFacts[]): ObservedMetrics {
  const endingMix = { clean: 0, error: 0, abandoned: 0 };
  for (const s of sessions) endingMix[s.ending]++;

  const totalErrors = sessions.reduce((a, s) => a + s.errorCount, 0);
  const totalMessages = sessions.reduce((a, s) => a + s.messageCount, 0);

  // Oldest-first so "preceding session" is well defined; nulls (empty-string keys) sort first.
  const chron = [...sessions].sort((a, b) => (a.firstTs ?? '').localeCompare(b.firstTs ?? ''));
  let carrySum = 0, carryPairs = 0;
  for (let i = 1; i < chron.length; i++) {
    const cur = chron[i].filesEdited.map(normPath);
    if (cur.length === 0) continue;
    const prev = new Set(chron[i - 1].filesEdited.map(normPath));
    const overlap = cur.filter((f) => prev.has(f)).length;
    carrySum += overlap / cur.length;
    carryPairs++;
  }

  return {
    sessionCount: sessions.length,
    endingMix,
    toolErrorDensity: totalMessages === 0 ? null : totalErrors / totalMessages,
    fileCarryOverRate: carryPairs === 0 ? null : carrySum / carryPairs,
    costPerEndingOutcome: {
      clean: meanCost(sessions.filter((s) => s.ending === 'clean')),
      error: meanCost(sessions.filter((s) => s.ending === 'error')),
      abandoned: meanCost(sessions.filter((s) => s.ending === 'abandoned')),
    },
  };
}
