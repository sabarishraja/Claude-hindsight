import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGlobalReset, writeGlobalReset } from '../src/statusline/globalReset.js';

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'hindsight-gr-'));
}

describe('readGlobalReset', () => {
  it('returns null when the file is absent', () => {
    expect(readGlobalReset(tmpDataDir())).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    const dataDir = tmpDataDir();
    mkdirSync(join(dataDir, 'statusline'), { recursive: true });
    writeFileSync(join(dataDir, 'statusline', 'global-reset.json'), 'not json {{{');
    expect(readGlobalReset(dataDir)).toBeNull();
  });

  it('returns null when resetAt is missing or the wrong type', () => {
    const dataDir = tmpDataDir();
    mkdirSync(join(dataDir, 'statusline'), { recursive: true });
    writeFileSync(join(dataDir, 'statusline', 'global-reset.json'), JSON.stringify({ resetAt: 12345 }));
    expect(readGlobalReset(dataDir)).toBeNull();

    const dataDir2 = tmpDataDir();
    mkdirSync(join(dataDir2, 'statusline'), { recursive: true });
    writeFileSync(join(dataDir2, 'statusline', 'global-reset.json'), JSON.stringify({}));
    expect(readGlobalReset(dataDir2)).toBeNull();
  });

  it('returns the value from a well-formed file', () => {
    const dataDir = tmpDataDir();
    mkdirSync(join(dataDir, 'statusline'), { recursive: true });
    writeFileSync(
      join(dataDir, 'statusline', 'global-reset.json'),
      JSON.stringify({ resetAt: '2026-07-06T11:12:00Z' }),
    );
    expect(readGlobalReset(dataDir)).toBe('2026-07-06T11:12:00Z');
  });
});

describe('writeGlobalReset', () => {
  it('creates the statusline directory and file when neither exists', () => {
    const dataDir = tmpDataDir();
    writeGlobalReset(dataDir, '2026-07-06T11:12:00Z');
    const raw = readFileSync(join(dataDir, 'statusline', 'global-reset.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ resetAt: '2026-07-06T11:12:00Z' });
  });

  it('overwrites existing content', () => {
    const dataDir = tmpDataDir();
    writeGlobalReset(dataDir, '2026-07-06T11:12:00Z');
    writeGlobalReset(dataDir, '2026-07-06T12:00:00Z');
    const raw = readFileSync(join(dataDir, 'statusline', 'global-reset.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ resetAt: '2026-07-06T12:00:00Z' });
  });

  it('round-trips through readGlobalReset', () => {
    const dataDir = tmpDataDir();
    writeGlobalReset(dataDir, '2026-07-06T11:12:00Z');
    expect(readGlobalReset(dataDir)).toBe('2026-07-06T11:12:00Z');
  });
});
