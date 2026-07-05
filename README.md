# claude-dost

A local-only dashboard for your Claude Code history. It reads the transcripts Claude Code
already writes to disk (`~/.claude/projects/**/*.jsonl`), indexes them into a small SQLite
database, and serves a two-view web dashboard for browsing what you've actually done.

## The two views

**Project Briefing** — a per-project timeline of sessions: extracted goal (from your first
message), files edited, commands run, tokens used, duration, and an ending badge
(`clean` / `error` / `abandoned`). The top of the page shows a "where you left off" header
built from the most recent session. Each card has an optional **✨ Polish** button that
shells out to your locally-installed `claude` CLI to rewrite the goal/outcome into a cleaner
one-sentence summary; the result is cached in SQLite so you only pay for it once per session.

**Instruction Audit** — parses your global `~/.claude/CLAUDE.md` and any per-project
`CLAUDE.md` files into discrete rules (one per bullet/paragraph), then cross-examines each
rule against what actually happened in your transcripts. Every rule gets a verdict:

- `violated` — transcript evidence contradicts the rule (with session references)
- `followed` — transcript evidence supports the rule
- `dead` — the rule's subject never came up in any session (looks unused)
- `unchecked` — not enough signal in the rule text to check it either way

Each rule also gets an estimated token cost: `ceil(chars / 4) × sessions` — a rough proxy for
how much of your context window that rule has been consuming, repeated across every session
it was loaded into.

## Install

```bash
npm install
npm run build
```

`npm run build` runs `tsc` (backend) followed by the UI's own build step (see `package.json`);
both need to succeed for the dashboard to have a UI to serve.

## Run

```bash
node dist/cli.js
```

Flags:

- `--port <n>` — HTTP port (default `4756`)
- `--no-open` — don't auto-open a browser tab
- `--claude-dir <path>` — use a Claude directory other than `~/.claude` (mainly for testing)

On first run it indexes every transcript file under `<claude-dir>/projects` into
`~/.claude-dost/index.db`. Later runs only re-index files that changed (by mtime/size), so
startup after the first index is fast.

## Privacy

claude-dost is 100% local:

- It **reads only** your own Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and
  `CLAUDE.md` files (global and per-project).
- It **writes only** to `~/.claude-dost/index.db` (a local SQLite file).
- It makes **no network calls** and has **no telemetry** — nothing is sent anywhere.
- The only process it ever spawns is your already-installed `claude` CLI, and only when you
  explicitly click **Polish** on a session card. If `claude` isn't on your `PATH`, or the
  call fails or times out, Polish silently falls back to the unpolished summary — nothing
  crashes, nothing is sent over the network.

## How the audit works, honestly

The audit is a **static heuristic pass**, not an LLM judgment call. It does not re-read your
transcripts with a model to decide whether a rule was followed — it does string/token
matching. Concretely, per rule:

- Backtick spans (`` `like this` ``) and "strong" bare tokens (words containing `@`, `/`, `.`,
  a digit, or a hyphen — i.e. things that look like commands, paths, or flags) are extracted
  as the rule's identifying tokens.
- Plain-prose words are treated as "weak" tokens — on their own they're not good evidence
  ("always test your changes" contains no proof-worthy token), so a rule that produces no
  strong tokens and no weak-token hits is marked `unchecked` rather than confidently `dead`.
  A rule needs a strong token with **zero** matches anywhere in the corpus to be called `dead`.
- Negation patterns (`never X`, `don't X`, `avoid X`, `use A over B`, `A is banned`) extract a
  "negative" target; if that target shows up in a session's actual commands, the rule is
  `violated`.
- Matching uses word-boundary regexes (`(?<![\w@/.-])token(?![\w@/.-])`) against commands run,
  files edited, and skills invoked — not against arbitrary prose in the transcript, and not
  against assistant reasoning.

**Limitations, spelled out:**

- It cannot understand intent, paraphrase, or context — a rule like "prefer composition over
  inheritance" has no matchable token at all and will sit at `unchecked` forever.
- `followed` only means "the rule's subject came up and the negative form didn't" — it is not
  proof of correct behavior, just absence of the specific violation pattern the heuristic
  looks for.
- `dead` is a guess based on absence of a strong token across all indexed sessions — it does
  not mean the rule is bad, only that this codebase's tokenizer never saw it referenced.
- Token/cost estimates assume ~4 characters per token, a common but rough rule of thumb, not
  a call to a real tokenizer.
- There is no `--deep` LLM-backed audit pass in this version. The polish plumbing (Task 12)
  that shells out to `claude -p` is the reusable piece a future `--deep` mode would build on,
  but v1 ships static-only by design.

## Screenshots

_(placeholder — add screenshots of the Project Briefing and Instruction Audit views here)_

## Development

```bash
npx vitest run     # test suite
npx tsc --noEmit    # typecheck
npm run build       # full build (backend + ui)
```
