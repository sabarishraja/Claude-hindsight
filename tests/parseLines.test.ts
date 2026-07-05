import { describe, it, expect } from 'vitest';
import { parseLines } from '../src/indexer/parseLines.js';

describe('parseLines', () => {
  it('parses valid JSON object lines', () => {
    const { records, skipped } = parseLines('{"a":1}\n{"b":2}\n');
    expect(records).toEqual([{ a: 1 }, { b: 2 }]);
    expect(skipped).toBe(0);
  });

  it('skips malformed lines and counts them without throwing', () => {
    const { records, skipped } = parseLines('{"a":1}\nnot json\n{broken\n{"b":2}');
    expect(records).toEqual([{ a: 1 }, { b: 2 }]);
    expect(skipped).toBe(2);
  });

  it('skips non-object JSON values (arrays, numbers, null)', () => {
    const { records, skipped } = parseLines('[1,2]\n42\nnull\n{"ok":true}');
    expect(records).toEqual([{ ok: true }]);
    expect(skipped).toBe(3);
  });

  it('ignores blank lines without counting them as skipped', () => {
    const { records, skipped } = parseLines('\n\n{"a":1}\n\n');
    expect(records).toEqual([{ a: 1 }]);
    expect(skipped).toBe(0);
  });
});
