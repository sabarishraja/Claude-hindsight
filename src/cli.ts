#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './indexer/store.js';
import { indexProjects } from './indexer/indexer.js';
import { createServer } from './server/server.js';
import { buildBriefing } from './analyzer/briefing.js';
import { renderBriefing, renderProjectList } from './terminal/render.js';
import type { PolishResult } from './types.js';
import { runStatusline } from './statusline/statusline.js';
import { installStatusline } from './statusline/install.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Windows paths compare case-insensitively; normalize both sides.
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

async function index(store: Store, claudeDir: string, quiet: boolean): Promise<void> {
  const projectsRoot = join(claudeDir, 'projects');
  if (!existsSync(projectsRoot)) {
    if (!quiet) {
      console.log(`No transcripts found at ${projectsRoot}.`);
      console.log('claude-hindsight reads Claude Code session transcripts; run a few sessions first.');
    }
    return;
  }
  const result = await indexProjects(projectsRoot, store, (done, total) => {
    if (!quiet && total > 100 && (done % 200 === 0 || done === total)) {
      process.stderr.write(`\rIndexing ${done}/${total} transcripts`);
    }
  });
  if (!quiet && result.indexed > 100) process.stderr.write('\n');
}

function terminalBriefing(store: Store, plain: boolean): void {
  const color = !plain && process.stdout.isTTY === true;
  const projects = store.listProjects();
  const cwd = process.cwd();
  const isUnder = (child: string, parent: string) => {
    const c = resolve(child).toLowerCase();
    const p = resolve(parent).toLowerCase();
    return c.startsWith(p + '\\') || c.startsWith(p + '/');
  };
  const project =
    projects.find((p) => p.cwd !== null && samePath(p.cwd, cwd)) ??
    projects.find((p) => p.cwd !== null && isUnder(cwd, p.cwd));

  if (!project) {
    if (plain) return; // hook mode: stay silent in unknown directories
    console.log(renderProjectList(projects, { color }));
    return;
  }

  const sessions = store.getSessions(project.projectDir);
  const polish = new Map<string, PolishResult>();
  for (const s of sessions) {
    const p = store.getPolish(s.sessionId);
    if (p) polish.set(s.sessionId, p);
  }
  const briefing = buildBriefing(project.projectDir, sessions, polish);
  const name = project.cwd ? project.cwd.split(/[\\/]/).filter(Boolean).pop()! : project.projectDir;
  console.log(renderBriefing(briefing, name, { color }));
}

async function serveWeb(store: Store, claudeDir: string): Promise<void> {
  const port = Number(arg('port', '4756'));
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    console.error(`Invalid --port value: ${arg('port', '4756')}. Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  const noOpen = process.argv.includes('--no-open');

  const here = dirname(fileURLToPath(import.meta.url));
  const uiDist = join(here, '..', 'ui', 'dist');
  const app = createServer(store, { uiDist: existsSync(uiDist) ? uiDist : null, claudeDir });

  const server = app.listen(port, '127.0.0.1', async () => {
    const url = `http://localhost:${port}`;
    console.log(`claude-hindsight running at ${url}`);
    if (!noOpen) {
      const { default: open } = await import('open');
      await open(url).catch(() => { /* browser open is best-effort */ });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try a different --port.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });
}

// Statusline render mode must never throw, exit nonzero, or print a stack
// trace: Claude Code re-runs it on every assistant message and renders
// whatever lands on stdout.
function statuslineCommand(): void {
  const dataDir = join(homedir(), '.claude-hindsight');

  if (process.argv.includes('--install')) {
    const settingsPath = process.argv.includes('--project')
      ? join(process.cwd(), '.claude', 'settings.json')
      : join(homedir(), '.claude', 'settings.json');
    const cliPath = fileURLToPath(import.meta.url);
    const result = installStatusline(settingsPath, `node "${cliPath}" statusline`, process.argv.includes('--force'));
    console.log(result.message);
    if (result.action === 'refused') process.exitCode = 1;
    return;
  }

  let stdinText = '';
  try {
    stdinText = readFileSync(0, 'utf8'); // fd 0: works cross-platform, empty TTY throws
  } catch { /* no piped stdin: runStatusline returns usage */ }
  try {
    mkdirSync(dataDir, { recursive: true });
    console.log(runStatusline(stdinText, dataDir));
  } catch (err) {
    console.log(`🕶 Hindsight (error: ${err instanceof Error ? err.message : String(err)})`);
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'statusline') {
    statuslineCommand();
    return;
  }
  const claudeDir = arg('claude-dir', join(homedir(), '.claude'));
  const web = process.argv.includes('--web');
  const plain = process.argv.includes('--plain');

  const dataDir = join(homedir(), '.claude-hindsight');
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(join(dataDir, 'index.db'));

  process.on('SIGINT', () => {
    store.close();
    process.exit(0);
  });

  await index(store, claudeDir, plain);

  if (web) {
    await serveWeb(store, claudeDir);
  } else {
    terminalBriefing(store, plain);
    store.close();
  }
}

main().catch((err) => {
  console.error('claude-hindsight failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
