import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface ArchitectureMeta {
  docVersion: number;
  lastRefreshAt: string;
  coveredThroughTs: string | null;
}

export interface ArchitectureDoc {
  markdown: string;
  meta: ArchitectureMeta;
}

// A hash sidesteps every OS path-length/character restriction a raw project
// directory name could hit, and is stable across calls for the same project.
export function projectKey(projectDir: string): string {
  return createHash('sha256').update(projectDir).digest('hex').slice(0, 16);
}

function paths(dataDir: string, projectDir: string) {
  const dir = join(dataDir, 'architecture');
  const key = projectKey(projectDir);
  return { dir, docPath: join(dir, `${key}.md`), metaPath: join(dir, `${key}.json`) };
}

export function readArchitectureDoc(dataDir: string, projectDir: string): ArchitectureDoc | null {
  const { docPath, metaPath } = paths(dataDir, projectDir);
  if (!existsSync(docPath) || !existsSync(metaPath)) return null;
  try {
    const markdown = readFileSync(docPath, 'utf8');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ArchitectureMeta;
    if (typeof meta.docVersion !== 'number' || typeof meta.lastRefreshAt !== 'string') return null;
    return { markdown, meta };
  } catch {
    return null;
  }
}

// Atomic: write to a temp file and rename over the doc only on success, so a
// crash mid-write can never corrupt or delete an existing doc. Meta is
// written only after the doc rename succeeds.
export function writeArchitectureDoc(
  dataDir: string, projectDir: string, markdown: string, meta: ArchitectureMeta,
): void {
  const { dir, docPath, metaPath } = paths(dataDir, projectDir);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${docPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, markdown);
  renameSync(tmpPath, docPath);
  writeFileSync(metaPath, JSON.stringify(meta));
}
