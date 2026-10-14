'use client';

import { useEffect, useState } from 'react';
import { addDaysIso, marinaNow, type DayAvailability } from '@/lib/availability';

/**
 * Live availability for the next `days` days, read in the browser so a
 * cached page never shows yesterday's "Tomorrow" or seats that are gone.
 * `null` until it loads, or if it can't.
 */
export function useUpcomingDays(days: number): DayAvailability[] | null {
  const [data, setData] = useState<DayAvailability[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const from = marinaNow().date;
    fetch(`/api/availability?from=${from}&to=${addDaysIso(from, days - 1)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { days: DayAvailability[] } | null) => {
        if (body?.days) setData(body.days);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [days]);
  return data;
}
