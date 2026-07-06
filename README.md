# Claude-Hindsight

Hindsight for your Claude Code history — 100% local. It reads the transcripts Claude Code
already writes to disk (`~/.claude/projects/**/*.jsonl`), indexes them into a small SQLite
database, and shows you where you left off: as a boxed briefing right in your terminal
(default), or as a three-view web dashboard (`--web`) with a living architecture doc and a
full CLAUDE.md instruction audit. It also plugs directly into Claude Code itself via a
statusline and a `SessionStart` hook, so you don't have to run a separate command to see it.

## The three dashboard views

**Project Briefing** — a per-project timeline of sessions: extracted goal (from your first
message), files edited, commands run, tokens used, duration, and an ending badge
(`clean` / `error` / `abandoned`). The top of the page shows a "where you left off" header
built from the most recent session, with a single per-project **✨ Polish** button that
shells out to your locally-installed `claude` CLI to rewrite the goal/outcome of unpolished
sessions into cleaner one-sentence summaries; results are cached in SQLite so you only pay
for it once per session.

**Architecture** — a living, plain-English description of the codebase itself: what it does,
its main parts, how they fit together, and a rolling log of recent changes — written for
someone who relies on Claude Code and doesn't read the code directly. See the "Architecture"
section under Run below for how it's generated and kept fresh.

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

The default is a **terminal briefing** — run it inside any project you've used Claude Code in,
and it prints a boxed panel right in your terminal: where you left off, the pending question if
your last session ended mid-conversation, and your recent sessions with ending badges. No
server, no browser.

```bash
node dist/cli.js            # terminal briefing for the current directory's project
node dist/cli.js --web      # full web dashboard (Briefing + Instruction Audit)
```

Flags:

- `--web` — serve the web dashboard at `http://localhost:4756` instead of printing to the terminal
- `--plain` — no colors/box-drawing, silent when the directory has no history (for hooks/pipes)
- `--port <n>` — HTTP port for `--web` (default `4756`)
- `--no-open` — with `--web`, don't auto-open a browser tab
- `--claude-dir <path>` — use a Claude directory other than `~/.claude` (mainly for testing)

### Statusline: hindsight inside every Claude Code session

`claude-hindsight statusline` renders a two-row Claude Code statusline: row 1 is
your previous session's story (ending badge, goal, and a ⚠ marker if it ended on
an unanswered question); row 2 shows the current model, session cost, live
files-edited/commands-run counts, and how many sessions are indexed.

```bash
node dist/cli.js statusline --install            # wire into ~/.claude/settings.json
node dist/cli.js statusline --install --project  # this project's .claude/settings.json instead
```

`--install` backs up your existing settings first and refuses to replace a
different statusLine unless you pass `--force`. It never runs the indexer —
row 1 updates when you next run `claude-hindsight` (or your SessionStart hook).

### Architecture: a living map of your codebase

`claude-hindsight architecture` maintains a plain-English doc of your project —
what it does, its main parts, how they fit together, and a rolling log of recent
changes — for someone who relies on Claude Code and doesn't read the code
directly. The first run does a deep, read-only agent exploration of your
codebase; every run after that is a cheap refresh that only looks at what
changed since the last one, using the same session index as the briefing.

```bash
node dist/cli.js architecture             # refresh (if stale) and print
node dist/cli.js architecture --full      # force a full re-exploration
node dist/cli.js architecture --write ARCHITECTURE.md   # also export to a repo file
node dist/cli.js architecture --print     # print the cached doc only, no refresh
```

The doc lives under `~/.claude-hindsight/architecture/`, not in your repo —
`--write` is the only thing that ever touches a file in your project. The
terminal briefing, statusline, and web dashboard all show a small nudge when
the doc has fallen behind the sessions you've actually run.

### MCP: query hindsight live, mid-conversation

`claude-hindsight mcp` runs an MCP server over stdio exposing four tools so Claude can check
in on hindsight's data whenever it's useful, not just at session start:

- `get_briefing` — the current project's recent sessions and "where you left off" state.
- `get_architecture` — the cached architecture doc and how stale it is.
- `run_audit` — the CLAUDE.md instruction audit for this project (and the global one).
- `refresh_architecture` — regenerates the architecture doc. The only tool that spends time
  or tokens; everything else is a fast, local read.

