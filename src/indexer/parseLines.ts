export interface ParseResult {
  records: Record<string, unknown>[];
  skipped: number;
}

export function parseLines(text: string): ParseResult {
  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}
