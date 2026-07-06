import { describe, it, expect } from 'vitest';
import {
  buildFullPrompt, buildIncrementalPrompt, isValidDoc, trimRecentChanges,
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
});

describe('isValidDoc', () => {
  it('accepts a doc with all four required headings', () => {
    expect(isValidDoc(
      '## What this app does\nx\n## The main parts\nx\n' +
      '## How the pieces work together\nx\n## Recent changes\nx',
    )).toBe(true);
  });

  it('rejects empty output and output missing a heading', () => {
    expect(isValidDoc('')).toBe(false);
    expect(isValidDoc('## What this app does\nx')).toBe(false);
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
