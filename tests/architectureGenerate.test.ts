import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for the ENOENT-on-Windows bug: execFile('claude', ...) does not
// resolve npm shims (claude.cmd/claude.ps1) the way a shell does, so defaultRunClaude
// must go through the shell-based `exec`, never `execFile`.
const execMock = vi.fn();
const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => execMock(...args),
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import {
  buildFullPrompt, buildIncrementalPrompt, isValidDoc, trimRecentChanges, defaultRunClaude,
  hasHeading,
} from '../src/architecture/generate.js';

describe('buildFullPrompt', () => {
  it('pins the four required headings and instructs read-only exploration', () => {
    const prompt = buildFullPrompt();
    expect(prompt).toContain('## What this app does');
    expect(prompt).toContain('## The main parts');
    expect(prompt).toContain('## How the pieces work together');
    expect(prompt).toContain('## Recent changes');
    expect(prompt).toContain('Read, Glob, and Grep');
  });

  it('pins the five required headings and instructs read-only exploration', () => {
    const prompt = buildFullPrompt();
    expect(prompt).toContain('## What this app does');
    expect(prompt).toContain('## The main parts');
    expect(prompt).toContain('## How the pieces work together');
    expect(prompt).toContain('## Architecture Diagram');
    expect(prompt).toContain('## Recent changes');
    expect(prompt).toContain('Read, Glob, and Grep');
  });

  it('instructs a small conceptual mermaid flowchart, not a code-derived graph', () => {
    const prompt = buildFullPrompt();
    expect(prompt).toContain('```mermaid');
    expect(prompt).toContain('flowchart');
    expect(prompt).toContain('conceptual');
  });
});

describe('buildIncrementalPrompt', () => {
  it('embeds the previous doc, changed files, and session summaries', () => {
    const prompt = buildIncrementalPrompt(
      '## What this app does\nAn app.\n## Recent changes\n- old entry',
      ['src/a.ts', 'src/b.ts'],
      [{ goal: 'add login', outcome: 'shipped' }],
    );
    expect(prompt).toContain('An app.');
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('src/b.ts');
    expect(prompt).toContain('add login');
    expect(prompt).toContain('shipped');
    expect(prompt).toContain('at most 10 bullets');
  });

  it('handles no changed files or summaries', () => {
    const prompt = buildIncrementalPrompt('doc', [], []);
    expect(prompt).toContain('(none)');
  });

  it('instructs preserving the diagram section alongside the other three', () => {
    const prompt = buildIncrementalPrompt('doc', [], []);
    expect(prompt).toContain('Architecture Diagram');
  });
});

describe('isValidDoc', () => {
  it('accepts a doc with all five required headings', () => {
    expect(isValidDoc(
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n' +
      '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
      '## Recent changes\nx',
    )).toBe(true);
  });

  it('rejects empty output and output missing a heading', () => {
    expect(isValidDoc('')).toBe(false);
    expect(isValidDoc('## What this app does\nx')).toBe(false);
  });

  it('rejects prose containing heading phrases but no actual markdown headings', () => {
    const docWithPhrasesOnly = 'Some text that talks about recent changes and the main parts ' +
      'of the app, discussing how the pieces work together and what this app does, ' +
      'but with no real headings anywhere.';
    expect(isValidDoc(docWithPhrasesOnly)).toBe(false);
  });

  it('rejects a doc with the first four headings but missing the diagram heading', () => {
    expect(isValidDoc(
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n## Recent changes\nx',
    )).toBe(false);
  });

  it('accepts a doc with all five required headings, including the diagram', () => {
    expect(isValidDoc(
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n' +
      '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
      '## Recent changes\nx',
    )).toBe(true);
  });
});

describe('defaultRunClaude', () => {
  beforeEach(() => {
    execMock.mockReset();
    execFileMock.mockReset();
  });

  it('shells out via exec (which resolves npm .cmd/.ps1 shims), never execFile', async () => {
    const stdinEnd = vi.fn();
    execMock.mockImplementation((_command: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, 'doc contents');
      return { stdin: { end: stdinEnd } };
    });

    const out = await defaultRunClaude('a prompt', { cwd: '/proj', tools: true, timeoutMs: 1000 });

    expect(out).toBe('doc contents');
    expect(execFileMock).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledTimes(1);
    const [command, opts] = execMock.mock.calls[0];
    expect(command).toContain('claude -p --output-format text');
    expect(command).toContain('--allowedTools Read Glob Grep');
    expect(opts).toMatchObject({ cwd: '/proj', timeout: 1000, windowsHide: true });
    expect(stdinEnd).toHaveBeenCalledWith('a prompt');
  });

  it('omits --allowedTools when tools is false', async () => {
    execMock.mockImplementation((_command: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, 'doc');
      return { stdin: { end: vi.fn() } };
    });

    await defaultRunClaude('p', { cwd: '/proj', tools: false, timeoutMs: 1000 });

    const [command] = execMock.mock.calls[0];
    expect(command).not.toContain('--allowedTools');
  });
});

describe('hasHeading', () => {
  it('matches a heading case-insensitively regardless of surrounding content', () => {
    expect(hasHeading('## Architecture Diagram\nsome text', 'architecture diagram')).toBe(true);
    expect(hasHeading('## architecture diagram   \nx', 'Architecture Diagram')).toBe(true);
  });

  it('rejects prose mentioning the phrase without a real heading, and missing headings', () => {
    expect(hasHeading('this talks about the architecture diagram but is not one', 'architecture diagram')).toBe(false);
    expect(hasHeading('## Some other heading', 'architecture diagram')).toBe(false);
  });
});

describe('trimRecentChanges', () => {
  const doc = [
    '## What this app does', 'An app.', '',
    '## Recent changes',
    '- newest entry',
    '- second entry',
    '- third entry',
    '',
    '## Unrelated trailing section',
    'untouched',
  ].join('\n');

  it('keeps only the newest N bullets and leaves everything else untouched', () => {
    const out = trimRecentChanges(doc, 2);
    expect(out).toContain('- newest entry');
    expect(out).toContain('- second entry');
    expect(out).not.toContain('- third entry');
    expect(out).toContain('## Unrelated trailing section');
    expect(out).toContain('untouched');
  });

  it('is a no-op when under the cap or when the heading is missing', () => {
    expect(trimRecentChanges(doc, 10)).toBe(doc);
    expect(trimRecentChanges('## No recent changes section here', 2))
      .toBe('## No recent changes section here');
  });
});
