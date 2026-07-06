import { readFileSync, statSync, openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseLines } from '../indexer/parseLines.js';

export interface LiveStats { files: number; commands: number; }

interface LiveState { bytesRead: number; filesEdited: string[]; commandCount: number; }

const FRESH: LiveState = { bytesRead: 0, filesEdited: [], commandCount: 0 };

function loadState(statePath: string): LiveState {
  try {
    const s = JSON.parse(readFileSync(statePath, 'utf8')) as LiveState;
    if (typeof s.bytesRead === 'number' && Array.isArray(s.filesEdited) && typeof s.commandCount === 'number') {
      return s;
    }
  } catch { /* missing or corrupt: start fresh */ }
  return { ...FRESH, filesEdited: [] };
}

// Reads only the bytes appended since the last call, parses complete lines,
// and accumulates Edit/Write/NotebookEdit file paths and Bash/PowerShell
// command counts in a state file keyed to the session.
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
    return { files: 0, commands: 0 };
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
        const message = rec['message'] as { content?: unknown } | undefined;
        if (!message || !Array.isArray(message.content)) continue;
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

  return { files: state.filesEdited.length, commands: state.commandCount };
}
