'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WHOLE_DAY_OVERLAPS,
  computeDay,
  marinaNow,
  type DayAvailability,
  type SlotState,
} from '@/lib/availability';
import { getDayAvailability, getMonthBlackouts } from '@/lib/functions-client';
import { slotOrder } from '@/lib/tours';
import { slotRunsOn } from '@/lib/schedule';

interface MonthData {
  /** Per-day availability, keyed by YYYY-MM-DD. Missing = unknown. */
  days: Record<string, DayAvailability>;
  /** Fully closed days, when only the blackout list could be loaded. */
  closed: string[];
  /** `full` = per-day data from /api/availability; `blackouts` = fallback. */
  source: 'full' | 'blackouts' | 'none';
  fetchedAt: number;
}

const STALE_MS = 60_000;

function monthKey(year: number, month0: number) {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`;
}

/**
 * One month of availability. Tries /api/availability (every day's seat
 * counts in one request); if that isn't reachable, falls back to the Cloud
 * Function's blackout list. Never rejects except on abort.
 *
 * `fresh` skips the CDN's cached copy (up to a minute old), for when we
 * know seats just changed.
 */
async function fetchMonth(year: number, month0: number, signal?: AbortSignal, fresh = false): Promise<MonthData> {
  const k = monthKey(year, month0);
  const first = `${k}-01`;
  const last = `${k}-${String(new Date(year, month0 + 1, 0).getDate()).padStart(2, '0')}`;
  const today = marinaNow().date;
  const from = first < today ? today : first;
  if (from > last) return { days: {}, closed: [], source: 'none', fetchedAt: Date.now() };

  try {
    const bust = fresh ? `&fresh=${Date.now()}` : '';
    const res = await fetch(`/api/availability?from=${from}&to=${last}${bust}`, { signal });
    if (!res.ok) throw new Error(`availability ${res.status}`);
    const body = (await res.json()) as { days: DayAvailability[] };
    return {
      days: Object.fromEntries(body.days.map((d) => [d.date, d])),
      closed: body.days.filter((d) => d.closed).map((d) => d.date),
      source: 'full',
      fetchedAt: Date.now(),
    };
  } catch (err) {
    if (signal?.aborted) throw err;
  }

  try {
    const { blackouts } = await getMonthBlackouts(year, month0 + 1, { signal });
    return { days: {}, closed: blackouts, source: 'blackouts', fetchedAt: Date.now() };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { days: {}, closed: [], source: 'none', fetchedAt: Date.now() };
  }
}

type FunctionSlot = {
  timeSlot: string;
  sharedRemaining: number;
  privateAvailable: boolean;
  blackedOut: boolean;
  wholeDayBooked: boolean;
};

/**
 * Converts the getAvailability Cloud Function's day response into the
 * shape the UI uses. Returns null when the function had nothing to say (no
 * tours in Firestore), so the UI stays permissive.
 */
function fromFunctionSlots(date: string, slots: FunctionSlot[]): DayAvailability | null {
  if (slots.length === 0) return null;
  // Start from an empty day so the whole-day rules stay in one place.
  const base = computeDay(date, [], [], marinaNow());
  const bySlot = new Map(slots.map((s) => [s.timeSlot, s]));
  const twoHour: SlotState[] = base.slots
    .filter((s) => s.timeSlot !== 'whole-day')
    .map((s) => {
      const f = bySlot.get(s.timeSlot);
      if (!f) return s;
      // s.closed on an empty day: out of season (the sunset cruise).
      const closed = s.closed || f.blackedOut || f.wholeDayBooked;
      return {
        ...s,
        sharedRemaining: f.sharedRemaining,
        privateAvailable: f.privateAvailable,
        // "No seats and no private" could be a private booking or six shared
        // seats sold; the function doesn't say which.
        privatelyBooked: !closed && !f.privateAvailable && f.sharedRemaining === 0 ? null : false,
        closed,
      };
    });
  // A departure that doesn't run that day isn't a booking.
  const anyBooked = twoHour
    .filter((s) => slotRunsOn(s.timeSlot, date))
    .some((s) => s.sharedRemaining < 6 || !s.privateAvailable);
  const wholeDaySlot = bySlot.get('whole-day');
  const wholeDayClosed =
    !!wholeDaySlot?.blackedOut ||
    slots.some((s) => s.wholeDayBooked) ||
    twoHour.some((s) => s.closed && WHOLE_DAY_OVERLAPS.includes(s.timeSlot));
  const wholeDay = base.slots.find((s) => s.timeSlot === 'whole-day')!;
  return {
    date,
    closed: slotOrder.every((slot) => bySlot.get(slot)?.blackedOut),
    slots: [
      ...twoHour,
      {
        ...wholeDay,
        privateAvailable: !anyBooked && !wholeDayClosed,
        privatelyBooked: slots.some((s) => s.wholeDayBooked),
        closed: wholeDayClosed,
      },
    ],
  };
}

/**
 * Loads one month into `months` while it's missing. Responses from before
 * the last invalidate() are dropped, so a fetch that was already in flight
 * when seats changed can't put the old seats back.
 */
function useMonthFetch(
  k: string | null,
  needed: boolean,
  generation: number,
  latestGeneration: { current: number },
  fresh: { current: boolean },
  setMonths: (update: (m: Record<string, MonthData>) => Record<string, MonthData>) => void,
) {
  useEffect(() => {
    if (!k || !needed) return;
    const [y, m] = k.split('-').map(Number) as [number, number];
    const controller = new AbortController();
    fetchMonth(y, m - 1, controller.signal, fresh.current)
      .then((data) => {
        if (generation !== latestGeneration.current) return;
        setMonths((all) => ({ ...all, [k]: data }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [k, needed, generation, latestGeneration, fresh, setMonths]);
}

/**
 * Month-at-a-time availability for the booking calendar, plus seat counts
 * for the selected day when only the blackout fallback is available.
 */
export function useAvailability(year: number, month0: number, selectedDate: string | null) {
  const key = monthKey(year, month0);
  const [months, setMonths] = useState<Record<string, MonthData>>({});
  // Fallback per-day data; null = the function had nothing for that day.
  const [extraDays, setExtraDays] = useState<Record<string, DayAvailability | null>>({});
  // Bumped by invalidate(); fetches started before it are thrown away.
  const [generation, setGeneration] = useState(0);
  const latestGeneration = useRef(0);

  const haveMonth = key in months;
  // Set by invalidate(): from then on, fetches skip the CDN's cached copy.
  const fresh = useRef(false);

  // The visible month, and the selected date's month when the guest has
  // paged away from it: the departures panel needs that one's seats.
  const selectedKey = selectedDate ? selectedDate.slice(0, 7) : null;
  useMonthFetch(key, !haveMonth, generation, latestGeneration, fresh, setMonths);
  useMonthFetch(
    selectedKey,
    selectedKey !== null && selectedKey !== key && !(selectedKey in months),
    generation,
    latestGeneration,
    fresh,
    setMonths,
  );

  // Selected day, when its month only has the blackout fallback.
  const selectedMonth = selectedDate ? months[selectedDate.slice(0, 7)] : undefined;
  const needDay =
    !!selectedDate &&
    selectedMonth?.source === 'blackouts' &&
    !selectedMonth.closed.includes(selectedDate) &&
    !(selectedDate in extraDays);
  useEffect(() => {
    if (!needDay || !selectedDate) return;
    const controller = new AbortController();
    const current = () => generation === latestGeneration.current;
    getDayAvailability(selectedDate, { signal: controller.signal })
      .then(({ slots }) => {
        if (current()) setExtraDays((x) => ({ ...x, [selectedDate]: fromFunctionSlots(selectedDate, slots) }));
      })
      .catch(() => {
        if (!controller.signal.aborted && current()) setExtraDays((x) => ({ ...x, [selectedDate]: null }));
      });
    return () => controller.abort();
  }, [needDay, selectedDate, generation]);

  // Refresh when someone comes back to the tab after a while. Skips the
  // CDN: its copy can be a minute old, older than what's on screen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const cached = months[key];
      if (!cached || Date.now() - cached.fetchedAt < STALE_MS) return;
      const gen = latestGeneration.current;
      fetchMonth(year, month0, undefined, true)
        .then((data) => {
          if (gen !== latestGeneration.current) return;
          setMonths((m) => ({ ...m, [key]: data }));
          setExtraDays({});
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [months, key, year, month0]);

  /**
   * Drop cached data (e.g. after checkout says a slot just filled, or a
   * hold was released). Every month, since the change may not be in the
   * one on screen.
   */
  const invalidate = useCallback(() => {
    fresh.current = true;
    latestGeneration.current += 1;
    setGeneration(latestGeneration.current);
    setMonths({});
    setExtraDays({});
  }, []);

  const getDay = useCallback(
    (iso: string): DayAvailability | undefined => {
      const m = months[iso.slice(0, 7)];
      if (!m) return undefined;
      const day = m.days[iso] ?? extraDays[iso] ?? undefined;
      if (day) return day;
      if (m.closed.includes(iso)) return computeDay(iso, [], [{ date: iso, affectedSlots: ['all'] }]);
      return undefined;
    },
    [months, extraDays],
  );

  /** Seat counts for this date are still on their way. */
  const isPending = useCallback(
    (iso: string) => {
      const m = months[iso.slice(0, 7)];
      if (!m) return true;
      return m.source === 'blackouts' && !m.closed.includes(iso) && !(iso in extraDays);
    },
    [months, extraDays],
  );

  return {
    loading: !haveMonth,
    getDay,
    isPending,
    invalidate,
  };
}
