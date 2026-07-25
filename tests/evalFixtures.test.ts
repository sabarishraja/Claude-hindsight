import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, loadFixture, loadFixtures } from '../src/eval/fixtures.js';

let dir: string;
const input = { markdown: '- Use `alpha`.', source: 'CLAUDE.md', sessions: [] };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'evalfx-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeFixture(name: string, sha: string) {
  const inputText = JSON.stringify(input);
  writeFileSync(join(dir, `${name}.input.json`), inputText);
  writeFileSync(join(dir, `${name}.labels.json`),
    JSON.stringify({ inputSha256: sha, labels: { 'CLAUDE.md:1': 'unchecked' } }));
  return inputText;
}

describe('loadFixture', () => {
  it('loads when the labels sha matches the input bytes', () => {
    const inputText = writeFixture('foo', '');
    // rewrite labels with the correct sha
    writeFileSync(join(dir, 'foo.labels.json'),
      JSON.stringify({ inputSha256: sha256(inputText), labels: { 'CLAUDE.md:1': 'unchecked' } }));
    const f = loadFixture(dir, 'foo');
    expect(f.name).toBe('foo');
    expect(f.labels['CLAUDE.md:1']).toBe('unchecked');
  });

  it('throws when the input bytes changed out from under the labels', () => {
    writeFixture('bar', 'deadbeef'); // wrong sha on purpose
    expect(() => loadFixture(dir, 'bar')).toThrow(/sha/i);
  });

  it('throws when a label has an invalid verdict', () => {
    const inputText = JSON.stringify(input);
    writeFileSync(join(dir, 'baz.input.json'), inputText);
    writeFileSync(join(dir, 'baz.labels.json'),
      JSON.stringify({ inputSha256: sha256(inputText), labels: { 'CLAUDE.md:1': 'maybe' } }));
    expect(() => loadFixture(dir, 'baz')).toThrow(/invalid verdict/i);
  });
});

describe('loadFixtures', () => {
  it('loads every *.input.json in the directory', () => {
    const t1 = writeFixture('a', '');
    writeFileSync(join(dir, 'a.labels.json'),
      JSON.stringify({ inputSha256: sha256(t1), labels: {} }));
    const t2 = writeFixture('b', '');
    writeFileSync(join(dir, 'b.labels.json'),
      JSON.stringify({ inputSha256: sha256(t2), labels: {} }));
    expect(loadFixtures(dir).map((f) => f.name).sort()).toEqual(['a', 'b']);
  });
});
