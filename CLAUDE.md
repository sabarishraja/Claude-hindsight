# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

claude-hindsight is a 100%-local tool that reads Claude Code's own session transcripts
(`~/.claude/projects/**/*.jsonl`), indexes them into a local SQLite database, and surfaces
"where you left off" through four surfaces: a terminal briefing (default), a web dashboard
(`--web`, three views: Project Briefing / Architecture / Instruction Audit), a Claude Code
statusline (`statusline` subcommand), and a living architecture doc (`architecture`
subcommand). It makes no network calls and has no telemetry — the only external process it
ever spawns is the user's own already-installed `claude` CLI, and only for two opt-in,
LLM-backed features (Polish, and architecture-doc generation).

## Commands

```bash
npm install
npm run build          # tsc (backend) + ui's own vite build — both must succeed for --web to have a UI

npx vitest run          # full test suite (tests/**/*.test.ts only, per vitest.config.ts)
npx vitest run tests/foo.test.ts          # single test file
npx vitest run tests/foo.test.ts -t "name"  # single test by name
npx tsc --noEmit        # typecheck only, no build output

node dist/cli.js                    # terminal briefing for the current directory's project
node dist/cli.js --web              # web dashboard at http://localhost:4756
node dist/cli.js statusline          # one statusline render (reads Claude Code's stdin JSON)
node dist/cli.js architecture        # refresh (if stale) and print the architecture doc
```

There is no separate lint command. The UI (`ui/`) has its own `package.json`/build
(`npm run build --prefix ui`) and no test suite — Audit/Briefing/Architecture views are all
unverified by automated tests, only by manual dashboard checks.

## Architecture

### Data flow: transcripts → index → every surface

Everything starts from Claude Code's own JSONL transcript files. `src/indexer/parseLines.ts`
parses raw JSONL lines into structured records (tool_use blocks, message text); `src/indexer/
indexer.ts` walks `<claude-dir>/projects/**/*.jsonl`, extracts `SessionFacts` (goal, files
edited, commands run, ending, tokens, etc. — the canonical shape is `src/types.ts`), and
`src/indexer/store.ts` (`Store`, backed by `better-sqlite3`) persists them to
`~/.claude-hindsight/index.db`. Re-indexing is incremental: only files whose mtime/size
changed since last run are re-parsed. **Every other surface in this codebase reads from
`Store`, directly or indirectly — none of them re-parse transcripts themselves.**

`Store.INDEX_VERSION` gates schema-affecting changes to fact extraction: bump it and the
`files` mtime-cache table is cleared, forcing a full re-index on next run. The `polish` table
(LLM-rewritten goal/outcome summaries) is a separate cache that survives version bumps, since
it's paid-for LLM output that doesn't depend on fact-extraction logic.

From indexed `SessionFacts`, `src/analyzer/briefing.ts` (`buildBriefing`) derives the
"Project Briefing" view model (cards, "where you left off", ending badges), and
`src/analyzer/audit.ts` + `src/analyzer/instructions.ts` derive the "Instruction Audit" —
parsing CLAUDE.md files into discrete rules and cross-checking each against transcript
evidence via string/token matching (see README.md's "How the audit works, honestly" for the
exact heuristic and its limitations — it is not an LLM judgment call).

### The four surfaces, and how they share the index

- **Terminal briefing** (`src/cli.ts`, `src/terminal/render.ts`) — default `node dist/cli.js`
  behavior; renders `buildBriefing()`'s output as a boxed ANSI panel, or plain text under
  `--plain` (used for the `SessionStart` hook — see README).
- **Web dashboard** (`src/server/server.ts` + `ui/`) — an Express server exposing read-only
  JSON endpoints (`/api/projects`, `/api/projects/:dir/briefing`, `/api/projects/:dir/
  architecture`, `/api/audit`) plus one mutating endpoint (`POST /api/projects/:dir/polish`,
  which shells out to `claude -p` to rewrite goal/outcome summaries, capped at 10 sessions per
  call and guarded against concurrent runs per project via `inFlightPolish`). The React UI
  (`ui/src/`) is a thin fetch-and-render client with no tests.
- **Statusline** (`src/statusline/`) — a `claude-hindsight statusline` subcommand Claude Code
  invokes on every assistant message via the `statusLine` setting. It has a hard, load-bearing
  constraint: **it must never throw, exit nonzero, or print a stack trace**, and it must never
  run the indexer (only ever opens `index.db` `{ readonly: true }` if it exists). Row 1 (last
  finished session) comes from the index; row 2 (live files/commands/cost for the *current*
  session) comes from `liveSession.ts`, which incrementally tails the live transcript via a
  byte-offset state file under `~/.claude-hindsight/statusline/<session_id>.json` — it never
  re-reads bytes already seen. `install.ts` merges the statusLine setting into `settings.json`
  with an automatic backup.
- **Architecture doc** (`src/architecture/`) — a plain-English, continuously-updated markdown
  description of the codebase, aimed at a non-technical reader. `staleness.ts` derives "N
  sessions behind" purely by comparing a stored watermark against the index (no new tracking,
  no hooks, no daemons — this was a deliberate design constraint). `state.ts` stores the doc
  under `~/.claude-hindsight/architecture/<project-key>.md` with **atomic writes**
  (temp-file-then-rename; meta is written only after the rename succeeds, so a
  crash/interrupt can never corrupt or delete an existing doc). `generate.ts` builds two kinds
  of prompts — a full agentic explore (`claude -p --allowedTools Read Glob Grep`, read-only,
  used on first run or `--full`) and a cheap tool-free incremental refresh (previous doc +
  changed files + session goals) — and validates output against the four required section
  headings (anchored to real `##` lines, not substring matching) before it's allowed to
  replace the previous doc. `architecture.ts` (`refreshArchitecture` / `getArchitectureView`)
  is the orchestrator every consumer (CLI, server endpoint, statusline) calls through.

### Cross-platform subprocess gotcha

Two places shell out to the user's installed `claude` CLI: `src/server/polish.ts` and
`src/architecture/generate.ts`. Both **must** use `node:child_process`'s shell-based `exec`
(not `execFile`), because on Windows `claude` is typically installed as an npm shim
(`claude.cmd`), and `execFile` does not do the shell's `PATHEXT`/`.cmd` resolution — this was
a real reproduced bug (ENOENT) that shipped and was fixed. If you add a third caller of the
`claude` CLI, use `exec`, not `execFile`, following the existing pattern (prompt is always
delivered via `child.stdin`, never interpolated into the command string, since no untrusted
data needs to reach argv).

### Conventions

- ESM throughout: relative imports end in `.js` even from `.ts` files (NodeNext resolution).
- Tests live in `tests/`, never at the repo root; one test file generally mirrors one `src/`
  module (e.g. `src/architecture/state.ts` ↔ `tests/architectureState.test.ts`).
- Windows path comparisons are case-insensitive and normalize slashes/trailing separators
  throughout (`cli.ts`, `statusline.ts`) — this matters because the project is developed and
  tested primarily on Windows.
- Every read-only surface (statusline, briefing nudge, dashboard "no doc" states) treats
  "no data yet" and "stale" as calm, non-error states — never a thrown error or a blank crash.
