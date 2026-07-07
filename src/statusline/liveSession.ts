import { readFileSync, statSync, openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseLines } from '../indexer/parseLines.js';

export interface LiveStats { files: number; commands: number; tokens: number; }

interface LiveState { bytesRead: number; filesEdited: string[]; commandCount: number; tokens: number; }

const FRESH: LiveState = { bytesRead: 0, filesEdited: [], commandCount: 0, tokens: 0 };

function loadState(statePath: string): LiveState {
  try {
    const s = JSON.parse(readFileSync(statePath, 'utf8')) as LiveState;
    if (typeof s.bytesRead === 'number' && Array.isArray(s.filesEdited) && typeof s.commandCount === 'number') {
      // A state file written before token tracking shipped won't have `tokens` yet;
      // treat that as 0 rather than invalidating the whole cached tail.
      return { ...s, tokens: typeof s.tokens === 'number' ? s.tokens : 0 };
    }
  } catch { /* missing or corrupt: start fresh */ }
  return { ...FRESH, filesEdited: [] };
}

// Reads only the bytes appended since the last call, parses complete lines,
// and accumulates Edit/Write/NotebookEdit file paths, Bash/PowerShell command
// counts, and token usage (from assistant `usage` blocks) in a state file
// keyed to the session.
export function updateLiveStats(statePath: string, transcriptPath: string): LiveStats {
  let state = loadState(statePath);

  let size: number;
  try {
    size = statSync(transcriptPath).size;
  } catch {
    // File doesn't exist - reset state
    state = { ...FRESH, filesEdited: [] };
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
    return { files: 0, commands: 0, tokens: 0 };
  }
  if (size < state.bytesRead) state = { ...FRESH, filesEdited: [] }; // rotated or truncated

  if (size > state.bytesRead) {
    const fd = openSync(transcriptPath, 'r');
    let chunk: string;
    try {
      const buf = Buffer.alloc(size - state.bytesRead);
      const read = readSync(fd, buf, 0, buf.length, state.bytesRead);
      chunk = buf.toString('utf8', 0, read);
    } finally {
      closeSync(fd);
    }
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline !== -1) {
      const complete = chunk.slice(0, lastNewline + 1);
      state.bytesRead += Buffer.byteLength(complete, 'utf8');
      const files = new Set(state.filesEdited);
      for (const rec of parseLines(complete).records) {
        if (rec['type'] !== 'assistant') continue;
        const message = rec['message'] as { content?: unknown; usage?: Record<string, unknown> } | undefined;
        if (!message) continue;
        if (message.usage) {
          for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
            if (typeof message.usage[k] === 'number') state.tokens += message.usage[k] as number;
          }
          if (typeof message.usage['output_tokens'] === 'number') state.tokens += message.usage['output_tokens'] as number;
        }
        if (!Array.isArray(message.content)) continue;
        for (const b of message.content as Record<string, unknown>[]) {
          if (!b || typeof b !== 'object' || b['type'] !== 'tool_use') continue;
          const name = b['name'];
          const input = (b['input'] ?? {}) as Record<string, unknown>;
          if ((name === 'Edit' || name === 'Write' || name === 'NotebookEdit') && typeof input['file_path'] === 'string') {
            files.add(input['file_path'] as string);
          } else if ((name === 'Bash' || name === 'PowerShell') && typeof input['command'] === 'string') {
            state.commandCount++;
          }
        }
      }
      state.filesEdited = [...files];
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(state));
    }
  }

  return { files: state.filesEdited.length, commands: state.commandCount, tokens: state.tokens };
}
