import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runEval } from '../../src/eval/run.js';

const here = dirname(fileURLToPath(import.meta.url));
const heldoutDir = join(here, 'fixtures', 'heldout');
const baseline = JSON.parse(readFileSync(join(here, 'baseline.json'), 'utf8')) as
  { confidentAccuracy: number; violatedMisses: number };

describe('audit eval gate (held-out)', () => {
  const report = runEval(heldoutDir);

  it('has no orphaned labels or unlabeled rules (fixtures in sync with the classifier)', () => {
    expect(report.orphanedLabels).toEqual([]);
    expect(report.unlabeledRules).toEqual([]);
  });

  it('never regresses on violated misses (severity)', () => {
    expect(report.violatedMisses).toBeLessThanOrEqual(baseline.violatedMisses);
  });

  it('never regresses on confident accuracy', () => {
    expect(report.confidentAccuracy).toBeGreaterThanOrEqual(baseline.confidentAccuracy);
    if (report.confidentAccuracy > baseline.confidentAccuracy) {
      console.warn(
        `confident accuracy improved ${baseline.confidentAccuracy} -> ${report.confidentAccuracy}; ` +
        're-bless tests/eval/baseline.json in this PR.',
      );
    }
  });
});
