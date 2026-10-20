'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventInput, EventClickArg, DatesSetArg, PluginDef } from '@fullcalendar/core';
import {
  listBookingsBetween,
  listBlackoutsBetween,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { slotLabels, tours } from '@/lib/tours';
import { awaitingMove, departureMinutes, partySize } from './booking-labels';

/** `2026-10-14T08:00:00`, in the marina's local time like the rest of the admin. */
function at(date: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${date}T${h}:${m}:00`;
}

const FullCalendar = dynamic(() => import('@fullcalendar/react'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl bg-white border border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-soft)]">
      Loading calendar…
    </div>
  ),
});

// Site palette. Live bookings are solid; finished or dead ones are pale
// with dark text (and cancelled is struck through), so a cancelled booking
// can't be mistaken for a confirmed one. Every pair passes 4.5:1.
const STATUS_COLORS: Record<BookingDoc['status'], { bg: string; border: string; text: string }> = {
  'pending-payment': { bg: '#C2491A', border: '#A33D14', text: '#FFFFFF' }, // orange: waiting on payment
  confirmed: { bg: '#16625A', border: '#0D3532', text: '#FFFFFF' }, // spring green
  cancelled: { bg: '#F4F2EC', border: '#B9B2A2', text: '#4B5D59' }, // pale, struck through
  completed: { bg: '#E2EDE9', border: '#9DBFB6', text: '#0D3532' }, // pale green: done
  'no-show': { bg: '#8A5A1F', border: '#6B4517', text: '#FFFFFF' }, // brown
};

/** Travis closed the departure; the customer is picking a new date. Pale and dashed: not going out. */
const CLOSED_COLOR = { bg: '#FFFFFF', border: '#C2491A', text: '#A33D14' };

export function AdminCalendar() {
  const router = useRouter();
  const [events, setEvents] = useState<EventInput[]>([]);
  // Cancelled bookings (over a hundred came over from the old site) bury the
  // live ones, so they're hidden unless asked for.
  const [showCancelled, setShowCancelled] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rangeRef = useRef<{ start: string; end: string } | null>(null);
  // FullCalendar's plugins are lazily required so they're only loaded on
  // the client.
  const [plugins, setPlugins] = useState<PluginDef[] | null>(null);

  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on mount
    setNarrow(window.matchMedia('(max-width: 639px)').matches);
    Promise.all([
      import('@fullcalendar/daygrid'),
      import('@fullcalendar/timegrid'),
      import('@fullcalendar/interaction'),
    ]).then(([dg, tg, ix]) => {
      if (!mounted) return;
      setPlugins([dg.default, tg.default, ix.default]);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function loadRange(startIso: string, endIso: string) {
    // Tapping next/prev quickly starts several loads. Only the one for the
    // range still on screen may touch state; a slower, older reply would
    // otherwise replace it with the wrong month.
    const stillShowing = () =>
      rangeRef.current?.start === startIso && rangeRef.current?.end === endIso;
    setLoading(true);
    setError(null);
    try {
      const [bookings, blackouts] = await Promise.all([
        listBookingsBetween(startIso, endIso),
        listBlackoutsBetween(startIso, endIso),
      ]);
      if (!stillShowing()) return;
      const bookingEvents: EventInput[] = bookings.map((b) => {
        const closed = awaitingMove(b);
        const color = closed ? CLOSED_COLOR : STATUS_COLORS[b.status];
        const start = departureMinutes(b);
        const hours = tours.find((t) => t.slug === b.tourId)?.durationHours ?? 2;
        return {
          id: b.id,
          title: `${closed ? 'Closed: ' : ''}${b.customerName} (${b.guestCount || '?'})`,
          start: at(b.date, start),
          end: at(b.date, Math.min(start + hours * 60, 23 * 60 + 59)),
          allDay: false,
          backgroundColor: color.bg,
          borderColor: color.border,
          textColor: color.text,
          classNames: b.status === 'cancelled' ? ['fc-event-cancelled'] : closed ? ['fc-event-closed'] : [],
          extendedProps: {
            bookingId: b.id,
            tourName: b.tourName,
            timeSlot: b.timeSlot,
            status: b.status,
            type: b.type,
            party: partySize(b),
          },
        };
      });

      const blackoutEvents: EventInput[] = blackouts.flatMap((bo): EventInput[] => {
        const isWholeDay = bo.affectedSlots.includes('all');
        if (isWholeDay) {
          return [
            {
              id: `blackout-${bo.id}`,
              start: bo.date,
              allDay: true,
              display: 'background',
              backgroundColor: 'rgba(110,139,132,0.22)',
            },
          ];
        }
        return [
          {
            id: `blackout-${bo.id}`,
            title: `Closed: ${bo.affectedSlots.map((s) => slotLabels[s as keyof typeof slotLabels] ?? s).join(', ')}`,
            start: bo.date,
            allDay: true,
            backgroundColor: 'transparent',
            borderColor: '#6E8B84',
            textColor: '#4B5D59',
          },
        ];
      });

      setEvents([...bookingEvents, ...blackoutEvents]);
    } catch (err) {
      if (!stillShowing()) return;
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      if (stillShowing()) setLoading(false);
    }
  }

  function handleDatesSet(arg: DatesSetArg) {
    const startIso = arg.startStr.slice(0, 10);
    const endIso = arg.endStr.slice(0, 10);
    if (
      rangeRef.current?.start === startIso &&
      rangeRef.current?.end === endIso
    ) {
      return;
    }
    rangeRef.current = { start: startIso, end: endIso };
    void loadRange(startIso, endIso);
  }

  function handleEventClick(arg: EventClickArg) {
    const bookingId = arg.event.extendedProps.bookingId as string | undefined;
    if (bookingId) {
      router.push(`/admin/bookings/${bookingId}`);
    }
  }

  const legend = useMemo(
    () => [
      { label: 'Confirmed', color: STATUS_COLORS.confirmed.bg },
      { label: 'Not paid yet', color: STATUS_COLORS['pending-payment'].bg },
      { label: 'Completed', color: STATUS_COLORS.completed.bg },
      { label: 'No-show', color: STATUS_COLORS['no-show'].bg },
      { label: 'Closed: customer choosing', color: CLOSED_COLOR.border },
    ],
    [],
  );

  return (
    <div className="bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] p-3 sm:p-5">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 mb-3 text-sm">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex flex-wrap gap-3 text-xs">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <span className="text-xs text-[var(--color-ink-soft)] animate-pulse">
              Loading…
            </span>
          )}
          <label className="inline-flex items-center gap-2 text-sm min-h-11">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
              className="w-5 h-5"
            />
            Show cancelled
          </label>
        </div>
      </div>

      <style>{`
        .fc { font-family: var(--font-sans); }
        .fc .fc-toolbar-title { font-family: var(--font-display); font-weight: 800; font-stretch: 116%; letter-spacing: -0.02em; font-size: 1.35rem; }
        .fc .fc-button {
          background: var(--color-brand-blue) !important;
          border-color: var(--color-brand-blue) !important;
          border-radius: 8px !important;
          padding: 6px 14px !important;
          font-size: 0.85rem !important;
          text-transform: capitalize !important;
        }
        .fc .fc-button:hover { background: var(--color-brand-blue-dark) !important; }
        .fc .fc-button-active { background: var(--color-coral) !important; border-color: var(--color-coral) !important; }
        .fc .fc-event { font-size: 0.75rem; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
        .fc .fc-event-cancelled .fc-event-title { text-decoration: line-through; }
        .fc .fc-event-closed { border-style: dashed !important; }
        .fc .fc-daygrid-day-number { font-size: 0.85rem; }
        .fc th { font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-ink-soft); }
      `}</style>

      {plugins ? (
        <FullCalendar
          plugins={plugins}
          initialView="dayGridMonth"
          headerToolbar={
            narrow
              ? { left: 'prev,next', center: 'title', right: 'today' }
              : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }
          }
          footerToolbar={narrow ? { center: 'dayGridMonth,timeGridDay' } : undefined}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
          displayEventEnd={false}
          slotMinTime="07:00:00"
          // Late enough for a June sunset cruise (back around 9 PM).
          slotMaxTime="21:30:00"
          allDaySlot
          datesSet={handleDatesSet}
          events={showCancelled ? events : events.filter((e) => e.extendedProps?.status !== 'cancelled')}
          eventClick={handleEventClick}
          height="auto"
          dayMaxEventRows={3}
          firstDay={0}
        />
      ) : (
        <div className="text-sm text-[var(--color-ink-soft)] py-8 text-center">
          Loading…
        </div>
      )}
    </div>
  );
}
