---
description: Enable the claude-hindsight statusline in your Claude Code settings
---

The user wants to enable the **claude-hindsight statusline** — a two/three-row Claude Code
status bar showing their previous session's story, the current session's live model/cost/files/
commands, a rate-limit reset countdown, any Oversight verification tally, and a context-window
fill bar.

A Claude Code plugin cannot ship a statusline directly (the platform only lets plugins set
`agent` and `subagentStatusLine`), so it must be written into the user's own settings. Do this:

1. Run this command in the user's shell:

   ```
   npx -y claude-hindsight@latest statusline --install
   ```

   This backs up their existing `~/.claude/settings.json`, then adds a `statusLine` entry that
   runs `npx -y claude-hindsight statusline` on each message. It is safe: it **refuses** to
   overwrite a different statusline they already have.

2. Report the exact result to the user:
   - **Installed / updated** → tell them to restart Claude Code (or start a new session) to see it.
   - **Refused because a different statusline already exists** → explain they already have a
     statusline configured, and they can replace it by re-running with `--force` appended:
     `npx -y claude-hindsight@latest statusline --install --force` (their old settings are backed
     up first either way). Do not force it without their say-so.
   - **Refused because settings.json is invalid JSON** → tell them to fix the JSON and retry.

Do not edit `settings.json` by hand — always go through the `--install` command so the backup and
conflict checks run.
