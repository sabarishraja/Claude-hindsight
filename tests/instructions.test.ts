import { describe, it, expect } from 'vitest';
import { parseInstructions } from '../src/analyzer/instructions.js';

describe('parseInstructions', () => {
  it('extracts bullets as individual instructions with heading context', () => {
    const md = `# Build rules\n- Always use pnpm, never npm\n- Run tests before committing\n`;
    const rules = parseInstructions(md, 'CLAUDE.md');
    expect(rules).toHaveLength(2);
    expect(rules[0].text).toBe('Always use pnpm, never npm');
    expect(rules[0].heading).toBe('Build rules');
    expect(rules[0].line).toBe(2);
    expect(rules[0].id).toBe('CLAUDE.md:2');
  });

  it('folds indented continuation lines into their bullet', () => {
    const md = `- Use the logger module\n  because console.log is banned\n- Second rule here\n`;
    const rules = parseInstructions(md, 'CLAUDE.md');
    expect(rules).toHaveLength(2);
    expect(rules[0].text).toBe('Use the logger module because console.log is banned');
  });

  it('treats paragraphs as instructions and skips headings', () => {
    const md = `# Title\n\nAll API calls must go through the gateway client.\n\n## Sub\n\nNever commit secrets.\n`;
    const rules = parseInstructions(md, 'CLAUDE.md');
    expect(rules.map((r) => r.text)).toEqual([
      'All API calls must go through the gateway client.',
      'Never commit secrets.',
    ]);
    expect(rules[1].heading).toBe('Sub');
  });

  it('folds fenced code blocks into the preceding instruction', () => {
    const md = 'Run the dev server like this:\n```bash\npnpm dev\n```\n';
    const rules = parseInstructions(md, 'CLAUDE.md');
    expect(rules).toHaveLength(1);
    expect(rules[0].text).toContain('pnpm dev');
  });

  it('returns empty for empty or heading-only files', () => {
    expect(parseInstructions('', 'CLAUDE.md')).toEqual([]);
    expect(parseInstructions('# Just a title\n', 'CLAUDE.md')).toEqual([]);
  });
});
