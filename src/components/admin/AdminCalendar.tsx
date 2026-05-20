'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventInput, EventClickArg, DatesSetArg } from '@fullcalendar/core';
import {
  listBookingsBetween,
  listBlackoutsBetween,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { slotLabels } from '@/lib/tours';

const FullCalendar = dynamic(() => import('@fullcalendar/react'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)]">
      Loading calendar…
    </div>
  ),
});

const STATUS_COLORS: Record<BookingDoc['status'], { bg: string; border: string }> = {
  'pending-payment': { bg: '#E08266', border: '#C86A50' },
  confirmed: { bg: '#1B6FA8', border: '#145582' },
  cancelled: { bg: '#7A8B7E', border: '#5F6F62' },
  completed: { bg: '#3B7A57', border: '#2D5A41' },
  'no-show': { bg: '#A37A4B', border: '#6F532F' },
};

export function AdminCalendar() {
  const router = useRouter();
  const [events, setEvents] = useState<EventInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rangeRef = useRef<{ start: string; end: string } | null>(null);
  // FullCalendar's plugins are lazily required so they're only loaded on
  // the client.
  const [plugins, setPlugins] = useState<unknown[] | null>(null);

  useEffect(() => {
    let mounted = true;
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
    setLoading(true);
    setError(null);
    try {
      const [bookings, blackouts] = await Promise.all([
        listBookingsBetween(startIso, endIso),
        listBlackoutsBetween(startIso, endIso),
      ]);
      const bookingEvents: EventInput[] = bookings.map((b) => {
        const color = STATUS_COLORS[b.status];
        return {
          id: b.id,
          title: `${b.tourName.replace(/^2hr |Whole Day /, '').replace(/ — .*/, '')}: ${b.customerName} (${b.guestCount})`,
          start: b.date,
          allDay: true,
          backgroundColor: color.bg,
          borderColor: color.border,
          textColor: '#fff',
          extendedProps: {
            bookingId: b.id,
            tourName: b.tourName,
            timeSlot: b.timeSlot,
            status: b.status,
            type: b.type,
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
              backgroundColor: 'rgba(122,139,126,0.25)',
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
            borderColor: '#7A8B7E',
            textColor: '#5F6F62',
          },
        ];
      });

      setEvents([...bookingEvents, ...blackoutEvents]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      setLoading(false);
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
      { label: 'Pending payment', color: STATUS_COLORS['pending-payment'].bg },
      { label: 'Cancelled', color: STATUS_COLORS.cancelled.bg },
      { label: 'Completed', color: STATUS_COLORS.completed.bg },
      { label: 'No-show', color: STATUS_COLORS['no-show'].bg },
    ],
    [],
  );

  return (
    <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-3 sm:p-5">
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
        {loading && (
          <span className="text-xs text-[var(--color-ink-soft)] animate-pulse">
            Loading…
          </span>
        )}
      </div>

      <style>{`
        .fc { font-family: var(--font-sans); }
        .fc .fc-toolbar-title { font-family: var(--font-display); font-size: 1.25rem; }
        .fc .fc-button {
          background: var(--color-brand-blue) !important;
          border-color: var(--color-brand-blue) !important;
          border-radius: 999px !important;
          padding: 6px 14px !important;
          font-size: 0.85rem !important;
          text-transform: capitalize !important;
        }
        .fc .fc-button:hover { background: var(--color-brand-blue-dark) !important; }
        .fc .fc-button-active { background: var(--color-coral) !important; border-color: var(--color-coral) !important; }
        .fc .fc-event { font-size: 0.75rem; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
        .fc .fc-daygrid-day-number { font-size: 0.85rem; }
        .fc th { font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-ink-soft); }
      `}</style>

      {plugins ? (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <FullCalendar
          plugins={plugins as any}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          datesSet={handleDatesSet}
          events={events}
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
