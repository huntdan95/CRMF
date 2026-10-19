/** Formats a `YYYY-MM-DD` date as that calendar day, wherever the phone is. */
export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    ...opts,
    timeZone: 'UTC',
  });
}

/** Whole days from `today` to `iso` (negative in the past). */
export function daysFrom(today: string, iso: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(iso) - utc(today)) / 86_400_000);
}

/** "Today" / "Tomorrow" / "Yesterday" or the weekday, plus "Oct 20". */
export function dayHeading(iso: string, today: string): { lead: string; date: string } {
  const diff = daysFrom(today, iso);
  const lead =
    diff === 0
      ? 'Today'
      : diff === 1
        ? 'Tomorrow'
        : diff === -1
          ? 'Yesterday'
          : formatDay(iso, { weekday: 'long' });
  return { lead, date: formatDay(iso, { month: 'short', day: 'numeric' }) };
}
