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

function strongBareTokens(text: string): string[] {
  const noCode = text.replace(/`[^`]+`/g, ' ');
  return [...noCode.matchAll(/[a-zA-Z][\w@/.-]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((w) => !STOPWORDS.has(w) && /[@/.\d-]/.test(w));
}

function weakBareTokens(text: string): string[] {
  const noCode = text.replace(/`[^`]+`/g, ' ');
  return [...noCode.matchAll(/[a-zA-Z][\w@/.-]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .filter((w) => !STOPWORDS.has(w) && !/[@/.\d-]/.test(w) && w.length >= 3);
}

function negationTargets(text: string): string[] {
  const targets: string[] = [];
  const lower = text.toLowerCase();
  const NEG = /(?:never|don't|do not|avoid|instead of|not)\s+(?:use\s+)?`?([a-zA-Z][\w@/.-]{2,})`?/g;
  for (const m of lower.matchAll(NEG)) {
    if (!STOPWORDS.has(m[1])) targets.push(m[1]);
  }
  // "use A over B" / "use A, not B" -> B is a negation target
  const USE_OVER = /use\s+`?([a-zA-Z][\w@/.-]{2,})`?\s*,?\s*(?:over|not)\s+`?([a-zA-Z][\w@/.-]{2,})`?/g;
  for (const m of lower.matchAll(USE_OVER)) {
    if (!STOPWORDS.has(m[2])) targets.push(m[2]);
  }
  const BANNED = /`?([a-zA-Z][\w@/.-]{2,})`?\s+is\s+banned/g;
  for (const m of lower.matchAll(BANNED)) {
    if (!STOPWORDS.has(m[1])) targets.push(m[1]);
  }
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
    const strong = [...new Set([...backtickSpans(instruction.text), ...strongBareTokens(instruction.text)])];
    const weak = [...new Set(weakBareTokens(instruction.text))].filter((w) => !strong.includes(w));
    const negatives = negationTargets(instruction.text);
    const strongPositivesOnly = strong.filter((p) => !negatives.includes(p));
    const weakPositivesOnly = weak.filter((p) => !negatives.includes(p));
    const estTokens = Math.ceil(instruction.text.length / 4);

    let verdict: Verdict = 'unchecked';
    const evidence: string[] = [];

    if (strong.length > 0 || weak.length > 0 || negatives.length > 0) {
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
        const positiveSeen = corpora.some((c) =>
          [...strongPositivesOnly, ...weakPositivesOnly].some((t) => wordBoundaryMatch(c.all, t)));
        const anyTokenSeen = corpora.some((c) =>
          [...strongPositivesOnly, ...weakPositivesOnly, ...negatives].some((t) => wordBoundaryMatch(c.all, t)));
        if (positiveSeen) {
          verdict = 'followed';
        } else if (strongPositivesOnly.length > 0 && !anyTokenSeen) {
          verdict = 'dead';
        } else {
          verdict = 'unchecked';
        }
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
