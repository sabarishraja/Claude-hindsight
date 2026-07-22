import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Store } from '../indexer/store.js';
import { parseInstructions } from '../analyzer/instructions.js';
import { sha256, listFixtureNames } from './fixtures.js';
import { runEval, setLabel } from './run.js';
import type { FixtureInput, ScoreReport, Verdict } from './types.js';

export function snapshotFixture(
  store: Store, projectDir: string, markdown: string, source: string, dir: string, name: string,
): void {
  mkdirSync(dir, { recursive: true });
  const input: FixtureInput = { markdown, source, sessions: store.getSessions(projectDir) };
  const inputText = JSON.stringify(input, null, 2) + '\n';
  writeFileSync(join(dir, `${name}.input.json`), inputText);
  writeFileSync(join(dir, `${name}.labels.json`),
    JSON.stringify({ inputSha256: sha256(inputText), labels: {} }, null, 2) + '\n');
}

export function formatReport(r: ScoreReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    `rules scored: ${r.ruleCount}`,
    `confident accuracy: ${pct(r.confidentAccuracy)} (${r.confidentCorrect}/${r.confidentTotal})`,
    `abstention rate: ${pct(r.abstentionRate)}`,
    `violated misses (severity): ${r.violatedMisses}`,
    `dead precision: ${r.deadPrecision === null ? 'n/a' : pct(r.deadPrecision)}`,
    `dead recall: ${r.deadRecall === null ? 'n/a' : pct(r.deadRecall)}`,
  ];
  if (r.orphanedLabels.length) lines.push(`ORPHANED LABELS: ${r.orphanedLabels.join(', ')}`);
  if (r.unlabeledRules.length) lines.push(`UNLABELED RULES: ${r.unlabeledRules.join(', ')}`);
  return lines.join('\n');
}

// Interactive walker: prompts one verdict per unlabeled rule and appends via setLabel.
async function labelWalk(dir: string, name: string): Promise<void> {
  const inputText = readFileSync(join(dir, `${name}.input.json`), 'utf8');
  const input = JSON.parse(inputText) as FixtureInput;
  const rules = parseInstructions(input.markdown, input.source);
  const labelsPath = join(dir, `${name}.labels.json`);
  const existing = JSON.parse(readFileSync(labelsPath, 'utf8')).labels as Record<string, Verdict>;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
  const keys: Record<string, Verdict> = { v: 'violated', f: 'followed', d: 'dead', u: 'unchecked' };
  try {
    for (const rule of rules) {
      if (existing[rule.id]) continue;
      console.log(`\n[${rule.id}] ${rule.text}`);
      let ans = '';
      while (!(ans in keys)) ans = (await ask('  (v)iolated (f)ollowed (d)ead (u)nchecked > ')).trim().toLowerCase();
      setLabel(dir, name, rule.id, keys[ans]);
    }
  } finally {
    rl.close();
  }
}

// argv is process.argv.slice(3): the tokens after `eval`.
export async function runEvalCli(argv: string[], deps: { store: Store; fixturesDir: string }): Promise<void> {
  const sub = argv[0];
  if (sub === 'label') {
    const name = argv[1];
    if (!name) { console.error('usage: eval label <fixture-name>'); process.exitCode = 1; return; }
    await labelWalk(deps.fixturesDir, name);
    return;
  }
  // default: run and print
  const names = listFixtureNames(deps.fixturesDir);
  if (names.length === 0) { console.log(`No fixtures in ${deps.fixturesDir}.`); return; }
  const report = runEval(deps.fixturesDir);
  console.log(formatReport(report));
  if (report.orphanedLabels.length || report.unlabeledRules.length) process.exitCode = 1;
}
