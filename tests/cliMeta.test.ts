import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USAGE, topLevelIntent, readVersion } from '../src/cliMeta.js';

describe('topLevelIntent', () => {
  it('recognizes --help and -h', () => {
    expect(topLevelIntent(['--help'])).toBe('help');
    expect(topLevelIntent(['-h'])).toBe('help');
    expect(topLevelIntent(['architecture', '--help'])).toBe('help');
  });

  it('recognizes --version and -v', () => {
    expect(topLevelIntent(['--version'])).toBe('version');
    expect(topLevelIntent(['-v'])).toBe('version');
  });

  it('returns null when no meta flag is present', () => {
    expect(topLevelIntent([])).toBeNull();
    expect(topLevelIntent(['--web', '--port', '4756'])).toBeNull();
    expect(topLevelIntent(['eval', 'snapshot', 'demo'])).toBeNull();
  });

  it('prefers help over version when both are present', () => {
    expect(topLevelIntent(['--version', '--help'])).toBe('help');
  });
});

describe('USAGE', () => {
  it('documents the default briefing and the eval subcommands', () => {
    expect(USAGE).toMatch(/claude-hindsight/);
    expect(USAGE).toMatch(/eval snapshot/);
    expect(USAGE).toMatch(/--web/);
    expect(USAGE).toMatch(/--version/);
  });
});

describe('readVersion', () => {
  it('reads the version field from a package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'climeta-'));
    try {
      const p = join(dir, 'package.json');
      writeFileSync(p, JSON.stringify({ name: 'x', version: '9.9.9' }));
      expect(readVersion(p)).toBe('9.9.9');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to a sentinel instead of throwing on a missing/invalid file', () => {
    expect(readVersion(join(tmpdir(), 'does-not-exist-climeta.json'))).toBe('0.0.0-unknown');
  });
});
