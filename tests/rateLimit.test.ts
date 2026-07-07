import { describe, it, expect } from 'vitest';
import { extractRateLimitReset } from '../src/analyzer/rateLimit.js';

const rateLimitRec = (text: string, timestamp: string) => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  error: 'rate_limit',
  isApiErrorMessage: true,
});

describe('extractRateLimitReset', () => {
  it('parses the real Claude Code rate-limit message shape', () => {
    const rec = rateLimitRec(
      "You've hit your session limit · resets 1:40pm (America/Chicago)",
      '2026-06-23T18:21:38.621Z',
    );
    expect(extractRateLimitReset(rec)).toBe('2026-06-23T18:40:00.000Z');
  });

  it('rolls over to the next day when the reset time-of-day has already passed today', () => {
    const rec = rateLimitRec(
      "You've hit your session limit · resets 1:00pm (America/Chicago)",
      '2026-06-23T18:21:38.621Z',
    );
    expect(extractRateLimitReset(rec)).toBe('2026-06-24T18:00:00.000Z');
  });

  it('handles 12am/12pm correctly', () => {
    const noon = rateLimitRec('resets 12:00pm (America/Chicago)', '2026-06-23T10:00:00.000Z');
    // noon Chicago (CDT, UTC-5) = 17:00 UTC, after the 10:00 UTC anchor, so same day.
    expect(noon).not.toBeNull();
    expect(extractRateLimitReset(noon)).toBe('2026-06-23T17:00:00.000Z');
  });

  it('returns null for records that are not rate-limit errors', () => {
    expect(extractRateLimitReset({
      type: 'assistant', timestamp: '2026-06-23T18:21:38.621Z',
      message: { content: [{ type: 'text', text: 'resets 1:40pm (America/Chicago)' }] },
    })).toBe(null);
    expect(extractRateLimitReset({
      type: 'assistant', timestamp: '2026-06-23T18:21:38.621Z',
      message: { content: [{ type: 'text', text: 'resets 1:40pm (America/Chicago)' }] },
      error: 'rate_limit', isApiErrorMessage: false,
    })).toBe(null);
  });

  it('returns null when the message text does not match the expected shape', () => {
    const rec = rateLimitRec("You've hit your session limit", '2026-06-23T18:21:38.621Z');
    expect(extractRateLimitReset(rec)).toBe(null);
  });

  it('returns null for a missing or non-string timestamp', () => {
    const rec = rateLimitRec('resets 1:40pm (America/Chicago)', '2026-06-23T18:21:38.621Z');
    delete (rec as { timestamp?: unknown }).timestamp;
    expect(extractRateLimitReset(rec)).toBe(null);
  });

  it('returns null instead of throwing on an invalid IANA timezone name', () => {
    const rec = rateLimitRec('resets 1:40pm (Nowhere/Fake)', '2026-06-23T18:21:38.621Z');
    expect(extractRateLimitReset(rec)).toBe(null);
  });
});
