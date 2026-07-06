import express from 'express';
import type { Store } from '../indexer/store.js';
import type { PolishResult } from '../types.js';
import { buildBriefing } from '../analyzer/briefing.js';
import { parseInstructions } from '../analyzer/instructions.js';
import { auditInstructions } from '../analyzer/audit.js';
import { discoverClaudeMds } from './configFiles.js';
import { polishSession, defaultRunClaude, type ClaudeRunner } from './polish.js';
import { getArchitectureView } from '../architecture/architecture.js';

export interface ServerOptions {
  uiDist: string | null;
  claudeDir: string;
  claudeRunner?: ClaudeRunner;
  dataDir?: string;
}

const POLISH_BATCH_SIZE = 10;
const inFlightPolish = new Set<string>();

export function createServer(store: Store, options: ServerOptions): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/api/projects', (_req, res) => {
    try {
      res.json(store.listProjects());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/projects/:dir/briefing', (req, res) => {
    try {
      const sessions = store.getSessions(req.params.dir);
      const polish = new Map<string, PolishResult>();
      for (const s of sessions) {
        const p = store.getPolish(s.sessionId);
        if (p) polish.set(s.sessionId, p);
      }
      res.json(buildBriefing(req.params.dir, sessions, polish));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/projects/:dir/architecture', (req, res) => {
    try {
      if (!options.dataDir) {
        res.json({ markdown: null, meta: null, staleBy: 0 });
        return;
      }
      res.json(getArchitectureView(store, req.params.dir, options.dataDir));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/audit', (_req, res) => {
    try {
      const projects = store.listProjects();
      const files = discoverClaudeMds(options.claudeDir, projects);
      const reports = files.map((f) => {
        const sessions = f.projectDir === null
          ? store.getAllSessions()
          : store.getSessions(f.projectDir);
        return auditInstructions(parseInstructions(f.markdown, f.source), sessions);
      });
      res.json(reports);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/projects/:dir/polish', async (req, res) => {
    const dir = req.params.dir;
    if (inFlightPolish.has(dir)) {
      res.status(409).json({ error: 'polish already running for this project' });
      return;
    }
    inFlightPolish.add(dir);
    try {
      const runner = options.claudeRunner ?? defaultRunClaude;
      // getSessions returns sessions sorted lastTs DESC, so this is already newest-first.
      const unpolished = store.getSessions(dir)
        .filter((s) => s.goal !== null && !store.getPolish(s.sessionId));
      const batch = unpolished.slice(0, POLISH_BATCH_SIZE);
      let polished = 0;
      let failed = 0;
      for (const s of batch) {
        const result = await polishSession(s, runner);
        if (result) { store.setPolish(s.sessionId, result); polished++; }
        else failed++;
      }
      const remaining = unpolished.length - batch.length;
      res.json({ polished, failed, remaining });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlightPolish.delete(dir);
    }
  });

  if (options.uiDist) {
    app.use(express.static(options.uiDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: options.uiDist! });
    });
  }

  return app;
}
