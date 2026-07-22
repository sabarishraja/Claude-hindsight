# Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score claude-hindsight's CLAUDE.md instruction-audit classifier against a hand-labeled answer key, with a committed non-regression gate, plus a verdict-free "Observed" dashboard panel derived from `SessionFacts`.

**Architecture:** A new `src/eval/` module treats the audit classifier as a pure solver (`auditInstructions(parseInstructions(markdown, source), sessions)`). Fixtures are frozen JSON split into read-only `*.input.json` and mutable `*.labels.json`; a scorer produces a confusion matrix and confident-accuracy metrics; a vitest gate asserts non-regression against a committed `baseline.json` on a held-out fixture set. A second, unscored path computes descriptive trajectory metrics for the dashboard.

**Tech Stack:** TypeScript (ESM/NodeNext, `.js` import suffixes), better-sqlite3 `Store`, Express, vitest, `node:crypto` for sha256.

## Global Constraints

- ESM: every relative import ends in `.js`, even from `.ts` (NodeNext). One line, verbatim.
- No network, no telemetry; default scorers deterministic; no `claude` CLI calls anywhere in v1.
- Every surface reads from `Store`; nothing re-parses transcripts.
- Tests live under `tests/`; `vitest.config.ts` collects `tests/**/*.test.ts` only.
- Never add a `Co-Authored-By` / AI-attribution trailer to any commit in this repo.
- Windows path comparisons are case-insensitive and slash-normalized.
- Verdict enum is exactly `'violated' | 'followed' | 'dead' | 'unchecked'` (`src/analyzer/audit.ts:4`).
- `confidentAccuracy` denominator = predictions where predicted ∈ {`violated`,`followed`}; `dead`/`unchecked` are abstentions and excluded.
- Rule id is `${source}:${line}` (`src/analyzer/instructions.ts:23`) — positional; the harness MUST fail loudly on any ruleId↔label-key non-bijection.
- Run commands from repo root: `C:\Users\sabar\Downloads\Claude-Hindsight`.

---

### Task 1: Eval types + Solver + auditSolver

**Files:**
- Create: `src/eval/types.ts`
- Create: `src/eval/solvers.ts`
- Test: `tests/evalSolvers.test.ts`

**Interfaces:**
- Consumes: `parseInstructions` (`src/analyzer/instructions.ts`), `auditInstructions` + `Verdict` (`src/analyzer/audit.ts`), `SessionFacts` (`src/types.ts`).
- Produces: `FixtureInput`, `FixtureLabels`, `LoadedFixture`, `ScoreReport`, `ObservedMetrics` types; `Solver` interface `{ name: string; run(input: FixtureInput): Map<string, Verdict> }`; `auditSolver: Solver`.

- [ ] **Step 1: Write `src/eval/types.ts`**

```typescript
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
```

- [ ] **Step 2: Write the failing test `tests/evalSolvers.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { auditSolver } from '../src/eval/solvers.js';
import type { SessionFacts } from '../src/types.js';

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's1', projectDir: 'p', cwd: null, goal: 'g',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
  messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
  filesEdited: [], commandsRun: [], skillsInvoked: [],
  errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null,
  skippedLines: 0, ...over,
});

describe('auditSolver', () => {
  it('maps each rule id to a verdict from auditInstructions', () => {
    const input = {
      markdown: '- Always run `npx vitest run` before committing.',
      source: 'CLAUDE.md',
      sessions: [session({ commandsRun: ['npx vitest run'] })],
    };
    const out = auditSolver.run(input);
    expect(out.get('CLAUDE.md:1')).toBe('followed');
  });

  it('returns one entry per parsed rule', () => {
    const input = {
      markdown: '- Rule one `alpha`.\n- Rule two `beta`.',
      source: 'CLAUDE.md',
      sessions: [session({})],
    };
    expect(auditSolver.run(input).size).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/evalSolvers.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/solvers.js'`.

- [ ] **Step 4: Write `src/eval/solvers.ts`**

```typescript
import { parseInstructions } from '../analyzer/instructions.js';
import { auditInstructions } from '../analyzer/audit.js';
import type { Verdict, Solver } from './types.js';

export const auditSolver: Solver = {
  name: 'audit',
  run(input) {
    const instructions = parseInstructions(input.markdown, input.source);
    const report = auditInstructions(instructions, input.sessions);
    const out = new Map<string, Verdict>();
    for (const f of report.findings) out.set(f.instruction.id, f.verdict);
    return out;
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/evalSolvers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/eval/types.ts src/eval/solvers.ts tests/evalSolvers.test.ts
git commit -m "feat(eval): solver interface wrapping the audit classifier"
```

