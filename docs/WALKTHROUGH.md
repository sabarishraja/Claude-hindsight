# Try Claude-Hindsight: a step-by-step walkthrough

A guided tour for someone who has never run this before. Each step says **what to run**,
**what you should see**, and **why it matters**. Nothing here sends data anywhere — the
whole tool is local, so you can try every step and delete one folder to undo it all.

**Time:** ~15 minutes for the core loop, ~30 if you do all of it.

---

## Before you start (30 seconds of expectation-setting)

Hindsight reads the transcripts Claude Code already writes to your disk. That means:

- **It is least impressive on the day you install it.** If you've only used Claude Code
  twice, there's very little history to have hindsight about.
- **Test it in a project you've actually used Claude Code in for a while.** Pick your
  busiest one. That's where you'll see the point.
- If a screen looks empty, that's usually "no data yet," not a bug. The tool is designed to
  treat "nothing to show" as a calm state, never an error.

**You need:** Node 18+, and Claude Code installed with some session history.

**A note on paths.** This guide writes home-directory paths the Unix way — `~/.claude/`,
`~/.claude-hindsight/`. The `~` is shorthand for your home folder, and it only expands
automatically in a Unix-style shell. If you're on Windows in PowerShell or Explorer, translate:

| Written here | On Windows |
| --- | --- |
| `~/.claude/projects/` | `%USERPROFILE%\.claude\projects\` |
| `~/.claude-hindsight/` | `%USERPROFILE%\.claude-hindsight\` |

To see the transcripts this whole tool is built on, look in that first folder — one
subdirectory per project, full of `.jsonl` files. They're already there; that's the point.

---

## Step 1 — Install it

### Option A: as a Claude Code plugin (easiest, recommended)

Inside Claude Code, run:

```
/plugin marketplace add sabarishraja/Claude-hindsight
/plugin install claude-hindsight
```

This gives you two things automatically:
- the **MCP tools** (Claude can ask about your history mid-conversation), and
- the **SessionStart hook** (every new session begins with Claude already briefed).

It does *not* install the statusline — Claude Code's plugin format isn't allowed to set one.
That's Step 4, a separate one-line opt-in.

### Option B: from source (if you want to read/modify the code)

```bash
git clone https://github.com/sabarishraja/Claude-hindsight
cd Claude-hindsight
npm install
npm run build
```

**Command translation:** everywhere below you see `npx claude-hindsight@latest ...`, the
source equivalent is `node dist/cli.js ...`. They do the same thing.

---

## Step 2 — The terminal briefing (start here)

`cd` into a project you've used Claude Code in, then:

```bash
npx claude-hindsight@latest
```

**What you should see:** a boxed panel in your terminal with three parts —

1. **Where you left off** — your most recent session: what you were doing, and a badge for
   how it ended (`clean`, `error`, or `abandoned`/`left open`).
2. **A pending question**, if your last session stopped mid-conversation with Claude waiting
   on you. This is the one people find most useful — it's the thing you'd otherwise have to
   scroll back to find.
3. **Recent sessions** — a short list: goal, how many files were edited, how many commands
   were run, and how it ended.

**First run is slower.** It indexes every transcript on your disk once into
`~/.claude-hindsight/index.db`. After that it only re-reads files that changed, so it's
near-instant.

**What to look at:** do the goals look right? They're extracted from your *first message* in
each session, so a session that started with "hey quick thing" is titled "hey quick thing"
forever. That's a real limitation, not a glitch — see Step 8.

**Why it matters:** this is the Monday-morning problem. Instead of reading your own diff like
a stranger wrote it, you get the story back in two seconds.

Also try:

```bash
npx claude-hindsight@latest --plain    # no colors/boxes; prints nothing if there's no history
npx claude-hindsight@latest --help     # every command and flag in one place
```

---

## Step 3 — Let Claude read the briefing for you

This is the step that changes how the tool feels, so don't skip it.

If you installed the plugin (Option A), **it's already on** — just start a new Claude Code
session in that project.

**What you should see:** at the top of the session, before you type anything, a block of
context showing your recent sessions. Now ask Claude:

> "What was I working on last time?"

**Why it matters:** Claude answers from your actual history instead of guessing or asking you
to explain. You stop being the one who carries context between sessions.

<details>
<summary>Doing it manually (source install / no plugin)</summary>

Add this to `.claude/settings.json` in the project, or your global `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx -y claude-hindsight@latest --plain" }] }
    ]
  }
}
```
</details>

---

## Step 4 — The statusline (always-on, inside Claude Code)

One-time install:

```bash
npx claude-hindsight@latest statusline --install            # global
npx claude-hindsight@latest statusline --install --project  # just this project
```

Plugin users can instead run the bundled slash command: `/claude-hindsight:statusline`.

It backs up your existing settings first and refuses to overwrite a *different* statusline
unless you pass `--force`.

**What you should see** at the bottom of Claude Code, on every message:

- **Row 1** — your previous session's ending badge and goal, plus a ⚠ if it ended on an
  unanswered question.
- **Row 2** — current model, session cost so far, live count of files edited and commands run,
  and how many sessions are indexed.
- **Row 3** — a context-window fill bar, e.g. `Context [██████░░░░] 168K/200K`. It stays hidden
  until the first assistant turn.

**Two things to watch for specifically:**
- If you ever hit a rate limit, Row 2 grows a `resets in 1h 12m` countdown. It only appears
  when Claude Code reported a *real* 429 with a real reset time — it never predicts one from
  your usage. No signal, no countdown.
- Row 1 doesn't update on its own. It refreshes next time the indexer runs (Step 2, or your
  SessionStart hook). This is deliberate: the statusline must never be slow or crash, so it
  only ever does a read-only peek at the database.

**Why it matters for vibe coding:** the live files/commands/cost counters are a cheap sanity
check while the agent works. "It's been eight minutes and touched 14 files" is information you
want *before* you accept the result, not after.

---

## Step 5 — The web dashboard (the full picture)

```bash
npx claude-hindsight@latest --web
```

Opens `http://localhost:4756`. Three views:

