import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FixtureInput, FixtureLabels, LoadedFixture } from './types.js';
import { VERDICTS } from './types.js';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function listFixtureNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.input.json'))
    .map((f) => f.slice(0, -'.input.json'.length))
    .sort();
}

export function loadFixture(dir: string, name: string): LoadedFixture {
  const inputText = readFileSync(join(dir, `${name}.input.json`), 'utf8');
  const labelsText = readFileSync(join(dir, `${name}.labels.json`), 'utf8');
  const input = JSON.parse(inputText) as FixtureInput;
  const labelsFile = JSON.parse(labelsText) as FixtureLabels;
  const actual = sha256(inputText);
  if (labelsFile.inputSha256 !== actual) {
    throw new Error(
      `fixture ${name}: input sha mismatch — labels are stale for the current input.json ` +
      `(labels ${labelsFile.inputSha256 || '<empty>'}, input ${actual}). Re-label against the current input.`,
    );
  }
  for (const [ruleId, verdict] of Object.entries(labelsFile.labels)) {
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      throw new Error(
        `fixture ${name}: label for ${ruleId} has invalid verdict "${verdict}" ` +
        `(expected one of violated|followed|dead|unchecked)`,
      );
    }
  }
  return { name, input, labels: labelsFile.labels };
}

export function loadFixtures(dir: string): LoadedFixture[] {
  return listFixtureNames(dir).map((name) => loadFixture(dir, name));
}
