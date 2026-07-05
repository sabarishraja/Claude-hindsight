import type { Instruction } from './instructions.js';
import type { SessionFacts } from '../types.js';

export type Verdict = 'violated' | 'followed' | 'dead' | 'unchecked';

export interface RuleFinding {
  instruction: Instruction;
  verdict: Verdict;
  evidence: string[];
  sessionsChecked: number;
  estTokens: number;
  estTotalTokens: number;
}

export interface AuditReport {
  source: string;
  findings: RuleFinding[];
  totalSessions: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'all', 'use', 'always', 'never', 'not', 'this', 'that', 'with',
  'when', 'you', 'your', 'are', 'must', 'should', 'avoid', 'instead', 'don', 'dont',
  'before', 'after', 'any', 'every', 'from', 'into', 'over', 'via', 'run', 'file',
  'files', 'code', 'project', 'make', 'sure', 'only', 'first', 'then', 'them', 'they',
]);

function backtickSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].toLowerCase().trim());
}

function bareTokens(text: string): string[] {
  const noCode = text.replace(/`[^`]+`/g, ' ');
  return [...noCode.matchAll(/[a-zA-Z][\w@/.-]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((w) => !STOPWORDS.has(w) && /[@/.-]/.test(w));
}

function negationTargets(text: string): string[] {
  const targets: string[] = [];
  const lower = text.toLowerCase();
  const NEG = /(?:never|don't|do not|avoid|instead of|not)\s+(?:use\s+)?`?([a-zA-Z][\w@/.-]{2,})`?/g;
  for (const m of lower.matchAll(NEG)) {
    if (!STOPWORDS.has(m[1])) targets.push(m[1]);
  }
  const BANNED = /`?([a-zA-Z][\w@/.-]{2,})`?\s+is\s+banned/g;
  for (const m of lower.matchAll(BANNED)) targets.push(m[1]);
  return [...new Set(targets)];
}

function wordBoundaryMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w@/.-])${escaped}(?![\\w@/.-])`, 'i').test(haystack);
}

export function auditInstructions(instructions: Instruction[], sessions: SessionFacts[]): AuditReport {
  const corpora = sessions.map((s) => ({
    sessionId: s.sessionId,
    commands: s.commandsRun,
    all: [...s.commandsRun, ...s.filesEdited, ...s.skillsInvoked].join('\n').toLowerCase(),
  }));

  const findings: RuleFinding[] = instructions.map((instruction) => {
    const positives = [...new Set([...backtickSpans(instruction.text), ...bareTokens(instruction.text)])];
    const negatives = negationTargets(instruction.text);
    const positivesOnly = positives.filter((p) => !negatives.includes(p));
    const estTokens = Math.ceil(instruction.text.length / 4);

    let verdict: Verdict = 'unchecked';
    const evidence: string[] = [];

    if (positives.length > 0 || negatives.length > 0) {
      for (const c of corpora) {
        for (const neg of negatives) {
          for (const cmd of c.commands) {
            if (wordBoundaryMatch(cmd, neg)) {
              verdict = 'violated';
              if (evidence.length < 5) evidence.push(`${c.sessionId}: ${cmd.slice(0, 80)}`);
            }
          }
        }
      }
      if (verdict !== 'violated') {
        const anyTokenSeen = corpora.some((c) =>
          [...positivesOnly, ...negatives].some((t) => wordBoundaryMatch(c.all, t)));
        const positiveSeen = corpora.some((c) =>
          positivesOnly.some((t) => wordBoundaryMatch(c.all, t)));
        verdict = positiveSeen ? 'followed' : anyTokenSeen ? 'unchecked' : 'dead';
      }
    }

    return {
      instruction, verdict, evidence,
      sessionsChecked: sessions.length,
      estTokens,
      estTotalTokens: estTokens * sessions.length,
    };
  });

  const source = instructions[0]?.source ?? '';
  return { source, findings, totalSessions: sessions.length };
}
