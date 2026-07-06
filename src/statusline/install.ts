import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface InstallResult {
  action: 'created' | 'updated' | 'unchanged' | 'refused';
  backupPath: string | null;
  message: string;
}

export function installStatusline(settingsPath: string, command: string, force: boolean): InstallResult {
  let settings: Record<string, unknown> = {};
  const existed = existsSync(settingsPath);

  if (existed) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return {
        action: 'refused', backupPath: null,
        message: `${settingsPath} is not valid JSON; fix it manually and re-run.`,
      };
    }
    const existing = settings['statusLine'] as { command?: string } | undefined;
    if (existing?.command === command) {
      return {
        action: 'unchanged', backupPath: null,
        message: `statusLine already points at claude-hindsight in ${settingsPath}.`,
      };
    }
    if (existing !== undefined && !force) {
      return {
        action: 'refused', backupPath: null,
        message: `A different statusLine is already configured in ${settingsPath}: ` +
          `${JSON.stringify(existing)}. Re-run with --force to replace it.`,
      };
    }
  }

  let backupPath: string | null = null;
  if (existed) {
    backupPath = `${settingsPath}.bak-${Date.now()}`;
    copyFileSync(settingsPath, backupPath);
  }
  settings['statusLine'] = { type: 'command', command };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const undo = backupPath ? ` Previous settings backed up to ${backupPath}.` : '';
  return {
    action: existed ? 'updated' : 'created',
    backupPath,
    message: `${existed ? 'Updated' : 'Created'} ${settingsPath} with the claude-hindsight statusLine.${undo}` +
      ' Restart Claude Code (or start a new session) to see it.',
  };
}
