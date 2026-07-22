import { describe, it, expect } from 'vitest';
import { auditSolver } from '../src/eval/solvers.js';
import type { SessionFacts } from '../src/types.js';

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'p', cwd: null, goal: 'g',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
  messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
  filesEdited: [], commandsRun: [], skillsInvoked: [],
  errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null,
  skippedLines: 0, ...over,
});

describe('auditSolver', () => {
  it('maps each rule id to a verdict from auditInstructions', () => {
    const input = {
      markdown: '- Always run `npx vitest run` before committing.',
      source: 'CLAUDE.md',
      sessions: [session({ commandsRun: ['npx vitest run'] })],
    };
    const out = auditSolver.run(input);
    expect(out.get('CLAUDE.md:1')).toBe('followed');
  });

  it('returns one entry per parsed rule', () => {
    const input = {
      markdown: '- Rule one `alpha`.\n- Rule two `beta`.',
      source: 'CLAUDE.md',
      sessions: [session({})],
    };
    expect(auditSolver.run(input).size).toBe(2);
  });
});
