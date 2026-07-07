import { describe, it, expect } from 'vitest';
import { auditInstructions } from '../src/analyzer/audit.js';
import type { Instruction } from '../src/analyzer/instructions.js';
import type { SessionFacts } from '../src/types.js';

const inst = (text: string, line = 1): Instruction =>
  ({ id: `CLAUDE.md:${line}`, text, heading: null, source: 'CLAUDE.md', line });

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'p', cwd: null, goal: 'goal', firstTs: null, lastTs: null,
  messageCount: 2, inputTokens: 100, outputTokens: 10, filesEdited: [], commandsRun: [],
  skillsInvoked: [], errorCount: 0, ending: 'clean', lastUserText: null,
  lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null, ...over,
});

describe('auditInstructions', () => {
  it('flags violated when a negation target appears in commands', () => {
    const report = auditInstructions(
      [inst('Always use `pnpm`, never `npm`')],
      [session({ sessionId: 'sX', commandsRun: ['npm install express'] })],
    );
    expect(report.findings[0].verdict).toBe('violated');
    expect(report.findings[0].evidence[0]).toContain('sX');
    expect(report.findings[0].evidence[0]).toContain('npm install');
  });

  it('flags followed when positive token appears and negation target does not', () => {
    const report = auditInstructions(
      [inst('Always use `pnpm`, never `npm`')],
      [session({ commandsRun: ['pnpm install'] })],
    );
    expect(report.findings[0].verdict).toBe('followed');
  });

  it('does not treat pnpm as a violation of npm (word boundaries)', () => {
    const report = auditInstructions(
      [inst('never use `npm`')],
      [session({ commandsRun: ['pnpm install'] })],
    );
    expect(report.findings[0].verdict).not.toBe('violated');
  });

  it('flags dead when tokens never appear in any session', () => {
    const report = auditInstructions(
      [inst('Use `django-admin` for all migrations')],
      [session({ commandsRun: ['npm test', 'git status'] })],
    );
    expect(report.findings[0].verdict).toBe('dead');
  });

  it('flags unchecked for pure behavioral prose', () => {
    const report = auditInstructions(
      [inst('Be concise and thoughtful in all replies')],
      [session({})],
    );
    expect(report.findings[0].verdict).toBe('unchecked');
  });

  it('prices instructions per session count', () => {
    const text = 'Use `django-admin` for all migrations';
    const report = auditInstructions([inst(text)], [session({}), session({ sessionId: 's2' })]);
    const f = report.findings[0];
    expect(f.estTokens).toBe(Math.ceil(text.length / 4));
    expect(f.estTotalTokens).toBe(f.estTokens * 2);
    expect(f.sessionsChecked).toBe(2);
  });

  it('flags violated for "use A over B" negation pattern', () => {
    const report = auditInstructions(
      [inst('Use `pnpm` over `npm`')],
      [session({ sessionId: 'sX', commandsRun: ['npm install'] })],
    );
    expect(report.findings[0].verdict).toBe('violated');
  });

  it('flags followed for bare single-word tool name in prose (weak token match)', () => {
    const report = auditInstructions(
      [inst('Always run vitest before committing')],
      [session({ commandsRun: ['vitest run'] })],
    );
    expect(report.findings[0].verdict).toBe('followed');
  });

  it('flags unchecked (not dead) for bare single-word tool name with no corpus match', () => {
    const report = auditInstructions(
      [inst('Always run vitest before committing')],
      [session({ commandsRun: ['git status'] })],
    );
    expect(report.findings[0].verdict).toBe('unchecked');
  });

  it('still flags dead for backticked rule with unrelated corpus', () => {
    const report = auditInstructions(
      [inst('Use `django-admin` for migrations')],
      [session({ commandsRun: ['npm test', 'git status'] })],
    );
    expect(report.findings[0].verdict).toBe('dead');
  });
});