None of these ever run the indexer or spend tokens except `refresh_architecture`, and none of
them ever throw — an unindexed project or missing doc just returns a calm, informative result.
See "Claude Code plugin" below for the easiest way to wire this in.

### Install as a Claude Code plugin (recommended)

The easiest way to get hindsight's MCP tools and session-start briefing working in a project,
with no clone and no build step:

```
/plugin marketplace add sabarishraja/Claude-hindsight
/plugin install claude-hindsight
```

This wires up both the MCP server (`npx claude-hindsight@latest mcp`, launched automatically)
and the `SessionStart` hook. Toggle it on or off per project the same way as any other Claude
Code plugin. Requires publishing this package to npm first (`npm publish`) so `npx` can resolve
it without a local clone.

### Show your briefing to Claude at session start

The panel in Claude Code's own welcome screen isn't extensible, but you can do one better:
inject the briefing into Claude's context so it *knows* where you left off. Add a
`SessionStart` hook to `.claude/settings.json` in a project (or your global settings):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node <path-to>/dist/cli.js --plain" }] }
    ]
  }
}
```

Now every new session starts with Claude already briefed on your recent work in that project.

On first run it indexes every transcript file under `<claude-dir>/projects` into
`~/.claude-hindsight/index.db`. Later runs only re-index files that changed (by mtime/size), so
startup after the first index is fast.

## Privacy

claude-hindsight is 100% local:

- It **reads only** your own Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and
  `CLAUDE.md` files (global and per-project).
- It **writes only** to `~/.claude-hindsight/index.db` (a local SQLite file).
- It makes **no network calls** and has **no telemetry** — nothing is sent anywhere.
- The only process it ever spawns is your already-installed `claude` CLI, and only when you
  explicitly click the per-project **Polish** button in the briefing header. If `claude`
  isn't on your `PATH`, or the call fails or times out, Polish silently falls back to the
  unpolished summary — nothing crashes, nothing is sent over the network.

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
  `violated`. The `violated` check only scans **commands run** — it does not look at files
  edited or skills invoked.
- Matching uses word-boundary regexes (`(?<![\w@/.-])token(?![\w@/.-])`). The `followed` and
  `dead` verdicts scan a broader corpus — commands run, files edited, and skills invoked —
  but never arbitrary prose in the transcript or assistant reasoning.

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

## Command reference

| Command | What it does |
| --- | --- |
| `node dist/cli.js` | Terminal briefing for the current directory's project |
| `node dist/cli.js --web` | Web dashboard (Briefing + Architecture + Instruction Audit) at `http://localhost:4756` |
| `node dist/cli.js --plain` | No colors/box-drawing; silent if the directory has no history (for hooks/pipes) |
| `node dist/cli.js --port <n>` | HTTP port for `--web` (default `4756`) |
| `node dist/cli.js --no-open` | With `--web`, don't auto-open a browser tab |
| `node dist/cli.js --claude-dir <path>` | Use a Claude directory other than `~/.claude` (mainly for testing) |
| `node dist/cli.js statusline` | Render one two-row statusline frame from Claude Code's stdin JSON (used internally by the statusLine setting, not run by hand) |
| `node dist/cli.js statusline --install [--project] [--force]` | Wire the statusline into `~/.claude/settings.json` (or `--project` for this project's `.claude/settings.json`) |
| `node dist/cli.js architecture` | Refresh the architecture doc if stale, then print it |
| `node dist/cli.js architecture --full` | Force a full re-exploration of the codebase (agentic, read-only) instead of an incremental refresh |
| `node dist/cli.js architecture --write <path>` | Also export the current doc to a file in your repo |
| `node dist/cli.js architecture --print` | Print the cached doc only — never refreshes, never calls an LLM |

## Screenshots

_(placeholder — add screenshots of the Project Briefing, Architecture, and Instruction Audit views here)_

## Development

```bash
npx vitest run     # test suite
npx tsc --noEmit    # typecheck
npm run build       # full build (backend + ui)
```
