import { describe, it, expect } from 'vitest';
import { isSelfGeneratedSession } from '../src/indexer/selfSessions.js';
import { buildFullPrompt, buildIncrementalPrompt } from '../src/architecture/generate.js';

describe('isSelfGeneratedSession', () => {
  it('recognizes the full architecture-explore prompt', () => {
    expect(isSelfGeneratedSession(buildFullPrompt())).toBe(true);
  });

  it('recognizes the incremental architecture-refresh prompt', () => {
    const prompt = buildIncrementalPrompt('# doc', ['a.ts'], [{ goal: 'do a thing', outcome: null }]);
    expect(isSelfGeneratedSession(prompt)).toBe(true);
  });

  it('recognizes the polish prompt by its opening line', () => {
    // The exact string the polish builder emits first (kept in sync via POLISH_PROMPT_SIGNATURE).
    const polishOpening =
      'You summarize coding-session transcripts. Reply with ONLY a JSON object\n{"goal": "..."}';
    expect(isSelfGeneratedSession(polishOpening)).toBe(true);
  });

  it('tolerates leading whitespace on the transcript message', () => {
    expect(isSelfGeneratedSession('\n\n  ' + buildFullPrompt())).toBe(true);
  });

  it('leaves a genuine user goal untouched', () => {
    expect(isSelfGeneratedSession('Fix the statusline flicker on Windows')).toBe(false);
    expect(isSelfGeneratedSession('You maintain the deploy scripts')).toBe(false);
  });

  it('treats null / empty goals as not self-generated', () => {
    expect(isSelfGeneratedSession(null)).toBe(false);
    expect(isSelfGeneratedSession(undefined)).toBe(false);
    expect(isSelfGeneratedSession('')).toBe(false);
  });
});
