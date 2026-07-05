import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/indexer/store.js';
import { indexProjects } from '../src/indexer/indexer.js';

const line = (obj: object) => JSON.stringify(obj) + '\n';
const userLine = (text: string) => line({
  type: 'user', timestamp: '2026-07-01T10:00:00Z', cwd: 'C:\\real\\proj',
  message: { role: 'user', content: text },
});

let root: string;
let store: Store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dost-test-'));
  store = new Store(':memory:');
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('indexProjects', () => {
  it('indexes jsonl files into sessions keyed by filename and project dir', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'session-1.jsonl'),
      userLine('build me a fancy dashboard for my transcripts'));
    const result = await indexProjects(root, store);
    expect(result.indexed).toBe(1);
    const sessions = store.getSessions('proj-a');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('session-1');
    expect(sessions[0].goal).toContain('fancy dashboard');
    expect(sessions[0].cwd).toBe('C:\\real\\proj');
  });

  it('skips unchanged files on re-index', async () => {
    mkdirSync(join(root, 'proj-a'));
    const file = join(root, 'proj-a', 's.jsonl');
    writeFileSync(file, userLine('first version of this session goal text'));
    await indexProjects(root, store);
    const second = await indexProjects(root, store);
    expect(second.indexed).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it('re-indexes files whose size changed', async () => {
    mkdirSync(join(root, 'proj-a'));
    const file = join(root, 'proj-a', 's.jsonl');
    writeFileSync(file, userLine('first version of this session goal text'));
    await indexProjects(root, store);
    writeFileSync(file,
      userLine('first version of this session goal text') +
      userLine('appended second message with more content'));
    const result = await indexProjects(root, store);
    expect(result.indexed).toBe(1);
  });

  it('survives malformed files without throwing', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'bad.jsonl'), 'total garbage\x00\nnot json at all\n');
    const result = await indexProjects(root, store);
    expect(result.indexed).toBe(1);
    expect(result.skippedLines).toBe(2);
  });

  it('returns zeros when root does not exist', async () => {
    const result = await indexProjects(join(root, 'nope'), store);
    expect(result).toEqual({ indexed: 0, unchanged: 0, skippedLines: 0 });
  });
});
