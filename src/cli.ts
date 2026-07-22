#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './indexer/store.js';
import { indexProjects } from './indexer/indexer.js';
import { createServer } from './server/server.js';
import { buildBriefing } from './analyzer/briefing.js';
import { renderBriefing, renderProjectList } from './terminal/render.js';
import type { PolishResult } from './types.js';
import { runStatusline } from './statusline/statusline.js';
import { installStatusline, statuslineInstallCommand } from './statusline/install.js';
import { refreshArchitecture, getArchitectureView } from './architecture/architecture.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/server.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Windows paths compare case-insensitively; normalize both sides.
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function findProjectForCwd<T extends { cwd: string | null }>(projects: T[], cwd: string): T | undefined {
  const isUnder = (child: string, parent: string) => {
    const c = resolve(child).toLowerCase();
    const p = resolve(parent).toLowerCase();
    return c.startsWith(p + '\\') || c.startsWith(p + '/');
  };
  return (
    projects.find((p) => p.cwd !== null && samePath(p.cwd, cwd)) ??
    projects.find((p) => p.cwd !== null && isUnder(cwd, p.cwd))
  );
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

function terminalBriefing(store: Store, plain: boolean, dataDir: string): void {
  const color = !plain && process.stdout.isTTY === true;
  const projects = store.listProjects();
  const cwd = process.cwd();
  const project = findProjectForCwd(projects, cwd);

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

  const archView = getArchitectureView(store, project.projectDir, dataDir);
  if (archView.markdown !== null && archView.staleBy > 0) {
    console.log(
      `Architecture doc: ${archView.staleBy} session${archView.staleBy === 1 ? '' : 's'} behind — ` +
      'run `claude-hindsight architecture` to refresh.',
    );
  }
}

async function serveWeb(store: Store, claudeDir: string, dataDir: string): Promise<void> {
  const port = Number(arg('port', '4756'));
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    console.error(`Invalid --port value: ${arg('port', '4756')}. Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  const noOpen = process.argv.includes('--no-open');

  const here = dirname(fileURLToPath(import.meta.url));
  const uiDist = join(here, '..', 'ui', 'dist');
  const app = createServer(store, { uiDist: existsSync(uiDist) ? uiDist : null, claudeDir, dataDir });

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
    const command = statuslineInstallCommand(
      process.argv.includes('--local'),
      fileURLToPath(import.meta.url),
    );
    const result = installStatusline(settingsPath, command, process.argv.includes('--force'));
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

// Long-running MCP server over stdio: never returns until the process is
// killed. Never runs the indexer — same discipline as the statusline — so
// the Store is opened read-only, and only if index.db already exists.
async function mcpCommand(): Promise<void> {
  const dataDir = join(homedir(), '.claude-hindsight');
  const claudeDir = join(homedir(), '.claude');
  const dbPath = join(dataDir, 'index.db');
  const store = existsSync(dbPath) ? new Store(dbPath, { readonly: true }) : null;

  const server = createMcpServer({ store, dataDir, claudeDir, cwd: process.cwd() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function architectureCommand(store: Store, dataDir: string): Promise<void> {
  const project = findProjectForCwd(store.listProjects(), process.cwd());

  if (process.argv.includes('--print')) {
    if (!project) return;
    const view = getArchitectureView(store, project.projectDir, dataDir);
    if (view.markdown) console.log(view.markdown);
    return;
  }

  if (!project) {
    console.log('No indexed project matches this directory. Run claude-hindsight first to index it.');
    process.exitCode = 1;
    return;
  }

  const full = process.argv.includes('--full');
  const result = await refreshArchitecture(store, project.projectDir, { full, dataDir });
  console.log(result.message);
  if (result.status === 'error' || result.status === 'rejected') process.exitCode = 1;

  const view = getArchitectureView(store, project.projectDir, dataDir);
  if (view.markdown) {
    console.log('');
    console.log(view.markdown);
  }

  const writeIdx = process.argv.indexOf('--write');
  if (writeIdx !== -1 && process.argv[writeIdx + 1] && view.markdown) {
    if (result.status === 'error' || result.status === 'rejected') {
      console.log(`\nSkipped export to ${process.argv[writeIdx + 1]}: this run's refresh did not succeed ` +
        '(the doc shown above is the last known-good version).');
    } else {
      writeFileSync(process.argv[writeIdx + 1], view.markdown);
      console.log(`\nExported to ${process.argv[writeIdx + 1]}`);
    }
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'statusline') {
    statuslineCommand();
    return;
  }
  if (process.argv[2] === 'mcp') {
    await mcpCommand();
    return;
  }
  if (process.argv[2] === 'eval') {
    const { runEvalCli } = await import('./eval/cli.js');
    const dataDir2 = join(homedir(), '.claude-hindsight');
    mkdirSync(dataDir2, { recursive: true });
    const store2 = new Store(join(dataDir2, 'index.db'));
    const fixturesDir = join(process.cwd(), 'tests', 'eval', 'fixtures', 'train');
    await runEvalCli(process.argv.slice(3), { store: store2, fixturesDir });
    store2.close();
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

  if (process.argv[2] === 'architecture') {
    await architectureCommand(store, dataDir);
    store.close();
    return;
  }

  if (web) {
    await serveWeb(store, claudeDir, dataDir);
  } else {
    terminalBriefing(store, plain, dataDir);
    store.close();
  }
}

main().catch((err) => {
  console.error('claude-hindsight failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
