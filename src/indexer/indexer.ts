import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseLines } from './parseLines.js';
import { extractSessionFacts } from '../analyzer/sessionFacts.js';
import type { Store } from './store.js';

export interface IndexResult { indexed: number; unchanged: number; skippedLines: number; }

export async function indexProjects(
  root: string, store: Store,
  onProgress?: (done: number, total: number) => void,
): Promise<IndexResult> {
  const result: IndexResult = { indexed: 0, unchanged: 0, skippedLines: 0 };
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
        store.upsertSession(facts);
        store.setFileMeta(file, stat.mtimeMs, stat.size);
        result.indexed++;
        result.skippedLines += skipped;
      }
    } catch {
      // unreadable file: skip entirely, never crash the index run
    }
    done++;
    onProgress?.(done, jobs.length);
  }
  return result;
}