### View 1: Project Briefing
The terminal briefing, but as a scrollable per-project timeline: goal, files edited, commands
run, tokens used, duration, ending badge.

**Try the ✨ Polish button** (top of the page). This is one of only two features that call an
LLM. It shells out to your own installed `claude` CLI to rewrite raw first-messages into clean
one-sentence summaries, up to 10 sessions per click, and caches the results — so you pay once
per session, ever. Compare the timeline before and after; the difference between "hey quick
thing" and a real summary is the whole argument for the button.

If `claude` isn't on your PATH, Polish quietly does nothing rather than erroring.

### View 2: Architecture
See Step 6.

### View 3: Instruction Audit
See Step 7.

---

## Step 6 — The living architecture doc

```bash
npx claude-hindsight@latest architecture
```

**First run takes a while** — it does a read-only agent exploration of your codebase (it can
Read/Glob/Grep, and nothing else). Every run after that is a cheap refresh that only looks at
what changed since last time.

**What you should see:** a plain-English description of your project — what it does, its main
parts, how they fit together, and a rolling log of recent changes. It is deliberately written
for someone who works *through* an agent and doesn't read every file.

**What to look at:** is it accurate? Is it readable by a non-engineer? That's the actual bar
it's trying to clear, and it's the most useful thing to give feedback on.

Other commands:

```bash
architecture --print                  # print the cached doc; never refreshes, never calls an LLM
architecture --full                   # force a full re-exploration
architecture --write ARCHITECTURE.md  # also export a copy into your repo
```

The doc lives in `~/.claude-hindsight/architecture/`, **not** in your repo — `--write` is the
only thing that ever creates a file in your project. When it falls behind your actual sessions,
the briefing and statusline show a small "N sessions behind" nudge rather than silently serving
stale text.

**Why it matters for vibe coding:** when you're shipping code you didn't read line-by-line,
this is the map. It's also the thing you paste to a teammate who asks "so what does this repo
actually do?"

---

## Step 7 — The CLAUDE.md audit (and its honest limits)

Open the **Instruction Audit** view in the dashboard (`--web`).

It parses your `CLAUDE.md` files — global and per-project — into individual rules, then checks
each one against what actually happened in your transcripts. Every rule gets:

- `violated` — evidence in your transcripts contradicts the rule
- `followed` — the rule's subject came up and the violation pattern didn't
- `dead` — the rule's subject never appeared in any session; looks unused
- `unchecked` — not enough signal in the rule's text to judge it either way

...plus an estimated **token cost**: roughly how much of your context window that rule has
been eating, repeated across every session it was loaded into.

**What to look at, and this is the interesting part: read the `dead` rules.** Most people find
instructions they wrote months ago that nothing has ever touched — pure context-window rent.
Deleting those is the fastest concrete win the tool offers.

**Now the honest part, because you'll notice it anyway:** this is string matching, not
comprehension. There is no model reading your transcripts here.

- A rule like *"prefer composition over inheritance"* contains nothing matchable and will sit
  at `unchecked` forever.
- `followed` does **not** mean you followed the rule. It means the subject came up and one
  specific violation pattern didn't appear. Weaker claim than the badge suggests.
- `dead` means a tokenizer never saw it referenced — absence of evidence, not proof the rule
  is bad.
- The `violated` check only scans **commands you ran**. Break a rule by editing a file and it
  sails through.
