#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './indexer/store.js';
import { indexProjects } from './indexer/indexer.js';
import { createServer } from './server/server.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const claudeDir = arg('claude-dir', join(homedir(), '.claude'));
  const port = Number(arg('port', '4756'));
  const noOpen = process.argv.includes('--no-open');

  const dataDir = join(homedir(), '.claude-dost');
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(join(dataDir, 'index.db'));

  const projectsRoot = join(claudeDir, 'projects');
  if (!existsSync(projectsRoot)) {
    console.log(`No transcripts found at ${projectsRoot}.`);
    console.log('claude-dost reads Claude Code session transcripts; run a few sessions first.');
  }

  console.log('Indexing transcripts...');
  const result = await indexProjects(projectsRoot, store, (done, total) => {
    if (done % 50 === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total} files`);
    }
  });
  console.log(`\nIndexed ${result.indexed} new/changed, ${result.unchanged} unchanged` +
    (result.skippedLines ? `, ${result.skippedLines} malformed lines skipped` : ''));

  const here = dirname(fileURLToPath(import.meta.url));
  const uiDist = join(here, '..', 'ui', 'dist');
  const app = createServer(store, { uiDist: existsSync(uiDist) ? uiDist : null, claudeDir });

  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`claude-dost running at ${url}`);
    if (!noOpen) {
      const { default: open } = await import('open');
      await open(url).catch(() => { /* browser open is best-effort */ });
    }
  });
}

main().catch((err) => {
  console.error('claude-dost failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
