import Database from 'better-sqlite3';
import type { SessionFacts, PolishResult } from '../types.js';

// Bump whenever fact extraction changes so existing databases re-index their
// transcripts; the polish cache survives because it is paid-for LLM output.
export const INDEX_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  sessionId TEXT PRIMARY KEY, projectDir TEXT NOT NULL, cwd TEXT, goal TEXT,
  firstTs TEXT, lastTs TEXT, messageCount INTEGER, inputTokens INTEGER, outputTokens INTEGER,
  filesEdited TEXT, commandsRun TEXT, skillsInvoked TEXT,
  errorCount INTEGER, ending TEXT, lastUserText TEXT, lastAssistantText TEXT, skippedLines INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(projectDir, lastTs);
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtimeMs REAL, size INTEGER);
CREATE TABLE IF NOT EXISTS polish (sessionId TEXT PRIMARY KEY, goal TEXT, outcome TEXT);
`;

interface SessionRow {
  sessionId: string; projectDir: string; cwd: string | null; goal: string | null;
  firstTs: string | null; lastTs: string | null; messageCount: number;
  inputTokens: number; outputTokens: number; filesEdited: string; commandsRun: string;
  skillsInvoked: string; errorCount: number; ending: string;
  lastUserText: string | null; lastAssistantText: string | null; skippedLines: number;
}

function rowToFacts(r: SessionRow): SessionFacts {
  return {
    ...r,
    ending: r.ending as SessionFacts['ending'],
    filesEdited: JSON.parse(r.filesEdited) as string[],
    commandsRun: JSON.parse(r.commandsRun) as string[],
    skillsInvoked: JSON.parse(r.skillsInvoked) as string[],
  };
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string, opts?: { readonly?: boolean }) {
    if (opts?.readonly) {
      this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
      return;
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version !== INDEX_VERSION) {
      this.db.exec('DELETE FROM files');
      this.db.pragma(`user_version = ${INDEX_VERSION}`);
    }
  }

  upsertSession(f: SessionFacts): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions
      (sessionId, projectDir, cwd, goal, firstTs, lastTs, messageCount, inputTokens, outputTokens,
       filesEdited, commandsRun, skillsInvoked, errorCount, ending, lastUserText, lastAssistantText, skippedLines)
      VALUES (@sessionId, @projectDir, @cwd, @goal, @firstTs, @lastTs, @messageCount, @inputTokens, @outputTokens,
       @filesEdited, @commandsRun, @skillsInvoked, @errorCount, @ending, @lastUserText, @lastAssistantText, @skippedLines)
    `).run({
      ...f,
      filesEdited: JSON.stringify(f.filesEdited),
      commandsRun: JSON.stringify(f.commandsRun),
      skillsInvoked: JSON.stringify(f.skillsInvoked),
    });
  }

  getSessions(projectDir: string): SessionFacts[] {
    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE projectDir = ? ORDER BY lastTs DESC',
    ).all(projectDir) as SessionRow[];
    return rows.map(rowToFacts);
  }

  getAllSessions(): SessionFacts[] {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as SessionRow[];
    return rows.map(rowToFacts);
  }

  getTokensSince(cutoffIso: string): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(inputTokens + outputTokens), 0) AS total FROM sessions WHERE lastTs >= ?',
    ).get(cutoffIso) as { total: number };
    return row.total;
  }

  listProjects(): { projectDir: string; cwd: string | null; sessionCount: number; lastTs: string | null }[] {
    return this.db.prepare(`
      SELECT projectDir, MAX(cwd) AS cwd, COUNT(*) AS sessionCount, MAX(lastTs) AS lastTs
      FROM sessions GROUP BY projectDir ORDER BY lastTs DESC
    `).all() as { projectDir: string; cwd: string | null; sessionCount: number; lastTs: string | null }[];
  }

  getFileMeta(path: string): { mtimeMs: number; size: number } | null {
    const row = this.db.prepare('SELECT mtimeMs, size FROM files WHERE path = ?').get(path) as
      { mtimeMs: number; size: number } | undefined;
    return row ?? null;
  }

  setFileMeta(path: string, mtimeMs: number, size: number): void {
    this.db.prepare('INSERT OR REPLACE INTO files (path, mtimeMs, size) VALUES (?, ?, ?)')
      .run(path, mtimeMs, size);
  }

  getPolish(sessionId: string): PolishResult | null {
    const row = this.db.prepare('SELECT goal, outcome FROM polish WHERE sessionId = ?').get(sessionId) as
      PolishResult | undefined;
    return row ?? null;
  }

  setPolish(sessionId: string, p: PolishResult): void {
    this.db.prepare('INSERT OR REPLACE INTO polish (sessionId, goal, outcome) VALUES (?, ?, ?)')
      .run(sessionId, p.goal, p.outcome);
  }

  close(): void { this.db.close(); }
}
