import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStatusline, statuslineInstallCommand } from '../src/statusline/install.js';

const CMD = 'node "C:\\tools\\dist\\cli.js" statusline';

describe('statuslineInstallCommand', () => {
  it('writes a portable npx command by default (no @latest, so it stays offline)', () => {
    const cmd = statuslineInstallCommand(false, 'C:\\anywhere\\_npx\\abc\\cli.js');
    expect(cmd).toBe('npx -y claude-hindsight statusline');
    expect(cmd).not.toContain('@latest'); // the per-message hot path must not version-check
    expect(cmd).not.toContain('_npx');    // never bake in an ephemeral npx cache path
  });

  it('writes an absolute local path when --local, for developing against a build', () => {
    expect(statuslineInstallCommand(true, 'C:\\dev\\dist\\cli.js'))
      .toBe('node "C:\\dev\\dist\\cli.js" statusline');
  });
});

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
