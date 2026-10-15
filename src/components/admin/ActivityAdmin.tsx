'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  getBooking,
  listRecentAuditLog,
  type AuditCursor,
  type AuditEntryDoc,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { addDaysIso, marinaNow } from '@/lib/availability';
import { parseIsoDate } from '@/lib/date';
import { SITE_IMAGE_SLOTS } from '@/lib/site-images';
import { formatPrice, tours } from '@/lib/tours';
import { clsx } from '@/lib/clsx';
import { departureTime, shortDate, slotLabel } from './booking-labels';

/*
 * Each log entry is shown as one plain sentence. The server's action names
 * are grouped into kinds here; entries written before settings, messages,
 * date-change requests and notes had their own actions were logged as
 * `tour.update` / `booking.update`, so they're sorted out by target too.
 */

type Kind =
  | 'cancel'
  | 'refund'
  | 'move'
  | 'edit'
  | 'note'
  | 'email'
  | 'complete'
  | 'no-show'
  | 'create'
  | 'close-day'
  | 'reopen-day'
  | 'request'
  | 'message'
  | 'review'
  | 'photo'
  | 'tour'
  | 'rates'
  | 'settings'
  | 'crew'
  | 'other';

/** Filter labels, in the order the filter lists them. */
const KIND_LABEL: Record<Kind, string> = {
  cancel: 'Cancellations',
  refund: 'Refunds',
  move: 'Moved bookings',
  edit: 'Booking details changed',
  note: 'Notes',
  email: 'Emails sent',
  complete: 'Marked completed',
  'no-show': 'Marked no-show',
  create: 'Bookings added',
  'close-day': 'Closed days',
  'reopen-day': 'Reopened days',
  request: 'Date-change requests',
  message: 'Messages',
  review: 'Reviews',
  photo: 'Website photos',
  tour: 'Tour changes',
  rates: 'Seasonal prices',
  settings: 'Settings changes',
  crew: 'Crew changes',
  other: 'Other',
};

/** Money going back to customers, or tours called off. */
const ALERT_KINDS = new Set<Kind>(['cancel', 'refund', 'close-day']);

function kindOf(e: AuditEntryDoc): Kind {
  const p = e.payload ?? {};
  switch (e.action) {
    case 'booking.cancel':
      return 'cancel';
    case 'booking.refund':
      return 'refund';
    case 'booking.reschedule':
      return 'move';
    case 'booking.complete':
      return 'complete';
    case 'booking.no-show':
      return 'no-show';
    case 'booking.create':
      return 'create';
    case 'booking.note':
      return 'note';
    case 'booking.update':
      if (e.targetId.startsWith('contactMessage/')) return 'message';
      if (e.targetId.startsWith('rescheduleRequest/')) return 'request';
      if (p.field === 'adminNotes') return 'note';
      if (p.action === 'resend-confirmation' || p.action === 'send-post-tour-followup' || p.action === 'fix-bounced-email') {
        return 'email';
      }
      return 'edit';
    case 'message.update':
      return 'message';
    case 'reschedule.update':
      return 'request';
    case 'settings.update':
      return 'settings';
    case 'tour.update':
      return e.targetId === 'site' ? 'settings' : 'tour';
    case 'rateSeason.upsert':
    case 'rateSeason.delete':
      return 'rates';
    case 'blackout.create':
      return 'close-day';
    case 'blackout.delete':
      return 'reopen-day';
    case 'siteImage.update':
    case 'siteImage.delete':
      return 'photo';
    case 'testimonial.upsert':
    case 'testimonial.delete':
      return 'review';
    case 'crew.add':
    case 'crew.password':
    case 'crew.remove':
      return 'crew';
    default:
      return 'other';
  }
}

const BOOKING_KINDS = new Set<Kind>(['cancel', 'refund', 'move', 'edit', 'note', 'email', 'complete', 'no-show', 'create']);

/** The booking an entry is about, if any. */
function bookingIdOf(e: AuditEntryDoc): string | null {
  const kind = kindOf(e);
  if (BOOKING_KINDS.has(kind)) return e.targetId;
  if (kind === 'request') return str(e.payload ?? {}, 'bookingId');
  return null;
}

