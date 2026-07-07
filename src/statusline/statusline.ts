import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from '../indexer/store.js';
import { buildBriefing } from '../analyzer/briefing.js';
import { updateLiveStats } from './liveSession.js';
import { renderStatusline, type StatuslineView } from './render.js';
import { getArchitectureView } from '../architecture/architecture.js';
import type { PolishResult } from '../types.js';

interface StdinData {
  session_id?: string;
  transcript_path?: string;
  workspace?: { current_dir?: string; project_dir?: string };
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number };
}

export const USAGE =
  'claude-hindsight statusline: expects Claude Code status JSON on stdin. ' +
  'Set it up with: claude-hindsight statusline --install';

type ProjectRow = { projectDir: string; cwd: string | null; sessionCount: number; lastTs: string | null };

const TOKEN_WINDOW_MS = 5 * 60 * 60 * 1000;

// Same matching rules as the terminal briefing in cli.ts: exact cwd match
// first, then "cwd is inside the project directory". Windows-insensitive.
export function findProjectForCwd(projects: ProjectRow[], cwd: string): ProjectRow | undefined {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  const isUnder = (child: string, parent: string) =>
    norm(child).startsWith(norm(parent) + '\\') || norm(child).startsWith(norm(parent) + '/');
  return (
    projects.find((p) => p.cwd !== null && norm(p.cwd) === norm(cwd)) ??
    projects.find((p) => p.cwd !== null && isUnder(cwd, p.cwd))
  );
}

export function runStatusline(stdinText: string, dataDir: string, now: () => Date = () => new Date()): string {
  let data: StdinData;
  try {
    data = JSON.parse(stdinText) as StdinData;
  } catch {
    return USAGE;
  }
  if (!data || typeof data !== 'object' || typeof data.session_id !== 'string') return USAGE;

  const view: StatuslineView = {
    last: null,
    indexed: false,
    modelName: data.model?.display_name ?? null,
    costUsd: typeof data.cost?.total_cost_usd === 'number' ? data.cost.total_cost_usd : null,
    liveFiles: 0,
    liveCommands: 0,
    sessionCount: 0,
    windowTokens: 0,
  };

  if (typeof data.transcript_path === 'string' && /^[A-Za-z0-9._-]+$/.test(data.session_id)) {
    const statePath = join(dataDir, 'statusline', `${data.session_id}.json`);
    const live = updateLiveStats(statePath, data.transcript_path);
    view.liveFiles = live.files;
    view.liveCommands = live.commands;
    view.windowTokens += live.tokens;
  }

  const dbPath = join(dataDir, 'index.db');
  if (existsSync(dbPath)) {
    view.indexed = true;
    const store = new Store(dbPath, { readonly: true });
    try {
      const cutoffIso = new Date(now().getTime() - TOKEN_WINDOW_MS).toISOString();
      view.windowTokens += store.getTokensSince(cutoffIso);

      const cwd = data.workspace?.project_dir ?? data.workspace?.current_dir ?? process.cwd();
      const project = findProjectForCwd(store.listProjects(), cwd);
      if (project) {
        // Exclude the running session: a SessionStart-hook re-index may have
        // already stored it, and row 1 must describe the *previous* session.
        const sessions = store.getSessions(project.projectDir).filter((s) => s.sessionId !== data.session_id);
        const polish = new Map<string, PolishResult>();
        for (const s of sessions) {
          const p = store.getPolish(s.sessionId);
          if (p) polish.set(s.sessionId, p);
        }
        const briefing = buildBriefing(project.projectDir, sessions, polish);
        view.sessionCount = store.getSessions(project.projectDir).length;
        const archView = getArchitectureView(store, project.projectDir, dataDir, data.session_id);
        if (archView.markdown !== null) view.archStaleBy = archView.staleBy;
        const latest = briefing.cards[0];
        if (latest) {
          view.last = {
            when: latest.when,
            ending: latest.ending,
            goal: latest.goal,
            pendingQuestion:
              briefing.leftOff?.ending === 'abandoned' && briefing.leftOff.lastAssistantText !== null,
          };
        }
      }
    } finally {
      store.close();
    }
  }

  return renderStatusline(view, now());
}
