import type { LoadedFixture, Solver, ScoreReport, Verdict } from './types.js';
import { VERDICTS, CONFIDENT } from './types.js';

function emptyConfusion(): Record<Verdict, Record<Verdict, number>> {
  const m = {} as Record<Verdict, Record<Verdict, number>>;
  for (const e of VERDICTS) {
    m[e] = {} as Record<Verdict, number>;
    for (const p of VERDICTS) m[e][p] = 0;
  }
  return m;
}

export function scoreFixtures(fixtures: LoadedFixture[], solver: Solver): ScoreReport {
  const confusion = emptyConfusion();
  const orphanedLabels: string[] = [];
  const unlabeledRules: string[] = [];
  let confidentTotal = 0, confidentCorrect = 0, total = 0, abstentions = 0, violatedMisses = 0;
  let deadPredicted = 0, deadActual = 0, deadHits = 0;
  const confident = new Set<Verdict>(CONFIDENT);

  for (const fx of fixtures) {
    const predicted = solver.run(fx.input);
    const labelKeys = new Set(Object.keys(fx.labels));
    const predKeys = new Set(predicted.keys());

    for (const id of labelKeys) {
      if (!predKeys.has(id)) orphanedLabels.push(`${fx.name}:${id}`);
    }
    for (const id of predKeys) {
      if (!labelKeys.has(id)) unlabeledRules.push(`${fx.name}:${id}`);
    }

    for (const [id, expected] of Object.entries(fx.labels)) {
      const pred = predicted.get(id);
      if (pred === undefined) continue; // orphan, already recorded
      total++;
      confusion[expected][pred]++;
      if (pred === 'dead' || pred === 'unchecked') abstentions++;
      if (confident.has(pred)) {
        confidentTotal++;
        if (pred === expected) confidentCorrect++;
      }
      if (expected === 'violated' && pred !== 'violated') violatedMisses++;
      if (pred === 'dead') deadPredicted++;
      if (expected === 'dead') deadActual++;
      if (pred === 'dead' && expected === 'dead') deadHits++;
    }
  }

  return {
    ruleCount: total,
    confusion,
    confidentTotal,
    confidentCorrect,
    confidentAccuracy: confidentTotal === 0 ? 0 : confidentCorrect / confidentTotal,
    abstentionRate: total === 0 ? 0 : abstentions / total,
    violatedMisses,
    deadPrecision: deadPredicted === 0 ? null : deadHits / deadPredicted,
    deadRecall: deadActual === 0 ? null : deadHits / deadActual,
    orphanedLabels: orphanedLabels.sort(),
    unlabeledRules: unlabeledRules.sort(),
  };
}
