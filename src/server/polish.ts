import { execFile } from 'node:child_process';
import type { SessionFacts, PolishResult } from '../types.js';

export type ClaudeRunner = (prompt: string) => Promise<string>;

function buildPrompt(f: SessionFacts): string {
  return [
    'You summarize coding-session transcripts. Reply with ONLY a JSON object',
    '{"goal": "...", "outcome": "..."} — one sentence each, plain language, no markdown.',
    'Session facts:',
    `- User's opening request: ${(f.goal ?? '').slice(0, 500)}`,
    `- Files edited: ${f.filesEdited.slice(0, 10).join(', ') || 'none'}`,
    `- Commands run: ${f.commandsRun.slice(0, 10).map((c) => c.slice(0, 60)).join('; ') || 'none'}`,
    `- Ended: ${f.ending} after ${f.messageCount} messages`,
    `- Last assistant message: ${(f.lastAssistantText ?? '').slice(0, 300)}`,
  ].join('\n');
}

export async function polishSession(facts: SessionFacts, runClaude: ClaudeRunner): Promise<PolishResult | null> {
  try {
    const output = await runClaude(buildPrompt(facts));
    const match = output.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { goal?: unknown; outcome?: unknown };
    if (typeof parsed.goal === 'string' && typeof parsed.outcome === 'string') {
      return { goal: parsed.goal, outcome: parsed.outcome };
    }
    return null;
  } catch {
    return null;
  }
}

export const defaultRunClaude: ClaudeRunner = (prompt) =>
  new Promise((resolve, reject) => {
    execFile('claude', ['-p', prompt, '--output-format', 'text'], {
      timeout: 60_000, shell: process.platform === 'win32', windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
