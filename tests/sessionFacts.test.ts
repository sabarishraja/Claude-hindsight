import { describe, it, expect } from 'vitest';
import { extractSessionFacts } from '../src/analyzer/sessionFacts.js';

const user = (text: string, extra: object = {}) => ({
  type: 'user', timestamp: '2026-07-01T10:00:00Z',
  message: { role: 'user', content: text }, ...extra,
});
const assistant = (content: unknown[], extra: object = {}) => ({
  type: 'assistant', timestamp: '2026-07-01T10:05:00Z',
  message: { role: 'assistant', content, usage: {
    input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 200, output_tokens: 30,
  } }, ...extra,
});

describe('extractSessionFacts', () => {
  it('extracts goal from first substantive user message, skipping short ones', () => {
    const facts = extractSessionFacts([
      user('hi'), // < 20 chars, skipped
      user('please fix the login redirect bug in auth.ts'),
    ], 's1', 'proj', 0);
    expect(facts.goal).toBe('please fix the login redirect bug in auth.ts');
  });

  it('marks sessions with no substantive user message as noise (goal null)', () => {
    const facts = extractSessionFacts([
      { type: 'queue-operation', operation: 'enqueue' },
      user('<system-reminder>injected</system-reminder>'),
    ], 's1', 'proj', 0);
    expect(facts.goal).toBe(null);
  });

  it('ignores sidechain user messages for goal but counts their tokens', () => {
    const facts = extractSessionFacts([
      user('this is the sidechain agent prompt text here', { isSidechain: true }),
      assistant([{ type: 'text', text: 'done' }], { isSidechain: true }),
      user('the real user goal for this session is this'),
    ], 's1', 'proj', 0);
    expect(facts.goal).toBe('the real user goal for this session is this');
    expect(facts.inputTokens).toBe(350);
    expect(facts.messageCount).toBe(1); // only the non-sidechain user record
  });

  it('collects files edited, commands run, and skills from tool_use blocks', () => {
    const facts = extractSessionFacts([
      user('refactor the widget module please and thanks'),
      assistant([
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'C:\\proj\\a.ts' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', id: 't3', name: 'Skill', input: { skill: 'superpowers:brainstorming' } },
      ]),
    ], 's1', 'proj', 0);
    expect(facts.filesEdited).toEqual(['C:\\proj\\a.ts']);
    expect(facts.commandsRun).toEqual(['npm test']);
    expect(facts.skillsInvoked).toEqual(['superpowers:brainstorming']);
  });

  it('detects error ending when is_error tool_result is near the tail', () => {
    const facts = extractSessionFacts([
      user('run the deployment script for staging env'),
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'deploy.sh' } }]),
      { type: 'user', timestamp: '2026-07-01T10:06:00Z', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'exit 1' },
      ] } },
    ], 's1', 'proj', 0);
    expect(facts.errorCount).toBe(1);
    expect(facts.ending).toBe('error');
  });

  it('detects abandoned ending when last assistant text is a question', () => {
    const facts = extractSessionFacts([
      user('help me choose a database for this project'),
      assistant([{ type: 'text', text: 'Do you prefer SQL or NoSQL?' }]),
    ], 's1', 'proj', 0);
    expect(facts.ending).toBe('abandoned');
  });

  it('does not count assistant records that are tool_use-only (no text) toward messageCount', () => {
    const facts = extractSessionFacts([
      user('please refactor the widget module for me thanks'),
      assistant([
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ]),
    ], 's1', 'proj', 0);
    expect(facts.messageCount).toBe(1);
  });

  it('sums tokens and computes timestamps', () => {
    const facts = extractSessionFacts([
      user('add a dark mode toggle to the settings page'),
      assistant([{ type: 'text', text: 'Done. Dark mode toggle added.' }]),
    ], 's1', 'proj', 3);
    expect(facts.inputTokens).toBe(350);
    expect(facts.outputTokens).toBe(30);
    expect(facts.firstTs).toBe('2026-07-01T10:00:00Z');
    expect(facts.lastTs).toBe('2026-07-01T10:05:00Z');
    expect(facts.ending).toBe('clean');
    expect(facts.skippedLines).toBe(3);
  });
});
