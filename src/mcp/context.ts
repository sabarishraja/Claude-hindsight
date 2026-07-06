import { resolve } from 'node:path';
import type { Store } from '../indexer/store.js';

export interface ProjectRow {
  projectDir: string;
  cwd: string | null;
  sessionCount: number;
  lastTs: string | null;
}

export type ProjectContext =
  | { ok: true; project: ProjectRow }
  | { ok: false; message: string };

// Same matching rules as cli.ts/statusline.ts: exact cwd match first, then
// "cwd is inside the project directory". Windows path comparisons are
// case-insensitive.
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function isUnder(child: string, parent: string): boolean {
  const c = resolve(child).toLowerCase();
  const p = resolve(parent).toLowerCase();
  return c.startsWith(p + '\\') || c.startsWith(p + '/');
}

export function findProjectForCwd(projects: ProjectRow[], cwd: string): ProjectRow | undefined {
  return (
    projects.find((p) => p.cwd !== null && samePath(p.cwd, cwd)) ??
    projects.find((p) => p.cwd !== null && isUnder(cwd, p.cwd))
  );
}

// Every MCP tool resolves its project through this single function, so "no
// index yet" and "no project for this cwd" are calm, structured results
// everywhere — never a thrown error.
export function resolveProject(store: Store | null, cwd: string): ProjectContext {
  if (!store) {
    return {
      ok: false,
      message: 'claude-hindsight has not indexed any sessions yet. Run `claude-hindsight` once in a terminal first.',
    };
  }
  const project = findProjectForCwd(store.listProjects(), cwd);
  if (!project) {
    return {
      ok: false,
      message: 'No indexed history for this directory yet. Run `claude-hindsight` once in this project first.',
    };
  }
  return { ok: true, project };
}
