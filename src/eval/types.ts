import type { Verdict } from '../analyzer/audit.js';
import type { SessionFacts } from '../types.js';

export type { Verdict };
export const VERDICTS: readonly Verdict[] = ['violated', 'followed', 'dead', 'unchecked'];
export const CONFIDENT: readonly Verdict[] = ['violated', 'followed'];

/** The frozen half of a fixture. Serialized to `<name>.input.json`, read-only. */
export interface FixtureInput {
  markdown: string;
  source: string;
  sessions: SessionFacts[];
}

/** The mutable half. Serialized to `<name>.labels.json`. */
export interface FixtureLabels {
  inputSha256: string;
  labels: Record<string, Verdict>; // ruleId -> expected verdict
}

export interface LoadedFixture {
  name: string;
  input: FixtureInput;
  labels: Record<string, Verdict>;
}

export interface ScoreReport {
  ruleCount: number;                                   // labeled rules scored across all fixtures
  confusion: Record<Verdict, Record<Verdict, number>>; // confusion[expected][predicted]
  confidentTotal: number;                              // predictions with predicted in CONFIDENT
  confidentCorrect: number;
  confidentAccuracy: number;                           // confidentCorrect / confidentTotal (0 if none)
  abstentionRate: number;                              // predicted in {dead,unchecked} / total
  violatedMisses: number;                              // expected 'violated', predicted !== 'violated'
  deadPrecision: number | null;
  deadRecall: number | null;
  orphanedLabels: string[];                            // "<fixture>:<ruleId>" label keys with no emitted rule
  unlabeledRules: string[];                            // "<fixture>:<ruleId>" emitted rules with no label
}

export interface Solver {
  name: string;
  run(input: FixtureInput): Map<string, Verdict>; // ruleId -> predicted verdict
}
