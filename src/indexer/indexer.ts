import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseLines } from './parseLines.js';
import { extractSessionFacts } from '../analyzer/sessionFacts.js';
import { isSelfGeneratedSession } from './selfSessions.js';
import type { Store } from './store.js';

export interface IndexResult { indexed: number; unchanged: number; skippedLines: number; selfSkipped: number; }

export async function indexProjects(
  root: string, store: Store,
  onProgress?: (done: number, total: number) => void,
): Promise<IndexResult> {
  const result: IndexResult = { indexed: 0, unchanged: 0, skippedLines: 0, selfSkipped: 0 };
  if (!existsSync(root)) return result;

  const jobs: { file: string; projectDir: string }[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(root, dir.name);
    for (const entry of readdirSync(dirPath)) {
      if (entry.endsWith('.jsonl')) jobs.push({ file: join(dirPath, entry), projectDir: dir.name });
    }
  }

  let done = 0;
  for (const { file, projectDir } of jobs) {
    try {
      const stat = statSync(file);
      const meta = store.getFileMeta(file);
      if (meta && meta.mtimeMs === stat.mtimeMs && meta.size === stat.size) {
        result.unchanged++;
      } else {
        const { records, skipped } = parseLines(readFileSync(file, 'utf8'));
        const sessionId = basename(file, '.jsonl');
        const facts = extractSessionFacts(records, sessionId, projectDir, skipped);
        if (isSelfGeneratedSession(facts.goal)) {
          // A transcript left behind by Hindsight's own `claude` call — never surface it as
          // the user's work. Purge it if an earlier index version stored it, and still record
          // the file's mtime/size so we don't reparse it on every subsequent run.
          store.deleteSession(sessionId);
          result.selfSkipped++;
        } else {
          store.upsertSession(facts);
          result.indexed++;
          result.skippedLines += skipped;
        }
        store.setFileMeta(file, stat.mtimeMs, stat.size);
      }
    } catch {
      // unreadable file: skip entirely, never crash the index run
    }
    done++;
    onProgress?.(done, jobs.length);
  }
  return result;
}
