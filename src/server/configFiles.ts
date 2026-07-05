import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ClaudeMdFile {
  source: string;            // absolute path, used as Instruction.source
  markdown: string;
  projectDir: string | null; // null = global scope
}

export function discoverClaudeMds(
  claudeDir: string,
  projects: { projectDir: string; cwd: string | null }[],
): ClaudeMdFile[] {
  const out: ClaudeMdFile[] = [];
  const globalPath = join(claudeDir, 'CLAUDE.md');
  if (existsSync(globalPath)) {
    out.push({ source: globalPath, markdown: readFileSync(globalPath, 'utf8'), projectDir: null });
  }
  for (const p of projects) {
    if (!p.cwd) continue;
    const projPath = join(p.cwd, 'CLAUDE.md');
    if (existsSync(projPath)) {
      out.push({ source: projPath, markdown: readFileSync(projPath, 'utf8'), projectDir: p.projectDir });
    }
  }
  return out;
}