---

### Task 2: Fixture loader (sha256 guard + list)

**Files:**
- Create: `src/eval/fixtures.ts`
- Test: `tests/evalFixtures.test.ts`

**Interfaces:**
- Consumes: `FixtureInput`, `FixtureLabels`, `LoadedFixture` from `src/eval/types.ts`.
- Produces: `sha256(text: string): string`; `listFixtureNames(dir: string): string[]`; `loadFixture(dir: string, name: string): LoadedFixture`; `loadFixtures(dir: string): LoadedFixture[]`.

- [ ] **Step 1: Write the failing test `tests/evalFixtures.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, loadFixture, loadFixtures } from '../src/eval/fixtures.js';

let dir: string;
const input = { markdown: '- Use `alpha`.', source: 'CLAUDE.md', sessions: [] };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalfx-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeFixture(name: string, sha: string) {
  const inputText = JSON.stringify(input);
  writeFileSync(join(dir, `${name}.input.json`), inputText);
  writeFileSync(join(dir, `${name}.labels.json`),
    JSON.stringify({ inputSha256: sha, labels: { 'CLAUDE.md:1': 'unchecked' } }));
  return inputText;
}

describe('loadFixture', () => {
  it('loads when the labels sha matches the input bytes', () => {
    const inputText = writeFixture('foo', '');
    // rewrite labels with the correct sha
    writeFileSync(join(dir, 'foo.labels.json'),
      JSON.stringify({ inputSha256: sha256(inputText), labels: { 'CLAUDE.md:1': 'unchecked' } }));
    const f = loadFixture(dir, 'foo');
    expect(f.name).toBe('foo');
    expect(f.labels['CLAUDE.md:1']).toBe('unchecked');
  });

  it('throws when the input bytes changed out from under the labels', () => {
    writeFixture('bar', 'deadbeef'); // wrong sha on purpose
    expect(() => loadFixture(dir, 'bar')).toThrow(/sha/i);
  });
});

describe('loadFixtures', () => {
  it('loads every *.input.json in the directory', () => {
    const t1 = writeFixture('a', '');
    writeFileSync(join(dir, 'a.labels.json'),
      JSON.stringify({ inputSha256: sha256(t1), labels: {} }));
    const t2 = writeFixture('b', '');
    writeFileSync(join(dir, 'b.labels.json'),
      JSON.stringify({ inputSha256: sha256(t2), labels: {} }));
    expect(loadFixtures(dir).map((f) => f.name).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalFixtures.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/fixtures.js'`.

- [ ] **Step 3: Write `src/eval/fixtures.ts`**

```typescript
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FixtureInput, FixtureLabels, LoadedFixture } from './types.js';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function listFixtureNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.input.json'))
    .map((f) => f.slice(0, -'.input.json'.length))
    .sort();
}

export function loadFixture(dir: string, name: string): LoadedFixture {
  const inputText = readFileSync(join(dir, `${name}.input.json`), 'utf8');
  const labelsText = readFileSync(join(dir, `${name}.labels.json`), 'utf8');
  const input = JSON.parse(inputText) as FixtureInput;
  const labelsFile = JSON.parse(labelsText) as FixtureLabels;
  const actual = sha256(inputText);
  if (labelsFile.inputSha256 !== actual) {
    throw new Error(
      `fixture ${name}: input sha mismatch — labels are stale for the current input.json ` +
      `(labels ${labelsFile.inputSha256 || '<empty>'}, input ${actual}). Re-label against the current input.`,
    );
  }
  return { name, input, labels: labelsFile.labels };
}

export function loadFixtures(dir: string): LoadedFixture[] {
  return listFixtureNames(dir).map((name) => loadFixture(dir, name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/evalFixtures.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/eval/fixtures.ts tests/evalFixtures.test.ts
git commit -m "feat(eval): fixture loader with sha256 staleness guard"
```

---

### Task 3: Scorer (confusion, confident accuracy, severity, dead p/r, bijection)

**Files:**
- Create: `src/eval/score.ts`
- Test: `tests/evalScore.test.ts`

