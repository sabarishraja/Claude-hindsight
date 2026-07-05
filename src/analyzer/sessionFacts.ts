import type { SessionFacts, SessionEnding } from '../types.js';
import { extractMessageText } from './text.js';

type Rec = Record<string, unknown>;

function contentBlocks(rec: Rec): Rec[] {
  const message = rec['message'] as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter((b): b is Rec => !!b && typeof b === 'object');
}

function hasErrorResult(rec: Rec): boolean {
  return contentBlocks(rec).some((b) => b['type'] === 'tool_result' && b['is_error'] === true);
}

export function extractSessionFacts(
  records: Rec[], sessionId: string, projectDir: string, skippedLines: number,
): SessionFacts {
  let goal: string | null = null;
  let cwd: string | null = null;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  let messageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let errorCount = 0;
  let lastUserText: string | null = null;
  let lastAssistantText: string | null = null;
  const filesEdited = new Set<string>();
  const commandsRun: string[] = [];
  const skillsInvoked = new Set<string>();

  for (const rec of records) {
    const ts = rec['timestamp'];
    if (typeof ts === 'string') {
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    if (cwd === null && typeof rec['cwd'] === 'string') cwd = rec['cwd'] as string;

    const type = rec['type'];
    const sidechain = rec['isSidechain'] === true;

    if (type === 'assistant') {
      const usage = (rec['message'] as Rec | undefined)?.['usage'] as Rec | undefined;
      if (usage) {
        for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
          if (typeof usage[k] === 'number') inputTokens += usage[k] as number;
        }
        if (typeof usage['output_tokens'] === 'number') outputTokens += usage['output_tokens'] as number;
      }
      for (const b of contentBlocks(rec)) {
        if (b['type'] !== 'tool_use') continue;
        const name = b['name'];
        const input = (b['input'] ?? {}) as Rec;
        if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && typeof input['file_path'] === 'string') {
          filesEdited.add(input['file_path'] as string);
        } else if ((name === 'Bash' || name === 'PowerShell') && typeof input['command'] === 'string') {
          commandsRun.push(input['command'] as string);
        } else if (name === 'Skill' && typeof input['skill'] === 'string') {
          skillsInvoked.add(input['skill'] as string);
        }
      }
      if (!sidechain) {
        messageCount++;
        const text = extractMessageText(rec);
        if (text) lastAssistantText = text;
      }
    } else if (type === 'user') {
      if (hasErrorResult(rec)) errorCount++;
      if (!sidechain) {
        const text = extractMessageText(rec);
        if (text) {
          messageCount++;
          lastUserText = text;
          if (goal === null && text.length >= 20) goal = text;
        }
      }
    }
  }

  let ending: SessionEnding = 'clean';
  const tail = records.slice(-5);
  if (tail.some((r) => r['type'] === 'user' && hasErrorResult(r))) {
    ending = 'error';
  } else if (lastAssistantText !== null && lastAssistantText.trimEnd().endsWith('?')) {
    ending = 'abandoned';
  }

  return {
    sessionId, projectDir, cwd, goal, firstTs, lastTs, messageCount,
    inputTokens, outputTokens,
    filesEdited: [...filesEdited], commandsRun, skillsInvoked: [...skillsInvoked],
    errorCount, ending, lastUserText, lastAssistantText, skippedLines,
  };
}