/* -------------------------------------------------------------------------- */
/* Sentences                                                                   */
/* -------------------------------------------------------------------------- */

type Payload = Record<string, unknown>;
type Segment = string | { label: string; href: string };

interface Described {
  segments: Segment[];
  note?: string;
}

interface Context {
  bookings: ReadonlyMap<string, BookingDoc | null>;
  /** blackout id → the date it closed (for "Reopened …"). */
  closedDates: ReadonlyMap<string, string>;
  /** review id → who wrote it (for "Deleted the review from …"). */
  reviewAuthors: ReadonlyMap<string, string>;
  /** Photo saves that kept the same file, i.e. only the description changed. */
  descriptionOnly: ReadonlySet<string>;
}

function str(p: Payload, key: string): string | null {
  const v = p[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(p: Payload, key: string): number {
  const v = p[key];
  return typeof v === 'number' ? v : 0;
}

function obj(p: Payload, key: string): Payload {
  const v = p[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : {};
}

function list(p: Payload, key: string): string[] {
  const v = p[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** "a", "a and b", "a, b and c" */
function joinWords(words: string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Oct 18" */
function monthDay(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : iso;
}

/** "Sat, Oct 18 at 8:00 AM" */
function dateAndTime(date: string | null, tourId: string | null, timeSlot: string | null): string {
  if (!date) return '';
  const time = tourId || timeSlot ? departureTime({ tourId: tourId ?? '', timeSlot: timeSlot ?? '' }) : '';
  return time ? `${shortDate(date)} at ${time}` : shortDate(date);
}

const EDIT_FIELD: Record<string, string> = {
  guestCount: 'number of guests',
  guests: 'guest names and ages',
  customerName: 'name',
  customerEmail: 'email address',
  customerPhone: 'phone number',
  emergencyContactName: 'emergency contact',
  emergencyContactPhone: 'emergency contact',
};

const TOUR_FIELD: Record<string, string> = {
  name: 'name',
  description: 'description',
  pricePerPerson: 'price',
  flatPrice: 'price',
  active: 'on/off',
  included: 'what’s included',
};

const SETTINGS_FIELD: Record<string, string> = {
  cancellationPolicyText: 'cancellation policy',
  contactEmail: 'contact email',
};

const CLOSE_REASON: Record<string, string> = {
  weather: ' for weather',
  maintenance: ' for boat maintenance',
  personal: ' for personal reasons',
};

const FOLLOWUP_SKIPPED: Record<string, string> = {
  'already-sent': 'Not sent: it had already gone out.',
  'not-confirmed': 'Not sent: the booking wasn’t confirmed.',
  'not-yet': 'Not sent: the tour hadn’t happened yet.',
  'too-old': 'Not sent: the tour was too long ago.',
  'not-found': 'Not sent: the booking couldn’t be found.',
};

function fieldsChanged(after: Payload, labels: Record<string, string>): string[] {
  return Object.keys(after)
    .map((k) => labels[k])
    .filter((l): l is string => !!l);
}

function describe(e: AuditEntryDoc, kind: Kind, ctx: Context): Described {
  const p: Payload = e.payload ?? {};

  /** "Pat Example’s Oct 18 booking", linked to the booking. */
  function booking(id: string, opts: { noun?: string; withDate?: boolean } = {}): Segment {
    const noun = opts.noun ?? 'booking';
    const b = ctx.bookings.get(id);
    const when = b && opts.withDate !== false ? `${monthDay(b.date)} ` : '';
    const who = b?.customerName?.trim();
    const label = who ? `${who}’s ${when}${noun}` : b ? `the ${when}${noun}` : `a ${noun}`;
    return { label, href: `/admin/bookings/${encodeURIComponent(id)}` };
  }

  const reason = str(p, 'reason');
  const reasonNote = reason ? `Reason: ${reason}` : undefined;

  switch (kind) {
    case 'cancel': {
      const refund = num(p, 'refundCents');
      const manual = num(p, 'manualRefundCents');
      const money =
        refund > 0
          ? `, refunded ${formatPrice(refund)}`
          : manual > 0
            ? `. ${formatPrice(manual)} to pay back by hand (paid on the old website)`
            : ', nothing to refund';
      const notes = [reasonNote, p.emailed === true ? 'Customer was emailed.' : null].filter(Boolean);
      return {
        segments: ['Cancelled ', booking(e.targetId), money],
        note: notes.length ? notes.join(' · ') : undefined,
      };
    }
    case 'refund':
      return {
        segments: [`Refunded ${formatPrice(num(p, 'refundCents'))} on `, booking(e.targetId)],
        note: reasonNote,
      };
    case 'move': {
      const before = obj(p, 'before');
      const after = obj(p, 'after');
      const from = dateAndTime(str(before, 'date'), str(before, 'tourId'), str(before, 'timeSlot'));
      const to = dateAndTime(str(after, 'date'), str(after, 'tourSlug'), null);
      return {
        segments: [
          'Moved ',
          booking(e.targetId, { withDate: false }),
          from && to ? ` from ${from} to ${to}` : to ? ` to ${to}` : '',
        ],
      };
    }
    case 'complete':
      return { segments: ['Marked ', booking(e.targetId, { noun: 'tour' }), ' as completed'] };
    case 'no-show':
      return { segments: ['Marked ', booking(e.targetId), ' as a no-show'] };
    case 'create':
      return { segments: ['Added ', booking(e.targetId)] };
    case 'note': {
      const before = (typeof p.before === 'string' ? p.before : '').trim();
      const after = (typeof p.after === 'string' ? p.after : '').trim();
      const verb = !after ? 'Cleared the note on ' : !before ? 'Added a note to ' : 'Changed the note on ';
      return { segments: [verb, booking(e.targetId)], note: after ? `“${after}”` : undefined };
    }
    case 'edit': {
      const fields = fieldsChanged(obj(p, 'after'), EDIT_FIELD);
      return {
        segments: [
          `Changed the ${fields.length ? joinWords(fields) : 'details'} on `,
          booking(e.targetId),
        ],
      };
    }
    case 'email': {
      if (p.action === 'resend-confirmation') {
        return { segments: ['Re-sent the confirmation email for ', booking(e.targetId)] };
      }
      if (p.action === 'fix-bounced-email') {
        const to = str(obj(p, 'after'), 'customerEmail');
        return {
          segments: ['Fixed a bounced email address on ', booking(e.targetId)],
          note: to ? `Now ${to}` : undefined,
        };
      }
      if (p.sent === true) {
        return { segments: ['Sent a thank-you email for ', booking(e.targetId)] };
      }
      return {
        segments: ['Tried to send a thank-you email for ', booking(e.targetId)],
        note: FOLLOWUP_SKIPPED[str(p, 'skipped') ?? ''] ?? 'It wasn’t sent.',
      };
    }
    case 'close-day': {
      const date = str(p, 'date');
      const day = date ? shortDate(date) : 'a day';
      const slots = list(p, 'affectedSlots');
      const what =
        slots.length === 0 || slots.includes('all')
          ? `Closed ${day}`
          : `Closed the ${joinWords(slots.map((s) => slotLabel(s).toLowerCase()))} ${
              slots.length === 1 ? 'tour' : 'tours'
            } on ${day}`;
      const cancelled = list(p, 'cancelledBookingIds').length;
      const failed = list(p, 'failedBookingIds').length;
      return {
        segments: [
          what,
          CLOSE_REASON[reason ?? ''] ?? '',
          cancelled ? `, cancelled ${plural(cancelled, 'booking')}` : '',
        ],
        note: failed
          ? `${plural(failed, 'booking')} couldn’t be cancelled. Check ${failed === 1 ? 'it' : 'them'} on the calendar.`
          : undefined,
      };
    }
    case 'reopen-day': {
      const date = ctx.closedDates.get(e.targetId);
      return { segments: [date ? `Reopened ${shortDate(date)}` : 'Reopened a closed day'] };
    }
    case 'request': {
      const bookingId = str(p, 'bookingId');
      const whose: Segment = bookingId
        ? booking(bookingId, { noun: 'date-change request' })
        : 'a date-change request';
      const adminNotes = str(p, 'adminNotes');
      const note = adminNotes ? `Note: “${adminNotes}”` : undefined;
      switch (p.status) {
        case 'accepted':
          return { segments: ['Accepted ', whose], note };
        case 'declined':
          return { segments: ['Declined ', whose], note };
        case 'resolved':
          return { segments: ['Marked ', whose, ' as done'], note };
        case 'open':
          return { segments: ['Reopened ', whose], note };
        default:
          return { segments: ['Updated ', whose], note };
      }
    }
    case 'message': {
      const from = str(p, 'from');
      const whose = from ? `the message from ${from}` : 'a message';
      switch (p.status) {
        case 'replied':
          return { segments: [`Marked ${whose} as replied`] };
        case 'archived':
          return { segments: [`Archived ${whose}`] };
        case 'new':
          return { segments: [`Marked ${whose} as new`] };
        default:
          return { segments: [`Updated ${whose}`] };
      }
    }
    case 'review': {
      if (e.action === 'testimonial.delete') {
        const author = ctx.reviewAuthors.get(e.targetId);
        return { segments: [author ? `Deleted the review from ${author}` : 'Deleted a review'] };
      }
      const after = obj(p, 'after');
      const author = str(after, 'author');
      return {
        segments: [
          p.isNew === true ? 'Added a review' : 'Edited the review',
          author ? ` from ${author}` : '',
        ],
        note: after.published === false ? 'Hidden from the website.' : undefined,
      };
    }
    case 'photo': {
      const label = SITE_IMAGE_SLOTS.find((s) => s.slot === e.targetId)?.label;
      const spot = label ? `“${label}”` : 'a spot on the website';
      if (e.action === 'siteImage.delete') {
        return {
          segments: [`Removed the photo for ${spot}`],
          note: 'The built-in photo shows there instead.',
        };
      }
      return {
        segments: [
          ctx.descriptionOnly.has(e.id)
            ? `Changed the photo description for ${spot}`
            : `Uploaded a new photo for ${spot}`,
        ],
      };
    }
    case 'tour': {
      const after = obj(p, 'after');
      const name =
        tours.find((t) => t.slug === e.targetId)?.name ?? str(obj(p, 'before'), 'name') ?? e.targetId;
      const keys = Object.keys(after).filter((k) => k !== 'updatedAt');
      if (keys.length === 1 && keys[0] === 'active') {
        return {
          segments: [
            after.active === false
              ? `Stopped taking bookings for “${name}”`
              : `Started taking bookings for “${name}”`,
          ],
        };
      }
      const fields = fieldsChanged(after, TOUR_FIELD);
      return {
        segments: [`Changed “${name}”${fields.length ? ` (${joinWords(fields)})` : ''}`],
      };
    }
    case 'rates': {
      const season = obj(p, e.action === 'rateSeason.delete' ? 'before' : 'after');
      const name = str(season, 'name');
      const start = str(season, 'startDate');
      const end = str(season, 'endDate');
      const what = name ? `the “${name}” seasonal prices` : 'seasonal prices';
      const when = start && end ? ` (${monthDay(start)} to ${monthDay(end)})` : '';
      const verb =
        e.action === 'rateSeason.delete' ? 'Deleted ' : p.isNew === true ? 'Added ' : 'Changed ';
      return { segments: [verb, what, when] };
    }
    case 'settings': {
      const fields = fieldsChanged(obj(p, 'after'), SETTINGS_FIELD);
      return { segments: [`Changed the ${fields.length ? joinWords(fields) : 'settings'}`] };
    }
    case 'crew': {
      const name = str(p, 'name') ?? str(obj(p, 'before'), 'name') ?? 'a crew member';
      if (e.action === 'crew.add') return { segments: [`Added ${name} to the crew`] };
      if (e.action === 'crew.remove') return { segments: [`Removed ${name} from the crew`] };
      const devices = num(p, 'signedOutDevices');
      return {
        segments: [`Set a new password for ${name}`],
        note: devices ? `Signed out on ${plural(devices, 'device')}.` : undefined,
      };
    }
    case 'other':
      return { segments: ['Made a change'] };
  }
}

function buildContext(
  entries: AuditEntryDoc[],
  bookings: ReadonlyMap<string, BookingDoc | null>,
): Context {
  const closedDates = new Map<string, string>();
  const reviewAuthors = new Map<string, string>();
  const descriptionOnly = new Set<string>();
  const lastPhoto = new Map<string, string>();

  // Oldest first, so each photo save is compared with the one before it.
  for (const e of [...entries].reverse()) {
    const p = e.payload ?? {};
    if (e.action === 'blackout.create') {
      const date = str(p, 'date');
      if (date) closedDates.set(e.targetId, date);
    } else if (e.action === 'testimonial.upsert') {
      const author = str(obj(p, 'after'), 'author');
      if (author) reviewAuthors.set(e.targetId, author);
    } else if (e.action === 'siteImage.update') {
      const path = str(p, 'storagePath');
      if (path && lastPhoto.get(e.targetId) === path) descriptionOnly.add(e.id);
      if (path) lastPhoto.set(e.targetId, path);
    } else if (e.action === 'siteImage.delete') {
      lastPhoto.delete(e.targetId);
    }
  }
  return { bookings, closedDates, reviewAuthors, descriptionOnly };
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

function entryDate(e: AuditEntryDoc): Date | null {
  return e.createdAt ? new Date(e.createdAt.seconds * 1000) : null;
}

// Days and times are marina time, wherever Travis is reading them.
function dayLabel(d: Date | null): string {
  if (!d) return 'Date not recorded';
  const day = marinaNow(d).date;
  const today = marinaNow().date;
  if (day === today) return 'Today';
  if (day === addDaysIso(today, -1)) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
    timeZone: 'America/New_York',
  });
}

function timeLabel(d: Date | null): string {
  return d
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    : '';
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

interface Row {
  entry: AuditEntryDoc;
  kind: Kind;
  described: Described;
  day: string;
  time: string;
  searchText: string;
}

/** Loads a page of the log plus the bookings it mentions that aren't loaded yet. */
async function loadPage(after: AuditCursor | null, known: ReadonlyMap<string, unknown>) {
  const page = await listRecentAuditLog(after);
  const ids = [
    ...new Set(
      page.entries.map(bookingIdOf).filter((id): id is string => !!id && !known.has(id)),
    ),
  ];
  const found = await Promise.all(
    ids.map(async (id) => [id, await getBooking(id).catch(() => null)] as const),
  );
  return { ...page, found };
}

const inputClass =
  'min-h-11 rounded-[10px] border border-[var(--color-line-strong)] bg-white px-3 py-2 text-base focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function ActivityAdmin() {
  const [entries, setEntries] = useState<AuditEntryDoc[] | null>(null);
  const [bookings, setBookings] = useState<ReadonlyMap<string, BookingDoc | null>>(new Map());
  const [next, setNext] = useState<AuditCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadPage(null, new Map())
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setNext(page.next);
        setBookings(new Map(page.found));
      })
      .catch(() => {
        if (!cancelled) setError('Couldn’t load the activity. Check your connection, then reload the page.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await loadPage(next, bookings);
      setEntries((prev) => [...(prev ?? []), ...page.entries]);
      setNext(page.next);
      setBookings((prev) => new Map([...prev, ...page.found]));
    } catch {
      setError('Couldn’t load older changes. Check your connection and try again.');
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = useMemo<Row[] | null>(() => {
    if (!entries) return null;
    const ctx = buildContext(entries, bookings);
    return entries.map((entry) => {
      const kind = kindOf(entry);
      const described = describe(entry, kind, ctx);
      const d = entryDate(entry);
      const sentence = described.segments
        .map((s) => (typeof s === 'string' ? s : s.label))
        .join('');
      const b = bookings.get(bookingIdOf(entry) ?? '');
      return {
        entry,
        kind,
        described,
        day: dayLabel(d),
        time: timeLabel(d),
        searchText: [sentence, described.note, dayLabel(d), b?.customerName, b?.customerEmail, b?.customerPhone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [entries, bookings]);

  const kindsInData = useMemo(() => {
    const counts = new Map<Kind, number>();
    for (const r of rows ?? []) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return (Object.keys(KIND_LABEL) as Kind[])
      .filter((k) => counts.has(k))
      .map((k) => ({ kind: k, count: counts.get(k)! }));
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) => (kindFilter === 'all' || r.kind === kindFilter) && (!q || r.searchText.includes(q)),
    );
  }, [rows, kindFilter, search]);

  const days = useMemo(() => {
    const out: Array<{ day: string; rows: Row[] }> = [];
    for (const r of filtered ?? []) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) last.rows.push(r);
      else out.push({ day: r.day, rows: [r] });
    }
    return out;
  }, [filtered]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }

  const filtering = kindFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="sr-only" htmlFor="activity-kind">
          Show
        </label>
        <select
          id="activity-kind"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as Kind | 'all')}
          className={clsx(inputClass, 'sm:w-64')}
        >
          <option value="all">Everything ({rows?.length ?? 0})</option>
          {kindsInData.map(({ kind, count }) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]} ({count})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="activity-search">
          Search
        </label>
        <input
          id="activity-search"
          type="search"
          placeholder="Search by customer name, email or date"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={clsx(inputClass, 'w-full sm:flex-1')}
        />
      </div>

      {rows === null ? (
        !error && (
          <div className="bg-white rounded-2xl border border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
            Loading…
          </div>
        )
      ) : days.length === 0 ? (
        <div className="bg-[var(--color-cream)] rounded-2xl p-6 text-center text-sm text-[var(--color-ink-soft)]">
          {rows.length === 0
            ? 'Nothing has been changed yet.'
            : next
              ? 'Nothing found in these changes. Tap “Show older changes” below to look further back.'
              : 'Nothing found.'}
        </div>
      ) : (
        days.map((group) => (
          <Fragment key={group.day}>
            <h2 className="pt-2 text-sm font-medium text-[var(--color-ink-soft)]">{group.day}</h2>
            <ul className="space-y-2">
              {group.rows.map(({ entry, kind, described, time }) => {
                const open = expanded.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className={clsx(
                      'bg-white rounded-2xl border border-[var(--color-line)] shadow-[var(--shadow-panel)] px-4 pt-3',
                      ALERT_KINDS.has(kind) && 'border-l-4 border-l-[var(--color-coral)]',
                      open ? 'pb-3' : 'pb-1',
                    )}
                  >
                    <p className="text-base leading-snug text-[var(--color-ink)]">
                      {described.segments.map((s, i) =>
                        typeof s === 'string' ? (
                          <Fragment key={i}>{s}</Fragment>
                        ) : (
                          <Link
                            key={i}
                            href={s.href}
                            className="font-medium text-[var(--color-brand-blue)] underline underline-offset-2"
                          >
                            {s.label}
                          </Link>
                        ),
                      )}
                    </p>
                    {described.note && (
                      <p className="mt-1 text-sm text-[var(--color-ink-soft)] break-words">
                        {described.note}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-[var(--color-ink-soft)]">
                        {time}
                        {entry.via === 'mcp' && ' · by automation'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(entry.id)}
                        aria-expanded={open}
                        className="min-h-11 -mr-3 px-3 text-sm text-[var(--color-brand-blue)]"
                      >
                        {open ? 'Hide details' : 'Details'}
                      </button>
                    </div>
                    {open && (
                      <pre className="rounded-xl bg-[var(--color-cream)] p-3 text-xs font-mono whitespace-pre-wrap break-all text-[var(--color-ink)]">
                        {JSON.stringify(
                          {
                            action: entry.action,
                            target: entry.targetId,
                            by: entry.actorEmail,
                            ...(entry.via && { via: entry.via }),
                            payload: entry.payload ?? {},
                          },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))
      )}

      {rows && next && (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="min-h-11 w-full sm:w-auto px-5 rounded-xl border border-[var(--color-ink)]/15 bg-white text-base font-medium hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Show older changes'}
          </button>
          {filtering && (
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              The filter and search only look through the changes shown so far.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
