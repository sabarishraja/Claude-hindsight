import { describe, it, expect } from 'vitest';
import { scoreFixtures } from '../src/eval/score.js';
import type { LoadedFixture, Solver, Verdict } from '../src/eval/types.js';

// A stub solver whose predictions are driven by the ruleId suffix, so tests
// control expected-vs-predicted pairings without invoking the real classifier.
const stub = (preds: Record<string, Verdict>): Solver => ({
  name: 'stub',
  run: () => new Map(Object.entries(preds)),
});

const fixture = (labels: Record<string, Verdict>): LoadedFixture => ({
  name: 'fx', input: { markdown: '', source: 'CLAUDE.md', sessions: [] }, labels,
});

describe('scoreFixtures', () => {
  it('computes confident accuracy over violated+followed predictions only', () => {
    const fx = fixture({ 'CLAUDE.md:1': 'followed', 'CLAUDE.md:2': 'violated', 'CLAUDE.md:3': 'followed' });
    const solver = stub({ 'CLAUDE.md:1': 'followed', 'CLAUDE.md:2': 'violated', 'CLAUDE.md:3': 'unchecked' });
    const r = scoreFixtures([fx], solver);
    // rule 3 predicted 'unchecked' -> abstention, not in confident denominator
    expect(r.confidentTotal).toBe(2);
    expect(r.confidentCorrect).toBe(2);
    expect(r.confidentAccuracy).toBe(1);
    expect(r.abstentionRate).toBeCloseTo(1 / 3);
  });

  it('counts a violated rule the solver called followed as a violatedMiss', () => {
    const fx = fixture({ 'CLAUDE.md:1': 'violated' });
    const r = scoreFixtures([fx], stub({ 'CLAUDE.md:1': 'followed' }));
    expect(r.violatedMisses).toBe(1);
    expect(r.confidentAccuracy).toBe(0); // predicted followed, expected violated -> wrong confident
  });

  it('reports dead precision and recall separately', () => {
    const fx = fixture({ 'CLAUDE.md:1': 'dead', 'CLAUDE.md:2': 'dead', 'CLAUDE.md:3': 'followed' });
    // predict dead on 1 (correct) and 3 (wrong); miss dead on 2
    const r = scoreFixtures([fx], stub({ 'CLAUDE.md:1': 'dead', 'CLAUDE.md:2': 'unchecked', 'CLAUDE.md:3': 'dead' }));
    expect(r.deadPrecision).toBeCloseTo(1 / 2); // 1 correct of 2 predicted dead
    expect(r.deadRecall).toBeCloseTo(1 / 2);    // 1 caught of 2 actual dead
  });

  it('flags orphaned labels and unlabeled rules by fixture-qualified key', () => {
    const fx = fixture({ 'CLAUDE.md:1': 'followed', 'CLAUDE.md:9': 'violated' });
    const r = scoreFixtures([fx], stub({ 'CLAUDE.md:1': 'followed', 'CLAUDE.md:2': 'unchecked' }));
    expect(r.orphanedLabels).toEqual(['fx:CLAUDE.md:9']); // label with no emitted rule
    expect(r.unlabeledRules).toEqual(['fx:CLAUDE.md:2']); // emitted rule with no label
  });
});