**Interfaces:**
- Consumes: `LoadedFixture`, `Solver`, `ScoreReport`, `Verdict`, `VERDICTS`, `CONFIDENT` from `src/eval/types.ts`.
- Produces: `scoreFixtures(fixtures: LoadedFixture[], solver: Solver): ScoreReport`.

- [ ] **Step 1: Write the failing test `tests/evalScore.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalScore.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/score.js'`.

- [ ] **Step 3: Write `src/eval/score.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/evalScore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/eval/score.ts tests/evalScore.test.ts
git commit -m "feat(eval): scorer with confusion matrix, confident accuracy, severity, dead p/r, bijection"
```

---

### Task 4: Observed metrics (verdict-free trajectory signals)

**Files:**
- Create: `src/eval/observed.ts`
- Test: `tests/evalObserved.test.ts`

**Interfaces:**
- Consumes: `SessionFacts` from `src/types.ts`.
- Produces: `ObservedMetrics` interface and `computeObserved(sessions: SessionFacts[]): ObservedMetrics`.

`ObservedMetrics` shape (add to `src/eval/observed.ts`, not `types.ts`, since it's dashboard-only):
```typescript
export interface ObservedMetrics {
  sessionCount: number;
  endingMix: { clean: number; error: number; abandoned: number };
  toolErrorDensity: number | null;          // sum(errorCount) / sum(messageCount)
  fileCarryOverRate: number | null;         // mean over adjacent pairs
  costPerEndingOutcome: { clean: number | null; error: number | null; abandoned: number | null };
}
```

- [ ] **Step 1: Write the failing test `tests/evalObserved.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { computeObserved } from '../src/eval/observed.js';
import type { SessionFacts } from '../src/types.js';

const s = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'p', cwd: null, goal: 'g',
  firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
  messageCount: 10, inputTokens: 0, outputTokens: 100, rateLimitResetAt: null,
  filesEdited: [], commandsRun: [], skillsInvoked: [],
  errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null,
  skippedLines: 0, ...over,
});

describe('computeObserved', () => {
  it('summarizes ending mix and tool-error density', () => {
    const m = computeObserved([
      s({ sessionId: 'a', ending: 'clean', errorCount: 1, messageCount: 10 }),
      s({ sessionId: 'b', ending: 'error', errorCount: 3, messageCount: 10 }),
    ]);
    expect(m.endingMix).toEqual({ clean: 1, error: 1, abandoned: 0 });
    expect(m.toolErrorDensity).toBeCloseTo(4 / 20);
  });

  it('computes file carry-over rate over adjacent sessions by time', () => {
    // ordered by firstTs ascending: s1 then s2; s2 re-edits 1 of its 2 files from s1
    const m = computeObserved([
      s({ sessionId: 's2', firstTs: '2026-07-02T10:00:00Z', filesEdited: ['A.ts', 'B.ts'] }),
      s({ sessionId: 's1', firstTs: '2026-07-01T10:00:00Z', filesEdited: ['A.ts'] }),
    ]);
    expect(m.fileCarryOverRate).toBeCloseTo(1 / 2);
  });

  it('normalizes file paths case-insensitively for carry-over', () => {
    const m = computeObserved([
      s({ sessionId: 's1', firstTs: '2026-07-01T10:00:00Z', filesEdited: ['src/A.ts'] }),
      s({ sessionId: 's2', firstTs: '2026-07-02T10:00:00Z', filesEdited: ['SRC\\a.ts'] }),
    ]);
    expect(m.fileCarryOverRate).toBe(1);
  });

  it('returns null carry-over when there is only one session', () => {
    expect(computeObserved([s({})]).fileCarryOverRate).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalObserved.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/observed.js'`.

- [ ] **Step 3: Write `src/eval/observed.ts`**

```typescript
import type { SessionFacts } from '../types.js';

export interface ObservedMetrics {
  sessionCount: number;
  endingMix: { clean: number; error: number; abandoned: number };
  toolErrorDensity: number | null;
  fileCarryOverRate: number | null;
  costPerEndingOutcome: { clean: number | null; error: number | null; abandoned: number | null };
}

// Windows path comparisons are case-insensitive and slash-normalized project-wide.
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function meanCost(sessions: SessionFacts[]): number | null {
  if (sessions.length === 0) return null;
  const sum = sessions.reduce((a, x) => a + x.inputTokens + x.outputTokens, 0);
  return sum / sessions.length;
}

export function computeObserved(sessions: SessionFacts[]): ObservedMetrics {
  const endingMix = { clean: 0, error: 0, abandoned: 0 };
  for (const s of sessions) endingMix[s.ending]++;

  const totalErrors = sessions.reduce((a, s) => a + s.errorCount, 0);
  const totalMessages = sessions.reduce((a, s) => a + s.messageCount, 0);

  // Oldest-first so "preceding session" is well defined; nulls sort last.
  const chron = [...sessions].sort((a, b) => (a.firstTs ?? '').localeCompare(b.firstTs ?? ''));
  let carrySum = 0, carryPairs = 0;
  for (let i = 1; i < chron.length; i++) {
    const cur = chron[i].filesEdited.map(normPath);
    if (cur.length === 0) continue;
    const prev = new Set(chron[i - 1].filesEdited.map(normPath));
    const overlap = cur.filter((f) => prev.has(f)).length;
    carrySum += overlap / cur.length;
    carryPairs++;
  }

  return {
    sessionCount: sessions.length,
    endingMix,
    toolErrorDensity: totalMessages === 0 ? null : totalErrors / totalMessages,
    fileCarryOverRate: carryPairs === 0 ? null : carrySum / carryPairs,
    costPerEndingOutcome: {
      clean: meanCost(sessions.filter((s) => s.ending === 'clean')),
      error: meanCost(sessions.filter((s) => s.ending === 'error')),
      abandoned: meanCost(sessions.filter((s) => s.ending === 'abandoned')),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/evalObserved.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/eval/observed.ts tests/evalObserved.test.ts
git commit -m "feat(eval): verdict-free observed trajectory metrics"
```

---

### Task 5: Orchestrator + label appender

**Files:**
- Create: `src/eval/run.ts`
- Test: `tests/evalRun.test.ts`

**Interfaces:**
- Consumes: `loadFixtures`, `sha256` (`src/eval/fixtures.ts`); `scoreFixtures` (`src/eval/score.ts`); `auditSolver` (`src/eval/solvers.ts`); `Verdict` (`src/eval/types.ts`).
- Produces: `runEval(dir: string, solver?: Solver): ScoreReport`; `setLabel(dir: string, name: string, ruleId: string, verdict: Verdict): void` (appends/updates one label in `<name>.labels.json`, refreshes `inputSha256`, never writes `<name>.input.json`).

- [ ] **Step 1: Write the failing test `tests/evalRun.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEval, setLabel } from '../src/eval/run.js';
import { sha256 } from '../src/eval/fixtures.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalrun-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const input = {
  markdown: '- Always run `npx vitest run` before committing.',
  source: 'CLAUDE.md',
  sessions: [{
    sessionId: 's1', projectDir: 'p', cwd: null, goal: 'g',
    firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
    messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
    filesEdited: [], commandsRun: ['npx vitest run'], skillsInvoked: [],
    errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
  }],
};

function seed() {
  const inputText = JSON.stringify(input, null, 2);
  writeFileSync(join(dir, 'foo.input.json'), inputText);
  writeFileSync(join(dir, 'foo.labels.json'),
    JSON.stringify({ inputSha256: sha256(inputText), labels: {} }, null, 2));
  return inputText;
}

describe('setLabel', () => {
  it('writes a label without mutating the frozen input file', () => {
    const before = seed();
    setLabel(dir, 'foo', 'CLAUDE.md:1', 'followed');
    expect(readFileSync(join(dir, 'foo.input.json'), 'utf8')).toBe(before); // input untouched
    const labels = JSON.parse(readFileSync(join(dir, 'foo.labels.json'), 'utf8'));
    expect(labels.labels['CLAUDE.md:1']).toBe('followed');
    expect(labels.inputSha256).toBe(sha256(before)); // sha still matches input
  });
});

describe('runEval', () => {
  it('scores a labeled fixture directory end to end', () => {
    seed();
    setLabel(dir, 'foo', 'CLAUDE.md:1', 'followed');
    const r = runEval(dir);
    expect(r.ruleCount).toBe(1);
    expect(r.confidentAccuracy).toBe(1);
    expect(r.orphanedLabels).toEqual([]);
    expect(r.unlabeledRules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalRun.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/run.js'`.

- [ ] **Step 3: Write `src/eval/run.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/evalRun.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/eval/run.ts tests/evalRun.test.ts
git commit -m "feat(eval): orchestrator and write-once label appender"
```

---

### Task 6: CLI subcommands `eval` and `eval label`, and fixture snapshotting

**Files:**
- Create: `src/eval/cli.ts`
- Modify: `src/cli.ts` (add `eval` dispatch in `main`, near the `statusline`/`mcp` branches at `src/cli.ts:206-213`)
- Test: `tests/evalCli.test.ts`

**Interfaces:**
- Consumes: `runEval`, `setLabel` (`src/eval/run.ts`); `loadFixtures`, `sha256`, `listFixtureNames` (`src/eval/fixtures.ts`); `Store` (`src/indexer/store.ts`); `ScoreReport` (`src/eval/types.ts`).
- Produces: `formatReport(report: ScoreReport): string` (confusion matrix + metrics as text); `snapshotFixture(store, projectDir, markdown, source, dir, name): void` (writes a frozen `<name>.input.json` + empty `<name>.labels.json` from live sessions); `runEvalCli(argv: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test `tests/evalCli.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { snapshotFixture, formatReport } from '../src/eval/cli.js';
import { sha256 } from '../src/eval/fixtures.js';
import type { ScoreReport } from '../src/eval/types.js';

let dir: string;
let store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalcli-')); store = new Store(':memory:'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('snapshotFixture', () => {
  it('freezes live sessions into input.json with a matching empty labels.json', () => {
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: null, goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 1, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: ['npx vitest run'], skillsInvoked: [],
      errorCount: 0, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });
    snapshotFixture(store, 'proj', '- Run `npx vitest run`.', 'CLAUDE.md', dir, 'proj');
    expect(existsSync(join(dir, 'proj.input.json'))).toBe(true);
    const inputText = readFileSync(join(dir, 'proj.input.json'), 'utf8');
    const labels = JSON.parse(readFileSync(join(dir, 'proj.labels.json'), 'utf8'));
    expect(labels.inputSha256).toBe(sha256(inputText));
    expect(labels.labels).toEqual({});
    expect(JSON.parse(inputText).sessions).toHaveLength(1);
  });
});

