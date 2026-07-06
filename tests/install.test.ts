import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStatusline } from '../src/statusline/install.js';

const CMD = 'node "C:\\tools\\dist\\cli.js" statusline';

describe('installStatusline', () => {
  it('creates settings.json (and parent dir) when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-install-'));
    const path = join(dir, '.claude', 'settings.json');
    const result = installStatusline(path, CMD, false);
    expect(result.action).toBe('created');
    expect(result.backupPath).toBeNull();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      statusLine: { type: 'command', command: CMD },
    });
  });

  it('merges into existing settings, preserving other keys, with a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-install-'));
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ model: 'opus' }));
    const result = installStatusline(path, CMD, false);
    expect(result.action).toBe('updated');
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      model: 'opus',
      statusLine: { type: 'command', command: CMD },
    });
  });

  it('refuses when a different statusLine exists, unless --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-install-'));
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ statusLine: { type: 'command', command: 'other' } }));
    const refused = installStatusline(path, CMD, false);
    expect(refused.action).toBe('refused');
    expect(JSON.parse(readFileSync(path, 'utf8')).statusLine.command).toBe('other');
    const forced = installStatusline(path, CMD, true);
    expect(forced.action).toBe('updated');
    expect(JSON.parse(readFileSync(path, 'utf8')).statusLine.command).toBe(CMD);
  });

  it('is a no-op when already installed, and refuses invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hindsight-install-'));
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ statusLine: { type: 'command', command: CMD } }));
    expect(installStatusline(path, CMD, false).action).toBe('unchanged');

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(installStatusline(bad, CMD, false).action).toBe('refused');
    expect(readFileSync(bad, 'utf8')).toBe('{ not json'); // untouched
  });
});
