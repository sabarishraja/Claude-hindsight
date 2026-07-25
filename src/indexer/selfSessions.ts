import { FULL_PROMPT_SIGNATURE, INCREMENTAL_PROMPT_SIGNATURE } from '../architecture/generate.js';
import { POLISH_PROMPT_SIGNATURE } from '../server/polish.js';

// Hindsight shells out to the user's own `claude` CLI for two opt-in, LLM-backed features
// (Polish and architecture-doc generation). Each of those calls makes Claude Code write a
// fresh transcript into ~/.claude/projects, which the indexer would otherwise pick up and
// surface as if it were one of the user's own coding sessions — Hindsight indexing itself.
// Every such transcript's first user message is verbatim one of the prompts Hindsight sends,
// so we recognize them by that prompt's stable opening line and drop them from the index.
const SELF_PROMPT_SIGNATURES = [
  FULL_PROMPT_SIGNATURE,
  INCREMENTAL_PROMPT_SIGNATURE,
  POLISH_PROMPT_SIGNATURE,
];

export function isSelfGeneratedSession(goal: string | null | undefined): boolean {
  if (!goal) return false;
  const text = goal.trimStart();
  return SELF_PROMPT_SIGNATURES.some((sig) => text.startsWith(sig));
}
