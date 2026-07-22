# Eval Harness — Design Spec

**Date:** 2026-07-22
**Status:** Approved design, pre-implementation
**Scope:** v1 evaluates the CLAUDE.md instruction-audit classifier only.

## Problem

claude-hindsight ships an **Instruction Audit** view. For every rule in a CLAUDE.md it
prints a verdict — `followed` / `violated` / `dead` / `unchecked`. **Nothing has ever
checked whether those verdicts are correct.** The classifier could be wrong a large fraction
of the time and every surface would look identical. The audit heuristic is a token/string
matcher (README already hedges it); it is an unmeasured classifier shipping to users.

An eval harness closes that gap: a hand-labeled answer key, the real classifier re-run over
frozen inputs, and a score that tells us whether a change to the classifier made it better or
worse — deterministic, offline, no network, consistent with the project's identity.

This spec covers two halves:

- **Measured (the harness):** score `auditInstructions()` against a hand-labeled key.
- **Observed (dashboard):** verdict-free descriptive trajectory signals from `SessionFacts`.

Explicitly out of scope for v1: LLM-as-judge, a Python subprocess adapter for Oversight's
claim extractor, evaluating any classifier other than the audit, and any fixed-task agent
benchmark (SWE-bench style).

## The seam (the central design decision)

The classifier is a **pure function** — this is what makes the whole harness cheap and
deterministic:

- `parseInstructions(markdown: string, source: string): Instruction[]` — `instructions.ts:13`
- `auditInstructions(instructions: Instruction[], sessions: SessionFacts[]): AuditReport`
  — `audit.ts:70`

`Store` is touched only by *callers* (`server.ts:66-67`, `mcp/tools.ts:64-65`), never inside
the audit logic. So a fixture needs only `{ markdown, source, sessions: SessionFacts[] }`, and
the harness runs:

```
auditInstructions(parseInstructions(markdown, source), sessions)
```

**No Store shim, no refactor of production code.** The seam is `fixture → direct arg → solver`.

## Fixtures

### Serializability (verified)

Both input shapes are 100% JSON-round-trippable:

- **`SessionFacts`** (`types.ts:3-22`): every field is a JSON primitive, `null`, or
  `string[]`. Timestamps (`firstTs`/`lastTs`) are **ISO strings, not `Date` objects**; the
  three arrays are already `JSON.parse`'d on read (`store.ts:41-49`). No `Date`, `Map`,
  function, or `undefined` (all optionals are explicit `| null`).
- **`Instruction`** (`instructions.ts:1-7`): all JSON-safe — and not even on the critical
  path, since fixtures store `{markdown, source}` and re-derive Instructions via
  `parseInstructions`.

### Rule id stability (load-bearing)

`ruleId = ${source}:${line}` (`instructions.ts:23`). It is **positional**: deterministic and
stable *only as long as the fixture's `markdown` and `source` are frozen byte-for-byte*.
Editing frozen markdown reflows line numbers and silently orphans every label below the edit —
no error thrown. The harness MUST fail loudly if emitted ruleIds and label keys are not in
**exact bijection** (no orphaned label, no unlabeled rule).

### File layout — input and labels are SEPARATE files (write-once by construction)

```
tests/eval/
  fixtures/
    train/     foo.input.json   foo.labels.json     # tune freely; reported soft
    heldout/   bar.input.json   bar.labels.json     # sealed; the gate asserts here only
  baseline.json                                     # committed blessed scores
  audit-eval.test.ts                                # the vitest gate (under tests/ per vitest.config.ts)
```

- `*.input.json` = `{ markdown, source, sessions }` — **frozen, read-only.** No tooling code
  path writes it.
- `*.labels.json` = `{ inputSha256, labels: { ruleId: verdict } }` — the only mutable half.

Separate files make write-once enforceable by construction rather than by convention, and keep
diffs clean (relabeling churns only `*.labels.json`; an input change is an unmistakable diff to
`*.input.json`). `*.labels.json` carries `inputSha256` of the exact input bytes it was labeled
against; the harness recomputes it and fails if it differs (input mutated out from under the
labels).

### Train vs held-out split (anti-overfitting)

Tuning against the same key you score on fits the classifier to that key. With ~150 labels,
seal roughly one-third (~50) into `heldout/` and leave it untouched except when the label spec
itself changes. Tune against `train/`; the hard CI gate asserts against `heldout/` only, so the
gated number stays an honest generalization estimate. `train/` is reported as a soft metric and
a regression tripwire, never the number you optimize toward.

**Known limitation:** a single fixture set is still an overfitting risk as it's tuned. The
held-out split mitigates but does not eliminate it; the honest posture is to grow the labeled
set over time.

## Labeling

### Discipline (spec preamble, ship verbatim)

> Each label is the verdict the audit **should output given exactly these frozen
> `SessionFacts`, and nothing else**. The solver observes only `commandsRun`, `filesEdited`,
> and `skillsInvoked` (`audit.ts:73-75`); it never reads message text, goals, or intent.
> Therefore label from the evidence present in the fixture's `sessions` array alone — not from
> your general recollection of whether you follow the rule in practice. If a rule was in fact
> followed but no command/file/skill token in these frozen sessions shows it, the correct label
> is `unchecked` or `dead`, not `followed`.

### `eval label` CLI

A subcommand following the existing `statusline` / `architecture` pattern that walks unlabeled
rules one at a time and records a verdict per rule. It opens `*.labels.json` read/write and
`*.input.json` **read-only** — there is no code path that writes the input half. Target ~150
labels in ~45 minutes rather than an evening.

### Getting to ~150 labels

