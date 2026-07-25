# Your AI Agent Says "All Tests Pass." Oversight Doesn't Take Its Word for It.

## Building a supervisor that re-checks the diff, the tests, and the exit codes before it believes "done"

There's a specific sentence a coding agent gives you that you learn to distrust:

> "All tests pass. I created `src/api/routes.py`. Done!"

Sometimes it's true. Sometimes the test suite was never run. Sometimes the file doesn't
exist. Sometimes the build has been broken for three messages and the agent is cheerfully
reporting success on top of the rubble. The agent isn't lying, exactly — it's *predicting*
that the work is done, and prediction and verification are not the same thing. But you find
out which one you got only after you've closed the loop and moved on.

I built [Oversight](https://github.com/sabarishraja/Claude-oversight) so a machine finds out
first.

Oversight is the second half of a two-tool suite. Its sibling,
[Hindsight](https://github.com/sabarishraja/Claude-hindsight), *remembers* what your sessions
did. Oversight *verifies* what they claim. One idea, two failure modes: memory that forgets is
useless, and a "done" you can't trust is worse than no "done" at all.

---

## The idea in one screen

Claude Code fires a **Stop** hook the moment an agent finishes its turn. Oversight hooks that
moment, reads the agent's final message, and — before the handoff reaches you — checks the
claims against the *real* environment:

```
Agent: "All tests pass. I created src/api/routes.py. Done!"
          │
          ▼  Stop hook fires
   ┌──────────────────────────────────────────────┐
   │ 1. map claims  → tests_pass, file_created    │
   │ 2. re-run      → pytest … exit code 1        │
   │ 3. cross-check → src/api/routes.py missing   │
   │ 4. verdict     → BLOCK                        │
   └──────────────────────────────────────────────┘
          │
          ▼  re-injected into the agent's own context
"CLAIM VERIFICATION FAILED. You claimed 'All tests pass' but
 pytest exited with code 1. You claimed you created
 src/api/routes.py but it does not exist. Do not repeat the claim…"
```

The key move is the last one. Oversight doesn't just log the discrepancy for you to find
later — it **blocks the handoff and injects a correction back into the agent's context**,
forcing it to reconcile before you ever see the false "Done!". The verification is independent
of the agent that made the claim. That independence is the whole point; an agent grading its
own homework is the problem, not the solution.

---

## What's new: it's a Claude Code plugin now, and it lives in your statusline

Oversight started life as a standalone Python tool you installed with `pip` and wired into your
hooks by hand. The recent work turned it into something you can adopt in one line and watch in
real time.

**One-install through the Hindsight marketplace.** No clone, no `pip`, no manual hook editing.
The plugin ships its own hook entry that bootstraps from the checkout — you just need Python
3.11+ on your PATH.

```
/plugin marketplace add sabarishraja/Claude-hindsight
/plugin install oversight
```

**A live statusline tally.** When both tools are installed, Hindsight's statusline shows
Oversight's verdict count for the current session, inline, updating as verifications land:

```
🕵 3✓ 1✗
```

That little segment is doing more than counting. It reads Oversight's per-project
`history.jsonl`, tallies pass/fail for *this* session only, names the most recent failed check
kind so you know *what* broke without opening anything, and dedupes the double-fired Stop events
Claude Code sometimes emits (two identical verifications seconds apart are one verification, not
two). It shows nothing at all when there's nothing verified — an unverifiable or skipped check
never inflates the count.

---

## What it actually checks

Oversight maps the agent's free-text final message to a small set of checkable assertions. This
is the hard part of the whole tool, and it's deliberately conservative:

| What the agent said | What Oversight does |
|---|---|
| "tests pass", "the suite is green" | re-runs your test command, trusts **only** the exit code |
| "build succeeds", "compiles cleanly" | re-runs your build command |
| "lint/typecheck passes" | re-runs your lint command |
| "created `src/x.py`" | file exists (git status cross-checked) |
| "updated `src/x.py`" | file exists **and** git actually sees an edit |
| "ran `npm test` successfully" | re-runs it — only if it matches a configured command |
| bare "done" / "everything works" | runs the test command, if one is configured |

It auto-detects your test/build/lint commands from `package.json`, `pyproject.toml`, a
`Makefile`, and friends (`oversight detect` shows what it found); you can override any of it in
a small `.oversight.json`.

And — this matters more than it looks — **negations and hedges extract nothing.** "Tests are
failing," "this should pass," "I haven't run the suite yet" produce zero assertions. An honest
failure report is never punished. The tool only ever fires on claims stated as accomplished
fact.

Here's a real one, from my own machine. Earlier in the session where I wrote this article, I
told the user a bug fix was verified: *"Full suite is green (231 tests, +8 new)…"*. Oversight
caught that claim on the Stop hook, re-ran `npm run test` itself, watched it exit 0 in 3.2
seconds, and recorded a `tests_pass` **PASS**. In the same session I referenced a Windows path
outside the working directory, and it logged that as **unverifiable** — not a failure, just
outside what it can honestly check. That's the tool doing exactly what it says: trusting nothing
it can't re-run.

---

## The pros — and they're mostly about restraint

The features people expect are the checks. The features that make it *safe to leave on* are the
ones about what it refuses to do.

**It fails open.** Any internal error — a bug in Oversight itself, a weird transcript, a
config it can't parse — allows the stop and logs quietly to `.oversight/log.txt`. A supervisor
that can trap your session is worse than no supervisor. So it can't.

**It can't loop.** It never blocks when Claude Code's `stop_hook_active` flag is set, and never
more than `max_blocks` (default 2) times per session. After the cap, it stops blocking and
merely reports to `.oversight/reports/<session>.md`. A wrong agent and a strict supervisor could
otherwise ping-pong forever; this makes sure they don't.

**It never touches your repo.** Verification re-runs *your* configured commands and reads git
status. It never runs a command lifted from the agent's claim text. The agent could write "I ran
`rm -rf /` successfully" and Oversight would check your test command, not that.

**It's bounded.** Per-command and total time budgets, at most five assertions per claim, and a
command that times out counts as *unverifiable* — never as failed. Slowness is not a lie.

**It trusts exit codes, not adjectives.** "The suite is green" earns nothing. `pytest` exiting 0
earns the pass. There is no model in the loop deciding whether output "looks successful."

---

## The cons — the section I'd want to read

I'll be as honest about this tool as its own README is, which says out loud that four of its six
pieces are commodity plumbing and the value is in the other two.

**The claim mapper is rules, not comprehension.** It's regexes and token patterns, not a model
that understands English. That's a deliberate trade — it's fast, free, deterministic, and can't
hallucinate a claim that wasn't made — but it has the failure modes of all pattern matching. Word
a completion creatively enough ("green across the board, we're good") and it may extract nothing
and stay silent. There's an opt-in LLM-assist mode (`claude -p`, off by default) for exactly the
claims the rules miss, but by default the rules are the whole story, and the rules are literal.

**It only checks what it can reduce to five kinds.** `tests_pass`, `build_succeeds`,
`lint_clean`, `file_created`, `file_modified`. A claim like "I refactored the auth flow to be
cleaner" is not checkable by re-running a command, so Oversight has no opinion on it. It verifies
that things *ran* and *exist* — not that they're *correct*. A test suite that exits 0 while
asserting nothing sails straight through, because the exit code is all it trusts. Green is not
the same as right, and Oversight only checks green.

**`file_modified` proves existence, not intent.** It confirms the file is there and git sees an
edit. It cannot tell you the edit did what the agent said it did. "Done" that passes Oversight is
"the mechanics check out," not "the work is correct."

**Fail-open cuts both ways.** The property that keeps a supervisor bug from trapping your session
also means a supervisor bug silently lets a bad handoff through. I chose availability over
coverage on purpose — a verifier you have to disable because it keeps breaking your flow verifies
nothing — but it's a real gap, not a free lunch.

**A determined wrong agent gets through after two blocks.** `max_blocks` defaults to 2, then
Oversight backs off to reporting-only. This is the anti-loop guarantee doing its job, but it does
mean the gate is a speed bump with a limit, not a wall. You can raise the cap; you can't have
both an infinite wall and a loop-free guarantee.

**It's Python 3.11+ on your PATH**, and the dashboard's login is convenience-grade — a generated
password over plain localhost HTTP, meant for your own machine, not a hosted service.

---

## There's a dashboard, too

```
oversight dashboard --open        # http://127.0.0.1:7717
```

A read-only, password-protected local web view of the project's verification history: blocked
and allowed totals, a per-session timeline of every intercepted claim, and click-to-expand
evidence — the exact command run, its exit code, the tail of its output. It auto-refreshes every
three seconds, so you can leave it open and watch verdicts land while an agent works. Standard
library only, bound to `127.0.0.1`.

---

## Should you use it?

**Yes, if** you run agents on projects with a real test or build command and you've ever been
burned by a confident "done" that wasn't. The whole value proposition is that the check is
independent of the thing being checked, and you get that the moment you install it.

**Not really, if** your project has no automated verification for it to re-run. Oversight is a
force multiplier on the checks you already have; it does not invent them. On a repo with no tests
and no build, most claims come back `unverifiable`, which is honest but not very useful.

**And not, if** you expected it to judge whether the code is *good*. It checks that the agent's
factual claims survive contact with reality — the tests ran, the file exists, the build's green.
Correctness review is a different tool, and pretending otherwise would be exactly the kind of
overclaiming Oversight exists to catch.

```
/plugin marketplace add sabarishraja/Claude-hindsight
/plugin install oversight
/plugin install claude-hindsight
```

Both halves are MIT, both run locally, and the code is there to read. The most useful thing you
could send me is the false "done" it *didn't* catch.

---

*Oversight is open source at
[github.com/sabarishraja/Claude-oversight](https://github.com/sabarishraja/Claude-oversight).*