- Token counts use a ~4-characters-per-token rule of thumb, not a real tokenizer. Good enough
  for "this rule is expensive," not good enough for your invoice.

If you want the full reasoning, the README has a section literally titled *"How the audit
works, honestly."*

---

## Step 8 — Ask Claude about your own history (MCP)

If you installed the plugin, Claude has four local tools available mid-conversation. Just ask
in plain English:

- *"What did I work on in this project recently?"* → `get_briefing`
- *"Give me the architecture doc for this repo."* → `get_architecture`
- *"Audit my CLAUDE.md."* → `run_audit`
- *"Refresh the architecture doc."* → `refresh_architecture`

**Why it matters:** the first three are instant local reads that cost no tokens beyond the
answer itself, and none of them can crash your session — an unindexed project just returns a
polite "nothing here yet." `refresh_architecture` is the only one that spends real time and
tokens.

**What to look at:** whether Claude reaches for these on its own when it needs context, or
only when you ask directly.

---

## Step 9 — The companion: Oversight

```
/plugin install oversight
```

Different problem, same suite. Hindsight remembers what happened; **Oversight checks what the
agent claims.** It hooks the moment Claude says it's finished, re-runs your tests and build,
looks at what actually changed on disk, and blocks the handoff if "done, all tests pass" turns
out not to be true.

**What you should see:** with both installed, Hindsight's statusline row grows a verification
tally like `🕵 3✓ 1✗`.

**Why it matters for vibe coding:** "Done! All tests pass" is a sentence an agent will produce
whether or not the tests pass — the work and the report come from the same process. Oversight
separates them.

---

## Step 10 — The eval harness (contributors only)

This one needs a source clone (Option B), because it writes fixtures into the repo.

The audit in Step 7 is a heuristic, so the honest question is *how good is it?* The `eval`
subcommand answers with numbers instead of vibes:

```bash
node dist/cli.js eval snapshot my-project  # freeze this project's sessions + CLAUDE.md into a fixture
node dist/cli.js eval label my-project     # walk each rule, press v/f/d/u for the verdict it SHOULD get
node dist/cli.js eval                       # score the audit against your labels
node dist/cli.js eval --json                # same, machine-readable, for CI
```

**What you should see:** confident accuracy, an abstention rate, a count of missed violations,
and a confusion matrix.

**What to look at:** two numbers matter more than accuracy. **Missed violations** — a false
"all clear" is the expensive error. And **abstention rate** — "I don't know" is a correct
answer, and if you don't track it separately you'll tune it away and end up with a system that
guesses confidently.

Fixtures are committed to the repo, so the score is reproducible and a regression in the
heuristic shows up as a number dropping instead of a vague feeling that something got worse.

---

## How this actually helps when you're vibe coding

Pulling the threads together:

| The problem | What handles it |
| --- | --- |
| You come back Monday with no idea where you were | Terminal briefing + SessionStart hook (Steps 2–3) |
| You re-explain context to the agent every session | The SessionStart hook and MCP tools (Steps 3, 8) |
| You're shipping code you never read | The architecture doc (Step 6) |
| Your CLAUDE.md quietly grew to 400 lines of rules nothing uses | The audit's `dead` verdicts and token costs (Step 7) |
| The agent is 8 minutes in and you can't tell what it's touching | The statusline's live counters (Step 4) |
| "Done, all tests pass" — but is it? | Oversight (Step 9) |
| "Is this heuristic any good, or does it just feel good?" | The eval harness (Step 10) |

---

## Where everything lives, and how to undo it

Hindsight reads only your Claude Code transcripts and `CLAUDE.md` files. It writes only to:

```
~/.claude-hindsight/index.db                   # the session index (SQLite)
~/.claude-hindsight/architecture/<project>.md  # architecture docs
~/.claude-hindsight/statusline/<session>.json  # statusline byte offsets
```

(On Windows: `%USERPROFILE%\.claude-hindsight\` — see the paths note at the top.)

**To undo everything:** delete `~/.claude-hindsight/`, remove the statusLine entry from
`~/.claude/settings.json` (a backup was made when it was installed), and
`/plugin uninstall claude-hindsight`. Your transcripts are untouched — the tool never writes
to them.

No network calls, no telemetry. The only external process it ever starts is your own installed
`claude` CLI, and only for the two opt-in LLM features (Polish, and architecture generation).

---

## What would be genuinely useful to report back

- Any screen that showed an **error** rather than a calm empty state.
- Session goals that were **wrong or useless** — and what the session was really about.
- Audit verdicts you **disagree with**, especially a `followed` that shouldn't be.
- Whether the architecture doc was **accurate**, and whether a non-engineer could read it.
- The thing you **expected it to do and it didn't**. That's the most valuable one.

Issues: https://github.com/sabarishraja/Claude-hindsight/issues
