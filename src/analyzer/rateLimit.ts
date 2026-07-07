import { extractMessageText } from './text.js';

const RESET_REGEX = /resets\s+(\d{1,2}):(\d{2})\s*([ap]m)\s*\(([^)]+)\)/i;

function resolveResetTime(
  anchorIso: string, hour12: number, minute: number, meridiem: string, tz: string,
): string | null {
  try {
    const anchor = new Date(anchorIso);
    if (Number.isNaN(anchor.getTime())) return null;

    let hour24 = hour12 % 12;
    if (meridiem.toLowerCase() === 'pm') hour24 += 12;

    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const ymd = dateFmt.format(anchor); // "YYYY-MM-DD"
    const wallClock = `${ymd}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

    // Initial guess: treat the wall-clock string as if it were UTC.
    const guess = new Date(`${wallClock}Z`);
    if (Number.isNaN(guess.getTime())) return null;

    // Find the actual offset for `tz` at this guess by reformatting the guess in that zone and
    // comparing to what we intended; a single correction converges since zone offsets are whole/
    // half/quarter hours (a DST-transition edge case could be off by an hour — acceptable here).
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = tzFmt.formatToParts(guess).reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const formattedAsUtc = new Date(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const driftMs = guess.getTime() - formattedAsUtc.getTime();
    let candidate = new Date(guess.getTime() + driftMs);

    if (candidate.getTime() < anchor.getTime()) {
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    }

    return candidate.toISOString();
  } catch {
    return null;
  }
}

export function extractRateLimitReset(rec: Record<string, unknown>): string | null {
  if (rec['error'] !== 'rate_limit' || rec['isApiErrorMessage'] !== true) return null;
  const timestamp = rec['timestamp'];
  if (typeof timestamp !== 'string') return null;
  const text = extractMessageText(rec);
  if (!text) return null;
  const match = RESET_REGEX.exec(text);
  if (!match) return null;

  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3];
  const tz = match[4];
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  return resolveResetTime(timestamp, hour12, minute, meridiem, tz);
}
