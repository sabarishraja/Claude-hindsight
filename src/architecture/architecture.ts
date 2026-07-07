import type { Store } from '../indexer/store.js';
import type { SessionFacts } from '../types.js';
import { computeStaleBy } from './staleness.js';
import { readArchitectureDoc, writeArchitectureDoc, type ArchitectureMeta } from './state.js';
import {
  buildFullPrompt, buildIncrementalPrompt, isValidDoc, trimRecentChanges,
  defaultRunClaude, hasHeading, type ArchRunner, type SessionSummary,
} from './generate.js';

export interface RefreshOptions {
  full?: boolean;
  runner?: ArchRunner;
  dataDir: string;
  now?: () => Date;
}

export interface RefreshOutcome {
  status: 'generated' | 'up-to-date' | 'rejected' | 'error';
  message: string;
}

const RECENT_CHANGES_MAX = 10;

function realSessions(sessions: SessionFacts[]): SessionFacts[] {
  return sessions.filter((s) => s.goal !== null);
}

function newestLastTs(sessions: SessionFacts[]): string | null {
  return sessions.reduce<string | null>(
    (max, s) => (s.lastTs && (!max || s.lastTs > max) ? s.lastTs : max), null,
  );
}

export async function refreshArchitecture(
  store: Store, projectDir: string, opts: RefreshOptions,
): Promise<RefreshOutcome> {
  const runner = opts.runner ?? defaultRunClaude;
  const now = opts.now ?? (() => new Date());
  const allSessions = store.getSessions(projectDir);
  const sessions = realSessions(allSessions);
  const existing = readArchitectureDoc(opts.dataDir, projectDir);
  const staleBy = computeStaleBy(sessions, existing?.meta.coveredThroughTs ?? null);
  const doFull = opts.full === true
    || existing === null
    || !hasHeading(existing.markdown, 'architecture diagram');

  if (!doFull && staleBy === 0) {
    return { status: 'up-to-date', message: 'Architecture doc is already up to date.' };
  }

  const cwd = allSessions.find((s) => s.cwd)?.cwd ?? projectDir;

  let output: string;
  try {
    if (doFull) {
      output = await runner(buildFullPrompt(), { cwd, tools: true, timeoutMs: 5 * 60_000 });
    } else {
      const watermark = existing!.meta.coveredThroughTs;
      const newSessions = sessions.filter(
        (s) => watermark === null || (s.lastTs !== null && s.lastTs > watermark),
      );
      const changedFiles = [...new Set(newSessions.flatMap((s) => s.filesEdited))];
      const summaries: SessionSummary[] = newSessions.map((s) => {
        const p = store.getPolish(s.sessionId);
        return { goal: p?.goal ?? s.goal!, outcome: p?.outcome ?? null };
      });
      output = await runner(buildIncrementalPrompt(existing!.markdown, changedFiles, summaries), {
        cwd, tools: false, timeoutMs: 60_000,
      });
    }
  } catch (err) {
    return {
      status: 'error',
      message: `Architecture generation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const trimmed = trimRecentChanges(output, RECENT_CHANGES_MAX);
  if (!isValidDoc(trimmed)) {
    return {
      status: 'rejected',
      message: 'Architecture generation produced an invalid document; keeping the previous one.',
    };
  }

  const meta: ArchitectureMeta = {
    docVersion: (existing?.meta.docVersion ?? 0) + 1,
    lastRefreshAt: now().toISOString(),
    coveredThroughTs: newestLastTs(sessions) ?? existing?.meta.coveredThroughTs ?? null,
  };
  writeArchitectureDoc(opts.dataDir, projectDir, trimmed, meta);
  return { status: 'generated', message: doFull ? 'Architecture doc generated.' : 'Architecture doc updated.' };
}

export function getArchitectureView(
  store: Store, projectDir: string, dataDir: string, currentSessionId?: string,
): { markdown: string | null; meta: ArchitectureMeta | null; staleBy: number } {
  const sessions = realSessions(store.getSessions(projectDir));
  const doc = readArchitectureDoc(dataDir, projectDir);
  const staleBy = doc ? computeStaleBy(sessions, doc.meta.coveredThroughTs, currentSessionId) : 0;
  return { markdown: doc?.markdown ?? null, meta: doc?.meta ?? null, staleBy };
}
