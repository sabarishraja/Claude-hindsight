import type { Store } from '../indexer/store.js';
import type { PolishResult } from '../types.js';
import { resolveProject } from './context.js';
import { buildBriefing } from '../analyzer/briefing.js';
import { getArchitectureView, refreshArchitecture } from '../architecture/architecture.js';
import type { ArchRunner } from '../architecture/generate.js';
import { discoverClaudeMds } from '../server/configFiles.js';
import { parseInstructions } from '../analyzer/instructions.js';
import { auditInstructions } from '../analyzer/audit.js';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
}

function textResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return textResult({ error: message });
}

export function getBriefingTool(store: Store | null, cwd: string): ToolResult {
  const ctx = resolveProject(store, cwd);
  if (!ctx.ok) return errorResult(ctx.message);

  const sessions = store!.getSessions(ctx.project.projectDir);
  const polish = new Map<string, PolishResult>();
  for (const s of sessions) {
    const p = store!.getPolish(s.sessionId);
    if (p) polish.set(s.sessionId, p);
  }
  return textResult(buildBriefing(ctx.project.projectDir, sessions, polish));
}

export function getArchitectureTool(store: Store | null, dataDir: string, cwd: string): ToolResult {
  const ctx = resolveProject(store, cwd);
  if (!ctx.ok) return errorResult(ctx.message);

  const view = getArchitectureView(store!, ctx.project.projectDir, dataDir);
  if (view.markdown === null) {
    return textResult({
      markdown: null,
      message: 'No architecture doc has been generated yet for this project. ' +
        'Call refresh_architecture to generate one (this may take a few minutes).',
    });
  }
  return textResult(view);
}

export function runAuditTool(store: Store | null, claudeDir: string, cwd: string): ToolResult {
  const ctx = resolveProject(store, cwd);
  if (!ctx.ok) return errorResult(ctx.message);

  const projects = store!.listProjects();
  const files = discoverClaudeMds(claudeDir, projects)
    .filter((f) => f.projectDir === null || f.projectDir === ctx.project.projectDir);

  if (files.length === 0) {
    return textResult({ reports: [], message: 'No CLAUDE.md file found for this project or globally.' });
  }

  const reports = files.map((f) => {
    const sessions = f.projectDir === null ? store!.getAllSessions() : store!.getSessions(f.projectDir);
    return auditInstructions(parseInstructions(f.markdown, f.source), sessions);
  });
  return textResult({ reports });
}

export async function refreshArchitectureTool(
  store: Store | null, dataDir: string, cwd: string, opts: { full?: boolean }, runner?: ArchRunner,
): Promise<ToolResult> {
  const ctx = resolveProject(store, cwd);
  if (!ctx.ok) return errorResult(ctx.message);

  const outcome = await refreshArchitecture(store!, ctx.project.projectDir, {
    full: opts.full, dataDir, runner,
  });
  return textResult(outcome);
}
