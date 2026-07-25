import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFixtures, sha256 } from './fixtures.js';
import { scoreFixtures } from './score.js';
import { auditSolver } from './solvers.js';
import type { FixtureLabels, ScoreReport, Solver, Verdict } from './types.js';

export function runEval(dir: string, solver: Solver = auditSolver): ScoreReport {
  return scoreFixtures(loadFixtures(dir), solver);
}

// Appends or updates a single label. Reads the frozen input ONLY to recompute
// its sha; it never writes `<name>.input.json`. Write-once on the input half is
// enforced by construction: this function has no path that opens it for writing.
export function setLabel(dir: string, name: string, ruleId: string, verdict: Verdict): void {
  const inputText = readFileSync(join(dir, `${name}.input.json`), 'utf8');
  const labelsPath = join(dir, `${name}.labels.json`);
  const current = JSON.parse(readFileSync(labelsPath, 'utf8')) as FixtureLabels;
  const next: FixtureLabels = {
    inputSha256: sha256(inputText),
    labels: { ...current.labels, [ruleId]: verdict },
  };
  writeFileSync(labelsPath, JSON.stringify(next, null, 2) + '\n');
}
