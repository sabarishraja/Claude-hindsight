import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OversightStats {
  pass: number;
  fail: number;
  lastFailKind: string | null;  // kind of the most recent failed check; sticky for the session
  extraFailKinds: number;       // other distinct failed kinds beyond lastFailKind
}

// history.jsonl is append-only and small; capping the tail keeps a pathological
// file from costing anything on a per-message statusline tick.
const TAIL_LINES = 200;

// Oversight has been observed double-writing identical events seconds apart
// (double-fired Stop hook). Two events this close with the same claim and the
// exact same results are one verification, not two.
const DEDUPE_WINDOW_S = 120;

// Order-sensitive fingerprint of everything that makes two events "the same
// verification". Returns null (never dedupe) when the claim is missing.
function eventSignature(claim: unknown, results: unknown[]): string | null {
  if (typeof claim !== 'string') return null;
  const parts = results.map((r) => {
    const rec = (typeof r === 'object' && r !== null) ? (r as Record<string, unknown>) : {};
    return [rec.kind, rec.status, rec.detail, rec.target]
      .map((v) => (typeof v === 'string' ? v : ''))
      .join('\u0000'); // NUL separator
  });
  return JSON.stringify([claim, parts]);
}

// Reads Oversight's per-project verification log and tallies pass/fail results
// for the current session. Returns null when the statusline should omit the
// segment entirely (no file, no events for this session, or nothing actually
// verified — unverifiable/skipped don't count). Never throws: the statusline
// must survive any on-disk state.
export function readOversightStats(cwd: string, sessionId: string): OversightStats | null {
  // '.lie-detector' is the pre-rename data directory; old hook installs still write it.
  for (const dir of ['.oversight', '.lie-detector']) {
    const stats = tallyHistory(join(cwd, dir, 'history.jsonl'), sessionId);
    if (stats) return stats;
  }
  return null;
}

function tallyHistory(path: string, sessionId: string): OversightStats | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let pass = 0;
  let fail = 0;
  let lastFailKind: string | null = null;
  const failKinds = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').split('\n')
    .map((l) => l.trim()).filter(Boolean).slice(-TAIL_LINES);

  let prevSig: string | null = null;
  let prevTs: number | null = null;

  for (const trimmed of lines) {
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof event !== 'object' || event === null || Array.isArray(event)) continue;
    const e = event as { session_id?: unknown; results?: unknown; claim?: unknown; ts?: unknown };
    if (e.session_id !== sessionId || !Array.isArray(e.results)) continue;

    const sig = eventSignature(e.claim, e.results);
    const ts = typeof e.ts === 'number' ? e.ts : null;
    if (sig !== null && sig === prevSig && ts !== null && prevTs !== null
        && Math.abs(ts - prevTs) <= DEDUPE_WINDOW_S) {
      continue; // duplicate write of the previous kept event — don't advance prevTs
    }
    prevSig = sig;
    prevTs = ts;

    for (const r of e.results as unknown[]) {
      const rec = (typeof r === 'object' && r !== null) ? (r as { status?: unknown; kind?: unknown }) : null;
      if (rec?.status === 'pass') pass++;
      else if (rec?.status === 'fail') {
        fail++;
        const kind = typeof rec.kind === 'string' ? rec.kind : 'unknown';
        lastFailKind = kind;
        failKinds.add(kind);
      }
    }
  }
  if (pass + fail === 0) return null;
  return { pass, fail, lastFailKind, extraFailKinds: failKinds.size > 0 ? failKinds.size - 1 : 0 };
}
