import type { SessionFacts } from '../types.js';

// Derives "how many sessions behind" the architecture doc is by comparing its
// stored watermark against the session index — no separate tracking needed.
export function computeStaleBy(
  sessions: SessionFacts[],
  coveredThroughTs: string | null,
  currentSessionId?: string,
): number {
  return sessions.filter((s) =>
    s.goal !== null &&
    s.sessionId !== currentSessionId &&
    (coveredThroughTs === null || (s.lastTs !== null && s.lastTs > coveredThroughTs)),
  ).length;
}
