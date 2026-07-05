import { describe, it, expect } from 'vitest';
import { polishSession } from '../src/server/polish.js';
import type { SessionFacts } from '../src/types.js';

const facts: SessionFacts = {
  sessionId: 's1', projectDir: 'p', cwd: null, goal: 'fix the login redirect bug in auth module',
  firstTs: null, lastTs: null, messageCount: 8, inputTokens: 0, outputTokens: 0,
  filesEdited: ['auth.ts'], commandsRun: ['npm test'], skillsInvoked: [], errorCount: 0,
  ending: 'clean', lastUserText: null, lastAssistantText: 'Fixed and tests pass.', skippedLines: 0,
};

describe('polishSession', () => {
  it('parses a clean JSON reply', async () => {
    const result = await polishSession(facts, async () =>
      '{"goal": "Fix login redirect bug", "outcome": "Fixed; tests pass"}');
    expect(result).toEqual({ goal: 'Fix login redirect bug', outcome: 'Fixed; tests pass' });
  });

  it('extracts JSON embedded in chatty output', async () => {
    const result = await polishSession(facts, async () =>
      'Sure! Here is the summary:\n{"goal": "Fix bug", "outcome": "Done"}\nHope that helps.');
    expect(result).toEqual({ goal: 'Fix bug', outcome: 'Done' });
  });

  it('returns null on unparseable output', async () => {
    expect(await polishSession(facts, async () => 'no json here')).toBe(null);
  });

  it('returns null when the runner throws', async () => {
    expect(await polishSession(facts, async () => { throw new Error('claude not found'); })).toBe(null);
  });

  it('includes session facts in the prompt', async () => {
    let seen = '';
    await polishSession(facts, async (prompt) => { seen = prompt; return '{}'; });
    expect(seen).toContain('login redirect');
    expect(seen).toContain('auth.ts');
    expect(seen).toContain('npm test');
  });
});
