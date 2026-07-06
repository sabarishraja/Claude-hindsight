import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readArchitectureDoc, writeArchitectureDoc, projectKey } from '../src/architecture/state.js';

describe('architecture state storage', () => {
  it('round-trips a doc and its meta', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-arch-'));
    writeArchitectureDoc(dataDir, 'proj', '# Doc\ncontent', {
      docVersion: 1, lastRefreshAt: '2026-07-06T00:00:00Z', coveredThroughTs: '2026-07-05T00:00:00Z',
    });
    const doc = readArchitectureDoc(dataDir, 'proj');
    expect(doc?.markdown).toBe('# Doc\ncontent');
    expect(doc?.meta).toEqual({
      docVersion: 1, lastRefreshAt: '2026-07-06T00:00:00Z', coveredThroughTs: '2026-07-05T00:00:00Z',
    });
  });

  it('returns null when no doc has been written yet', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-arch-'));
    expect(readArchitectureDoc(dataDir, 'unknown-project')).toBeNull();
  });

  it('returns null on corrupt meta rather than throwing', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-arch-'));
    writeArchitectureDoc(dataDir, 'proj', '# Doc', { docVersion: 1, lastRefreshAt: 'x', coveredThroughTs: null });
    const metaPath = join(dataDir, 'architecture', `${projectKey('proj')}.json`);
    writeFileSync(metaPath, '{ not json');
    expect(readArchitectureDoc(dataDir, 'proj')).toBeNull();
  });

  it('produces a stable, filesystem-safe key for any project path', () => {
    const key = projectKey('C:\\Users\\weird name\\proj with spaces/& stuff');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(projectKey('C:\\Users\\weird name\\proj with spaces/& stuff')).toBe(key);
  });

  it('overwrites atomically: reading always sees a complete doc, old or new', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-arch-'));
    writeArchitectureDoc(dataDir, 'proj', 'version one', { docVersion: 1, lastRefreshAt: 'a', coveredThroughTs: null });
    writeArchitectureDoc(dataDir, 'proj', 'version two', { docVersion: 2, lastRefreshAt: 'b', coveredThroughTs: null });
    const docPath = join(dataDir, 'architecture', `${projectKey('proj')}.md`);
    expect(readFileSync(docPath, 'utf8')).toBe('version two');
  });
});