Your CLAUDE.md against real frozen sessions, plus 2-3 other projects from the index, plus
hand-authored adversarial fixtures targeting the weak-token path (e.g. a rule whose only
overlap with a session is an incidental weak token like `tests`).

## Scoring

The solver emits **one verdict per rule** from a 4-way enum. `dead` and `unchecked` are both
**abstentions** — the classifier declining to judge — and are categorically different from a
confident wrong answer. The scorer therefore reports, never a single headline number:

- **4×4 confusion matrix** — the real artifact; shows *which way* it is wrong.
- **confidentAccuracy** — accuracy over confident predictions only. **Denominator =
  `violated` + `followed`.** Both `dead` and `unchecked` are excluded.
- **abstention rate** — share of rules the classifier declined to judge.
- **violatedMisses** — the severity count: rules whose true label is `violated` that the
  classifier called `followed` (or otherwise missed). The expensive error class.
- **dead precision/recall** — reported as a **separate, ungated informational metric** (see
  below).

### Why `dead` is handled specially

The solver emits `dead` (`audit.ts:99-110`) only when the rule anchors on a *strong* positive
token (path, flag, dotted name, backtick span) and **no** token of the rule — positive or
negation — appears anywhere across every frozen session. Hand-labeling `dead` correctly
requires confirming a *global absence* across the whole session set, which is error-prone.
Excluding it from the confident denominator keeps an error-prone class from dominating a small
score, while reporting its precision/recall separately preserves the signal that dead-detection
works.

## The gate (vitest, `tests/eval/audit-eval.test.ts`)

Absolute floors are meaningless at N≈150 (one flipped verdict ≈ 1%). The gate is
**committed-baseline non-regression + a severity hard-assert + a soft accuracy warn**. Blessed
numbers live in `tests/eval/baseline.json`. A legitimate improvement or a label-key correction
re-blesses the baseline **in the same PR**, so the change is reviewable in the diff rather than
hidden behind a magic float. The gate is human-in-the-loop when the key itself is wrong — that's
acceptable and expected, not a purely mechanical check.

Assertions run against the **held-out** report:

```ts
// HARD — severity: never regress on the confident, high-cost class. Target 0.
expect(report.violatedMisses).toBeLessThanOrEqual(baseline.violatedMisses);

// HARD — monotone non-regression on confident accuracy (no bare float).
expect(report.confidentAccuracy).toBeGreaterThanOrEqual(baseline.confidentAccuracy);

// SOFT — nudge to re-bless when you legitimately improve.
if (report.confidentAccuracy > baseline.confidentAccuracy) {
  console.warn(`accuracy improved ${baseline.confidentAccuracy}→${report.confidentAccuracy}; re-bless baseline.json`);
}

// HARD — orphan guard (see rule-id stability).
expect(report.orphanedLabels).toEqual([]);
expect(report.unlabeledRules).toEqual([]);
```

## Module structure

```
src/eval/
  types.ts     EvalFixture, LabeledRule, SolverOutput, ScoreReport
  fixtures.ts  load + validate frozen JSON; recompute & verify inputSha256; bijection check
  solvers.ts   Solver interface; auditSolver wraps auditInstructions()
  score.ts     confusion matrix, confidentAccuracy, abstention, violatedMisses, dead p/r
  run.ts       orchestrator — the single entry point CLI + test + endpoint call
```

`Solver` is an **interface**, not a hardcoded call. v1's only implementation wraps
`auditInstructions()`. A future subprocess adapter (Oversight's Python extractor) can plug in
through the same seam without touching the scorer — deferred, but the interface reserves the
space.

Two CLI subcommands (existing `statusline`/`architecture` pattern):

- `claude-hindsight eval label` — the labeling walker (above).
- `claude-hindsight eval` — run the harness, print the confusion matrix.

## Dashboard: the "Observed" panel (verdict-free)

A fourth **Eval** view with two clearly separated panels; the separation is the point.

**Top — "Measured":** confusion matrix, confidentAccuracy, abstention rate, violatedMisses,
dead p/r, and the held-out fixture count. These have ground truth; they are defensible.

**Bottom — "Observed":** descriptive trajectory signals from indexed `SessionFacts`, with
**no ground truth**, labeled as descriptive rather than scored. All names are deliberately
verdict-free:

- **file carry-over rate** — fraction of a session's `filesEdited` also edited in the
  immediately preceding session. (Replaces "rework rate", which smuggled a badness verdict —
  cross-session edits are often healthy iteration.)
- **cost per ending outcome** — tokens/cost split across all three endings. (Replaces "cost
  per clean ending", which presupposed clean is the target.)
- **ending mix** — distribution over `ending` (`clean`/`error`/`abandoned`). Kept as-is; it's
  a distribution report, and any valence lives in the `SessionEnding` enum, not the panel.
- **tool-error density** — `errorCount / messageCount`. Kept (optionally so named to make
  clear it counts tool-result failures, `types.ts:17`, not user mistakes).

One new read-only endpoint `GET /api/eval` (existing Express read-only pattern). Everything
reads from `Store` — no transcript re-parsing, no network, no `claude` CLI calls anywhere in
v1.

## Testing

- `tests/eval/audit-eval.test.ts` — the gate above, collected by the existing
  `tests/**/*.test.ts` glob (`vitest.config.ts`), no config change.
- Unit tests for `score.ts` (confusion-matrix math, denominator exclusions) and `fixtures.ts`
  (sha mismatch → throw, bijection failure → throw) with tiny synthetic fixtures.

## Invariants preserved

- No network, no telemetry, deterministic default scorers.
- Every surface reads from `Store`; nothing re-parses transcripts.
- No `Co-Authored-By` / AI-attribution trailer on any commit in this repo.
