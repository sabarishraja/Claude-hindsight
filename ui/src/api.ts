export interface ProjectSummary { projectDir: string; cwd: string | null; sessionCount: number; lastTs: string | null; }
export interface BriefingCard {
  sessionId: string; goal: string; outcome: string | null; when: string | null;
  durationMinutes: number | null; messageCount: number; totalTokens: number;
  filesEdited: string[]; commandCount: number; skillsInvoked: string[];
  ending: 'clean' | 'error' | 'abandoned';
}
export interface Briefing {
  projectDir: string; cwd: string | null; cards: BriefingCard[];
  leftOff: { sessionId: string; lastUserText: string | null; lastAssistantText: string | null; ending: string } | null;
  hiddenNoiseSessions: number;
}
export interface RuleFinding {
  instruction: { id: string; text: string; heading: string | null; source: string; line: number };
  verdict: 'violated' | 'followed' | 'dead' | 'unchecked';
  evidence: string[]; sessionsChecked: number; estTokens: number; estTotalTokens: number;
}
export interface AuditReport { source: string; findings: RuleFinding[]; totalSessions: number; }

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
};

export const fetchProjects = () => fetch('/api/projects').then((r) => json<ProjectSummary[]>(r));
export const fetchBriefing = (dir: string) =>
  fetch(`/api/projects/${encodeURIComponent(dir)}/briefing`).then((r) => json<Briefing>(r));
export const fetchAudit = () => fetch('/api/audit').then((r) => json<AuditReport[]>(r));
export const runPolish = (dir: string) =>
  fetch(`/api/projects/${encodeURIComponent(dir)}/polish`, { method: 'POST' })
    .then((r) => json<{ polished: number; failed: number }>(r));
