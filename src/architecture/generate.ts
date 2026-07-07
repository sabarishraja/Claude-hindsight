import { exec } from 'node:child_process';

export interface SessionSummary {
  goal: string;
  outcome: string | null;
}

export function buildFullPrompt(): string {
  return [
    'Explore this codebase using the Read, Glob, and Grep tools available to you.',
    'Then write a markdown document that explains the project to someone who does',
    'not read code and relies entirely on Claude Code to make changes. Avoid jargon;',
    'explain concepts in plain language.',
    '',
    'Use exactly these five top-level markdown headings, in this order:',
    '## What this app does',
    '## The main parts',
    '## How the pieces work together',
    '## Architecture Diagram',
    '## Recent changes',
    '',
    '"What this app does": two or three sentences on the purpose of the project.',
    '"The main parts": one entry per significant area of the codebase — what it',
    'does, roughly where it lives, and what it depends on.',
    '"How the pieces work together": describe the main workflows as a narrative',
    '(e.g. "when you open the dashboard, the server reads the index and...").',
    '"Architecture Diagram": a small conceptual flowchart (roughly 6-12 nodes),',
    'mirroring "The main parts" and "How the pieces work together" — not a literal',
    'file/import graph. Write it as a fenced code block using plain Mermaid',
    '`flowchart TD` (or `LR`) syntax only — no subgraphs, no custom styling or',
    'classDef, to minimize the chance of a syntax error. Example shape:',
    '```mermaid',
    'flowchart TD',
    '  A[Some part] --> B[Another part]',
    '```',
    '"Recent changes": leave this section with a single placeholder bullet',
    '"- (no history yet)" — it will be filled in by later refreshes.',
    '',
    'Reply with ONLY the markdown document, no commentary before or after it.',
  ].join('\n');
}

export function buildIncrementalPrompt(
  previousDoc: string, changedFiles: string[], sessionSummaries: SessionSummary[],
): string {
  const changes = sessionSummaries.length > 0
    ? sessionSummaries.map((s) => `- ${s.goal}${s.outcome ? ` — ${s.outcome}` : ''}`).join('\n')
    : '(none)';
  return [
    'You maintain a living architecture document for a codebase, written for a reader',
    'who does not read code. Below is the current document, the files that changed',
    'since it was last updated, and what the user was trying to do in those sessions.',
    'Update the document: revise any sections affected by the changes, and add ONE new',
    'bullet to the top of "## Recent changes" — one plain-English sentence per session,',
    'newest first — describing what changed, based on the session summaries below (not',
    'file names). Keep at most 10 bullets in "## Recent changes", dropping the oldest.',
    'If the changes affect the system\'s overall shape, also update the Mermaid flowchart',
    'in "## Architecture Diagram" to match; otherwise leave it as-is.',
    "Preserve the other four sections' structure and the exact heading text, including",
    '"## Architecture Diagram".',
    '',
    '--- Current document ---',
    previousDoc,
    '',
    '--- Files changed since last update ---',
    changedFiles.length > 0 ? changedFiles.join('\n') : '(none)',
    '',
    '--- What the user was doing in those sessions ---',
    changes,
    '',
    'Reply with ONLY the full updated markdown document, no commentary before or after it.',
  ].join('\n');
}

const REQUIRED_HEADINGS = [
  'what this app does', 'the main parts', 'how the pieces work together',
  'architecture diagram', 'recent changes',
];

export function hasHeading(markdown: string, heading: string): boolean {
  const lines = markdown.split('\n');
  const headingRegex = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  return lines.some((line) => headingRegex.test(line));
}

export function isValidDoc(markdown: string): boolean {
  if (!markdown || markdown.trim().length === 0) return false;
  return REQUIRED_HEADINGS.every((heading) => hasHeading(markdown, heading));
}

const RECENT_HEADING = /^##\s+Recent changes\s*$/i;

// Regenerating the whole doc each refresh keeps it self-healing, but the LLM
// isn't trusted to obey the "keep at most 10" instruction on its own — this
// caps the Recent-changes bullets deterministically after the fact.
export function trimRecentChanges(markdown: string, max: number): string {
  const lines = markdown.split('\n');
  const headingIdx = lines.findIndex((l) => RECENT_HEADING.test(l));
  if (headingIdx === -1) return markdown;

  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) { sectionEnd = i; break; }
  }

  let bulletsSeen = 0;
  const kept: string[] = [];
  for (let i = headingIdx + 1; i < sectionEnd; i++) {
    const isBullet = /^\s*-\s+/.test(lines[i]);
    if (isBullet) {
      bulletsSeen++;
      if (bulletsSeen > max) continue;
    }
    kept.push(lines[i]);
  }

  return [...lines.slice(0, headingIdx + 1), ...kept, ...lines.slice(sectionEnd)].join('\n');
}

export type ArchRunner = (
  prompt: string, opts: { cwd: string; tools: boolean; timeoutMs: number },
) => Promise<string>;

export const defaultRunClaude: ArchRunner = (prompt, opts) =>
  new Promise((resolve, reject) => {
    let command = 'claude -p --output-format text';
    if (opts.tools) command += ' --allowedTools Read Glob Grep';
    const child = exec(
      command,
      { cwd: opts.cwd, timeout: opts.timeoutMs, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    child.stdin!.end(prompt);
  });
