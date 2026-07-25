import type { Store } from '../indexer/store.js';
import { computeObserved, type ObservedMetrics } from './observed.js';
import { runEval } from './run.js';
import { listFixtureNames } from './fixtures.js';
import type { ScoreReport } from './types.js';

export interface EvalView {
  measured: ScoreReport | null;
  observed: ObservedMetrics;
}

export function buildEvalView(
  store: Store, opts: { fixturesDir: string; projectDir?: string },
): EvalView {
  const sessions = opts.projectDir ? store.getSessions(opts.projectDir) : store.getAllSessions();
  const measured = listFixtureNames(opts.fixturesDir).length === 0 ? null : runEval(opts.fixturesDir);
  return { measured, observed: computeObserved(sessions) };
}
