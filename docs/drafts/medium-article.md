# Your Coding Agent Has Amnesia. The Cure Was Already on Your Disk.

## Building Claude-Hindsight — and being honest about what it can't do

You close the laptop mid-task on a Thursday. Monday morning you open it again, and the
context is gone. Not your code — the code is fine. What's gone is everything *around* the
code: what you were trying to do, which of the four approaches you'd already ruled out, why
that one file has a half-finished function in it, whether the tests were passing when you
stopped.

So you spend twenty minutes doing archaeology on your own repository. You read your own diff
like a stranger wrote it.

This is the part of working with a coding agent that nobody warned me about. The agent is
brilliant within a session and a blank slate between them. Every morning is a cold start,
and the cost isn't the agent's — it's yours, because you're the one reconstructing the story.

I built [Claude-Hindsight](https://github.com/sabarishraja/Claude-hindsight) to stop paying
that tax.

---

## The realization: the data was already there

Here's the thing that turned this from an idea into a weekend: **Claude Code already writes
everything down.**

Every session you run leaves a complete JSONL transcript on your disk, under
`~/.claude/projects/`. Every message, every tool call, every file edited, every command run,
every token spent. It's all sitting there, right now, on the machine you're reading this on.
Nobody's reading it.

That's a strange situation. The memory problem everyone complains about isn't a *capture*
problem. It's an *indexing* problem. The tape exists; there's just no player.

So Hindsight is the player. It walks those transcripts, extracts structured facts from each
session — goal, files edited, commands run, how it ended, what it cost — and writes them to a
small SQLite database. Then it shows you that history in the four places you'd actually want
it:

- **A terminal briefing.** Run it in any project and it prints where you left off. Wire it to
  Claude Code's `SessionStart` hook and it greets you automatically, so Claude opens each
  session already knowing what happened in the last one.
- **A web dashboard.** A per-project timeline: goals, files, commands, duration, and an ending
  badge — `clean`, `error`, or `abandoned`.
- **A statusline inside Claude Code.** Your last session's ending, the current session's cost
  and live file/command counts, and a context-window fill bar — always visible, never in the
  way.
- **A living architecture document.** A plain-English description of your codebase that
  refreshes as the code drifts, written for someone who works *through* an agent and doesn't
  read every file.

And one that surprised people: it **audits your `CLAUDE.md`** against what actually happened,
flagging rules as followed, violated, dead, or unchecked.

Then, because a briefing you have to go look at is just another dashboard, it became an **MCP
server** — four local tools, so Claude can pull its own history mid-conversation instead of
waiting for you to show it.

---

## The bet

Every design decision in this tool comes from one bet, and I want to name it, because both
the pros and the cons fall out of it:

> **Do as much as possible with static, local analysis. Call an LLM almost never.**

The obvious way to build this is to have a model read your transcripts and summarize them.
That's easier to write and it produces prettier output. I didn't do that.

Instead, everything is string matching, token counting, and SQL. Two features touch an LLM at
all — the optional "Polish" button that rewrites summaries, and architecture-doc generation —
and both are opt-in, both shell out to the `claude` CLI you already have, and both cache their
results so you pay once.

Everything else is free, instant, and offline.

---

## What the bet buys you (the pros)

**It's genuinely private.** Not "private" in the enterprise-marketing sense. It makes zero
network calls and has zero telemetry. It reads your transcripts, writes one SQLite file to
`~/.claude-hindsight/`, and that's the entire I/O surface. Your session history is some of the
most sensitive data you own — it's a transcript of you thinking, with your file paths and
client names in it. That data should not need a privacy policy. It should just never leave.

**It's free and instant.** The briefing renders in milliseconds and costs nothing. This is not
a small thing. A memory tool that costs tokens is a memory tool you turn off during a busy
week — and a busy week is exactly when you need it.

**It can't hallucinate the facts.** You edited that file or you didn't. You ran that command or
you didn't. There's no model in the loop to invent a plausible-sounding session that never
happened. When Hindsight tells you what you did, it's reading a record, not generating one.

**It degrades quietly.** The statusline has one hard rule: never throw, never exit nonzero,
never print a stack trace. No data yet, stale doc, missing database — all calm, non-error
states. A tool that lives in your prompt has to be more reliable than the thing it's
reporting on.

**It only shows what it actually knows.** The statusline shows a rate-limit countdown only
when Claude Code reported a real `429` with a real reset time. It never predicts one from your
usage pattern. No signal, no countdown — silence beats a confident guess.

---

## What the bet costs you (the cons)

This is the section most tool write-ups skip. It's the one I'd want to read.

**The audit is dumber than it sounds.** "It audits your CLAUDE.md" implies comprehension. It
has none. It extracts identifying tokens from each rule — backticked spans, and bare words that
look like commands or paths (containing `@`, `/`, `.`, a digit, or a hyphen) — and matches them
against your commands, files, and skills with word-boundary regexes. That's it. So:

- A rule like *"prefer composition over inheritance"* has no matchable token in it. It will sit
  at `unchecked` forever. The audit will never have an opinion about it.
- `followed` does **not** mean you followed the rule. It means the rule's subject came up and
  the one specific violation pattern the heuristic looks for didn't. That is a much weaker
  claim, and it's the claim the badge is quietly making.
- `dead` doesn't mean the rule is bad. It means a tokenizer never saw it referenced. Absence of
  evidence, wearing a verdict's clothing.
- The `violated` check only scans **commands you ran**. Break a rule by editing a file and it
  sails through.

I chose static matching deliberately — an LLM audit would cost tokens on every run and could be
confidently wrong, which is worse than being visibly limited. But "visibly limited" is only a
defense if you actually make it visible. Hence this section, and hence a "How the audit works,
honestly" heading in the README.

**The token numbers are estimates.** Cost and token figures use the ~4-characters-per-token rule
of thumb, not a real tokenizer. Fine for "this rule is expensive." Not fine for your invoice.

**The context bar can undercount.** It assumes a 200K window, because nothing in the local
signal distinguishes the opt-in 1M-context beta from the default. Run the beta and the bar
reads pessimistically. I'd rather ship the honest wrong number and document it than guess.

**The goal is just your first message.** Session goals are extracted, not understood — so a
session that opens with "hey, quick thing" is a session titled "hey, quick thing" forever.
Garbage in, garbage on the timeline.

**And the one I found while writing this article: Hindsight was indexing itself.** Architecture-doc
generation and Polish shell out to the real `claude` CLI — which makes Claude Code write its own
transcript into `~/.claude/projects/`, which the indexer then picked up as one of *my* sessions.
My own briefing, while I was drafting this piece, listed two recent "sessions" whose goal was
`You maintain a living architecture document…` — that's Hindsight's own prompt to itself, sitting
in my history pretending to be work I did. Writing the honest-limitations section is what made me
go look.

I fixed it before publishing: the indexer now recognizes the transcripts its own `claude` calls
leave behind — by the stable opening line of each prompt it sends — and drops them, purging any a
previous version had already stored. On my machine the indexed-session count fell from 30 to 25 the
moment I re-ran it; five ghosts, gone. But I'm leaving the story in, because it's the exact failure
mode this whole design was supposed to avoid: I trusted the transcript as ground truth, and forgot
I was also a thing that writes transcripts. A tool that reads everything on your disk has to
remember it's on the disk too.

**Also, plainly:** the statusline can't ship through Claude Code's plugin format (plugins may
only set `agent` and `subagentStatusLine`), so it's a separate one-command opt-in. And the web
UI has no automated tests — the backend has a couple hundred, the React views have zero, and
they're verified by me clicking around.

---

## The other half: remember vs. verify

Building this surfaced a second problem, and it needed a different tool.

Agents are good at doing the work and unreliable at reporting on it. "Done! All tests pass" is a
sentence an agent will emit whether or not the tests pass. Hindsight can tell you what happened,
but by the time it does, you've already accepted the handoff.

So there's a sibling: **[Oversight](https://github.com/sabarishraja/Claude-oversight)**. It hooks
the moment the agent says it's finished, re-runs your tests and build, checks what actually
changed on disk, and blocks the handoff if the claim doesn't survive contact. When both are
installed, Hindsight's statusline shows Oversight's tally inline: `🕵 3✓ 1✗`.

Two tools, one idea: **remember what happened, verify what's claimed.** They're separate because
they fail differently. Memory that lies to you is useless; verification that forgets is just a
test runner.

---

## Should you use it?

**Probably yes if** you use Claude Code most days, across more than one project, and you've felt
the Monday-morning reconstruction tax. The briefing-at-session-start hook alone is worth the
install.

**Probably not if** you use an agent occasionally on one small repo. There's no history to have
hindsight about. The tool gets more useful the more transcripts you've accumulated, which means
it's least impressive on the day you install it — an awkward property for something you're
trying to convince people to try.

**Definitely not if** you want the audit to be a linter. It isn't one, it won't become one by
staring at it, and the section above is me trying very hard to prevent that disappointment.

```
/plugin marketplace add sabarishraja/Claude-hindsight
/plugin install claude-hindsight
/plugin install oversight
```

It's MIT, it's local, and the code is there to read. The most useful thing you could send me is
the thing you expected it to do that it didn't.

---

*Claude-Hindsight is open source at
[github.com/sabarishraja/Claude-hindsight](https://github.com/sabarishraja/Claude-hindsight).*
