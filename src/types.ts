export type SessionEnding = 'clean' | 'error' | 'abandoned';

export interface SessionFacts {
  sessionId: string;
  projectDir: string;        // encoded dir name under ~/.claude/projects
  cwd: string | null;
  goal: string | null;       // null => noise session (hidden in UI)
  firstTs: string | null;    // ISO timestamps
  lastTs: string | null;
  messageCount: number;      // text-bearing user + assistant messages; sidechains and tool_result-only records excluded
  inputTokens: number;
  outputTokens: number;
  filesEdited: string[];     // from Edit/Write/NotebookEdit tool_use inputs
  commandsRun: string[];     // from Bash/PowerShell tool_use inputs
  skillsInvoked: string[];   // from Skill tool_use inputs
  errorCount: number;        // tool results with is_error:true
  ending: SessionEnding;
  lastUserText: string | null;
  lastAssistantText: string | null;
  skippedLines: number;
}

export interface PolishResult { goal: string; outcome: string; }
