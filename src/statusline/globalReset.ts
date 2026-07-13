import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface GlobalResetState {
  resetAt: string;
}

function statePath(dataDir: string): string {
  return join(dataDir, 'statusline', 'global-reset.json');
}

// Cross-terminal broadcast of the most recently discovered rate-limit reset time, so an
// already-open second terminal picks it up on its next statusline tick without waiting for
// a reindex. Best-effort: any read/write failure degrades to "nothing broadcast" rather than
// throwing, matching every other statusline data source.
export function readGlobalReset(dataDir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(dataDir), 'utf8')) as GlobalResetState;
    return typeof parsed.resetAt === 'string' ? parsed.resetAt : null;
  } catch {
    return null;
  }
}

export function writeGlobalReset(dataDir: string, resetAt: string): void {
  try {
    const p = statePath(dataDir);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ resetAt }));
  } catch {
    // Best-effort broadcast; a failed write just delays propagation, never breaks the render.
  }
}