describe('formatReport', () => {
  it('renders confident accuracy and the severity count', () => {
    const report: ScoreReport = {
      ruleCount: 3, confusion: {} as ScoreReport['confusion'],
      confidentTotal: 2, confidentCorrect: 1, confidentAccuracy: 0.5,
      abstentionRate: 0.33, violatedMisses: 1, deadPrecision: null, deadRecall: null,
      orphanedLabels: [], unlabeledRules: [],
    };
    const text = formatReport(report);
    expect(text).toMatch(/confident accuracy/i);
    expect(text).toMatch(/violated misses.*1/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalCli.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/cli.js'`.

- [ ] **Step 3: Write `src/eval/cli.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Store } from '../indexer/store.js';
import { parseInstructions } from '../analyzer/instructions.js';
import { sha256, listFixtureNames } from './fixtures.js';
import { runEval, setLabel } from './run.js';
import { VERDICTS } from './types.js';
import type { FixtureInput, ScoreReport, Verdict } from './types.js';

export function snapshotFixture(
  store: Store, projectDir: string, markdown: string, source: string, dir: string, name: string,
): void {
  mkdirSync(dir, { recursive: true });
  const input: FixtureInput = { markdown, source, sessions: store.getSessions(projectDir) };
  const inputText = JSON.stringify(input, null, 2) + '\n';
  writeFileSync(join(dir, `${name}.input.json`), inputText);
  writeFileSync(join(dir, `${name}.labels.json`),
    JSON.stringify({ inputSha256: sha256(inputText.trimEnd()), labels: {} }, null, 2) + '\n');
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
```

- [ ] **Step 4: Wire the subcommand into `src/cli.ts`**

After the `mcp` branch (`src/cli.ts:210-213`), before the `claudeDir`/`web` setup, add:

```typescript
  if (process.argv[2] === 'eval') {
    const { runEvalCli } = await import('./eval/cli.js');
    const dataDir2 = join(homedir(), '.claude-hindsight');
    mkdirSync(dataDir2, { recursive: true });
    const store2 = new Store(join(dataDir2, 'index.db'));
    const fixturesDir = join(process.cwd(), 'tests', 'eval', 'fixtures', 'train');
    await runEvalCli(process.argv.slice(3), { store: store2, fixturesDir });
    store2.close();
    return;
  }
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/evalCli.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/eval/cli.ts src/cli.ts tests/evalCli.test.ts
git commit -m "feat(eval): eval and eval label CLI subcommands with fixture snapshotting"
```

---

### Task 7: Adversarial fixtures + baseline + the vitest gate

**Files:**
- Create: `tests/eval/fixtures/heldout/adversarial-weaktoken.input.json`
- Create: `tests/eval/fixtures/heldout/adversarial-weaktoken.labels.json`
- Create: `tests/eval/baseline.json`
- Create: `tests/eval/audit-eval.test.ts`

**Interfaces:**
- Consumes: `runEval` (`src/eval/run.ts`); baseline JSON `{ confidentAccuracy: number; violatedMisses: number }`.
- Produces: the gate. No exported symbols.

**Note on the labeling pass:** the ~150-label real fixtures are produced at execution time by a human running `node dist/cli.js eval label <name>` after `snapshotFixture` (Task 6). That is a manual step, not automatable here. This task ships **hand-authored adversarial fixtures** so the gate has real content immediately; real labeled fixtures are added later by re-running Task 7's baseline-bless step.

- [ ] **Step 1: Write `tests/eval/fixtures/heldout/adversarial-weaktoken.input.json`**

This fixture targets the weak-token false-positive path: a rule about tests whose only overlap with the session is the incidental weak token `tests`, with no evidence the rule was actually followed.

```json
{
  "markdown": "- Tests live in `tests/`, never at the repo root.",
  "source": "CLAUDE.md",
  "sessions": [
    {
      "sessionId": "adv1", "projectDir": "p", "cwd": null, "goal": "poke at tests",
      "firstTs": "2026-07-01T10:00:00Z", "lastTs": "2026-07-01T11:00:00Z",
      "messageCount": 5, "inputTokens": 0, "outputTokens": 0, "rateLimitResetAt": null,
      "filesEdited": ["tests/foo.test.ts"], "commandsRun": ["npx vitest run tests/foo.test.ts"],
      "skillsInvoked": [], "errorCount": 0, "ending": "clean",
      "lastUserText": null, "lastAssistantText": null, "skippedLines": 0
    }
  ]
}
```

- [ ] **Step 2: Compute the input sha and write the labels file**

Run this to get the exact sha (do not hand-type it):

```bash
node -e "const{createHash}=require('crypto');const fs=require('fs');const t=fs.readFileSync('tests/eval/fixtures/heldout/adversarial-weaktoken.input.json','utf8');console.log(createHash('sha256').update(t,'utf8').digest('hex'))"
```

The rule `CLAUDE.md:1` was NOT demonstrably followed (editing a file under `tests/` is not evidence the rule "never at repo root" was honored). The defensible label given only these frozen facts is `unchecked`. Write `tests/eval/fixtures/heldout/adversarial-weaktoken.labels.json`, pasting the sha from above:

```json
{
  "inputSha256": "<PASTE_SHA_FROM_STEP_2>",
  "labels": { "CLAUDE.md:1": "unchecked" }
}
```

- [ ] **Step 3: Write the gate `tests/eval/audit-eval.test.ts`**

```typescript
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
```

- [ ] **Step 4: Bless the baseline from the current run**

The classifier calls the adversarial rule `dead` or `unchecked` (an abstention), so `confidentTotal` is 0 and `confidentAccuracy` is 0 by definition (see `src/eval/score.ts`). Capture the real numbers rather than guessing:

Run: `npx tsc -p . --outDir dist && node -e "const{runEval}=require('./dist/eval/run.js');const r=runEval('tests/eval/fixtures/heldout');console.log(JSON.stringify({confidentAccuracy:r.confidentAccuracy,violatedMisses:r.violatedMisses}))"`

Write the printed object to `tests/eval/baseline.json`, e.g.:

```json
{ "confidentAccuracy": 0, "violatedMisses": 0 }
```

- [ ] **Step 5: Run the gate**

Run: `npx vitest run tests/eval/audit-eval.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/eval/fixtures/heldout tests/eval/baseline.json tests/eval/audit-eval.test.ts
git commit -m "test(eval): adversarial held-out fixture, committed baseline, non-regression gate"
```

---

### Task 8: `GET /api/eval` endpoint (Measured + Observed)

**Files:**
- Create: `src/eval/view.ts`
- Modify: `src/server/server.ts` (add route after `/api/audit` at `src/server/server.ts:59-73`)
- Test: `tests/evalView.test.ts`

**Interfaces:**
- Consumes: `Store` (`src/indexer/store.ts`); `computeObserved` (`src/eval/observed.ts`); `runEval` (`src/eval/run.ts`); `listFixtureNames` (`src/eval/fixtures.ts`).
- Produces: `buildEvalView(store: Store, opts: { fixturesDir: string; projectDir?: string }): EvalView` where `EvalView = { measured: ScoreReport | null; observed: ObservedMetrics }`.

The endpoint keeps the "no data yet is calm, not an error" contract: if no fixtures exist, `measured` is `null` rather than a thrown error.

- [ ] **Step 1: Write the failing test `tests/evalView.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { buildEvalView } from '../src/eval/view.js';

let dir: string;
let store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalview-')); store = new Store(':memory:'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe('buildEvalView', () => {
  it('returns null measured when there are no fixtures, but still computes observed', () => {
    store.upsertSession({
      sessionId: 's1', projectDir: 'proj', cwd: null, goal: 'g',
      firstTs: '2026-07-01T10:00:00Z', lastTs: '2026-07-01T11:00:00Z',
      messageCount: 4, inputTokens: 0, outputTokens: 0, rateLimitResetAt: null,
      filesEdited: [], commandsRun: [], skillsInvoked: [],
      errorCount: 1, ending: 'clean', lastUserText: null, lastAssistantText: null, skippedLines: 0,
    });
    const view = buildEvalView(store, { fixturesDir: dir, projectDir: 'proj' });
    expect(view.measured).toBeNull();
    expect(view.observed.sessionCount).toBe(1);
    expect(view.observed.endingMix.clean).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/evalView.test.ts`
Expected: FAIL — `Cannot find module '../src/eval/view.js'`.

- [ ] **Step 3: Write `src/eval/view.ts`**

```typescript
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
```

- [ ] **Step 4: Add the route in `src/server/server.ts`**

Add the import near the top (with the other analyzer imports, after `src/server/server.ts:9`):

```typescript
import { buildEvalView } from '../eval/view.js';
import { join } from 'node:path';
```

Add the route after the `/api/audit` handler (after `src/server/server.ts:73`):

```typescript
  app.get('/api/eval', (req, res) => {
    try {
      const fixturesDir = join(process.cwd(), 'tests', 'eval', 'fixtures', 'heldout');
      const projectDir = typeof req.query.dir === 'string' ? req.query.dir : undefined;
      res.json(buildEvalView(store, { fixturesDir, projectDir }));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
```

- [ ] **Step 5: Run test and typecheck**

Run: `npx vitest run tests/evalView.test.ts && npx tsc --noEmit`
Expected: PASS (1 test); typecheck clean.

- [ ] **Step 6: Full suite + build, then commit**

```bash
npx vitest run
npm run build
git add src/eval/view.ts src/server/server.ts tests/evalView.test.ts
git commit -m "feat(eval): GET /api/eval exposing measured scores and observed metrics"
```

---

## Deferred (explicitly not in this plan)

- The React "Eval" dashboard view (`ui/`) that renders `/api/eval` — the UI has no test suite; add it as a manual follow-up once the endpoint is confirmed.
- The ~150-record real labeling pass (manual, human-in-loop; uses Task 6's `eval label`).
- LLM-as-judge scorer, the Oversight Python subprocess `Solver` adapter, and any non-audit classifier.

## Self-Review

- **Spec coverage:** seam (Task 1), serializability/fixtures + sha guard (Task 2), scorer with confusion/confident accuracy/severity/dead-p-r/bijection (Task 3), Observed metrics with the renamed signals (Task 4), orchestrator + write-once label appender (Task 5), CLI + snapshotting + labeling walker (Task 6), train/held-out split + committed baseline + gate (Task 7), endpoint (Task 8). Held-out gate asserts held-out only ✓. `dead` excluded from confident denominator ✓ (`src/eval/score.ts` counts confident only for predicted ∈ CONFIDENT). Renames "file carry-over rate" / "cost per ending outcome" ✓.
- **Placeholder scan:** the only intentional placeholder is `<PASTE_SHA_FROM_STEP_2>` in Task 7, which is computed by the command in the same step — not a plan gap.
- **Type consistency:** `Solver.run` returns `Map<string, Verdict>` everywhere (Tasks 1, 3, 5); `ScoreReport` fields match between `types.ts`, `score.ts`, `formatReport`, and the gate; `ObservedMetrics` fields match between `observed.ts`, the view, and its tests.
