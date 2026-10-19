/**
 * iCalendar (RFC 5545) text for the crew calendar feed. Pure: no Firestore
 * and no Next, so functions/test can check it.
 *
 * Every line ends in CRLF, the last one too. Lines longer than 75 octets
 * are folded (RFC 5545 §3.1) between characters, never inside a multi-byte
 * one. TEXT values are escaped with {@link escapeText}.
 */

export const MARINA_TZID = 'America/New_York';

/**
 * America/New_York with the US rules in force since 2007 (second Sunday in
 * March to first Sunday in November). The feed only covers the last 14 days
 * and the next 120, so older rules don't matter. Same block as the guest
 * calendar.ics route.
 */
export const NEW_YORK_VTIMEZONE: readonly string[] = [
  'BEGIN:VTIMEZONE',
  `TZID:${MARINA_TZID}`,
  'X-LIC-LOCATION:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * A TEXT property value: backslashes, semicolons, commas and newlines
 * escaped; CR/CRLF treated as a newline; other control characters (which
 * TEXT doesn't allow) dropped.
 */
export function escapeText(value: string): string {
  let clean = '';
  for (const ch of value.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) clean += ch;
  }
  return clean
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Bytes a code point takes in UTF-8. */
function utf8Length(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line at 75 octets. Continuation lines start with a
 * space, which counts toward their 75.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8Length(ch);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The whole object: each line folded, CRLF after every line. */
export function serializeLines(lines: readonly string[]): string {
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** `2026-10-17` + `08:00` (+ minutes) → `20261017T080000`, rolling the date past midnight. */
export function localDateTime(date: string, time: string, addMinutes = 0): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const at = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi! + addMinutes));
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00`
  );
}

/** A UTC DATE-TIME, e.g. `20261015T140000Z`. */
export function utcDateTime(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
