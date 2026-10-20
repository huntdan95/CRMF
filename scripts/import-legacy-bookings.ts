/**
 * Import bookings exported from the old WordPress site (Charter Boat
 * Bookings + WooCommerce) into the Firestore `bookings` collection.
 *
 * Input: the bookings CSV exported from the old admin
 * (`CRMF_bookings_2023-2026.csv`), one row per old booking.
 *
 * Usage:
 *   npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv --dry-run
 *   npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv
 *   npm run import:legacy -- --file <csv> --update-existing --dry-run   # what the re-sync would change
 *   npm run import:legacy -- --file <csv> --update-existing   # re-sync at launch
 *   npm run import:legacy -- --file <csv> --emulator          # local emulator
 *
 * Credentials: same as `npm run seed` (service-account vars in .env.local,
 * or GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Keep the CSV OUTSIDE the repo: it holds customer names, emails and phones.
 *
 * Mapping decisions (confirmed with the owner's side, Oct 2026):
 *  - Doc id is `legacy-<old booking #>`, so re-running never duplicates.
 *  - Old "confirmed"  → `completed` if the tour date is before today (ET),
 *                        otherwise `confirmed`.
 *  - Old "reserved"   → `pending-payment` (private tours held before full
 *                        payment). Note records what was paid so far.
 *  - Old "rescheduled"→ `cancelled`, reason "Rescheduled on the old site".
 *                        The moved-to booking is named when the two share an
 *                        order. Cancelled bookings don't block seats.
 *  - Old "cancelled"  → `cancelled`.
 *  - Old "pending payment" is a WooCommerce order nobody finished paying.
 *    With nothing paid → `cancelled`, reason "Not paid on the old site", so
 *    it holds no seats and gets no reminders. With money paid → handled
 *    like "reserved". The dry run lists the upcoming ones to check by hand.
 *  - Tours map to the new slot by start time; whole-day and sunset by name.
 *    Sunset tours go on the sunset cruise (private), so they hold the boat
 *    at sundown, not at 3:30. That holds out of the cruise's season too
 *    (Nov 15 – Mar 31): it isn't sold online then, but a booking on it
 *    still has the boat at its real time and keeps any departure it
 *    overlaps off sale. Sunset, eco and older 3-hour tours keep their old
 *    name.
 *  - Every imported booking is marked as already having had its post-tour
 *    follow-up, so the daily follow-up job never emails old customers.
 *  - No Stripe payment intent is set. Refunds for these bookings must be
 *    issued in Stripe directly, not through the new admin.
 *
 * Re-runs: by default, existing `legacy-*` docs are skipped. With
 * `--update-existing`, the old-site fields (status, date, tour, customer,
 * amounts, `legacy`) are refreshed; the access token, createdAt, admin notes
 * and follow-up markers are left alone. Money owed back by hand is capped
 * at what the CSV leaves unrefunded, and a booking the re-sync puts back
 * or moves loses any closure (see resyncFields). With `--dry-run` as well,
 * it reads the existing docs (and writes nothing) to list the ones whose
 * status, departure or money owed back it would change (resyncChanges).
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import {
  initializeApp,
  cert,
  applicationDefault,
  getApps,
} from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

import { tours } from '../src/lib/tours';
import { slotConflicts, slotRunsOn, slotStartTime } from '../src/lib/schedule';
import { BOAT_CAPACITY } from '../src/lib/availability';
import type {
  BookingStatus,
  PaymentStatus,
  TourTimeSlot,
  TourType,
} from '../src/lib/firebase/types';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const dryRun = flags.has('--dry-run');
const updateExisting = flags.has('--update-existing');
const useEmulator = flags.has('--emulator') || !!process.env.FIRESTORE_EMULATOR_HOST;

function argValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

const fileArg = argValue('--file');
const previewOut = argValue('--preview');

// ---------------------------------------------------------------------------
// Env + Firebase Admin (mirrors scripts/seed.ts)
// ---------------------------------------------------------------------------

const root = path.resolve(__dirname, '..');
loadEnv({ path: path.join(root, '.env.local') });
loadEnv({ path: path.join(root, '.env') });

if (useEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
}

function initAdmin() {
  if (getApps().length > 0) return;

  if (useEmulator) {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_ADMIN_PROJECT_ID ||
      'demo-crystal-river';
    initializeApp({ projectId });
    console.log(`→ Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`);
    return;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
    console.log(`→ Authenticated with service account for ${projectId}`);
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!fs.existsSync(credPath)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${credPath}`);
    }
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    console.log(`→ Authenticated via GOOGLE_APPLICATION_CREDENTIALS (${credPath})`);
    return;
  }

  throw new Error(
    [
      'Could not initialize Firebase Admin SDK.',
      'Set one of the following in .env.local:',
      '  - FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY',
      '  - GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json',
      'Or pass --emulator to write to a local emulator (FIRESTORE_EMULATOR_HOST=localhost:8080).',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180: quoted fields, doubled quotes, CRLF, UTF-8 BOM)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const REQUIRED_COLUMNS = [
  'booking_id',
  'booking_status',
  'tour',
  'tour_date',
  'start_time',
  'persons',
  'customer_name',
  'email',
  'phone',
  'order_ids',
  'amount_paid',
  'refunded',
];

// ---------------------------------------------------------------------------
// Time helpers (America/New_York)
// ---------------------------------------------------------------------------

const TZ = 'America/New_York';

function todayInEt(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function tzOffsetMs(utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** `2026-10-13T11:08:08` or `2026-10-13` + `08:00`, read as Eastern time. */
function etToDate(dateIso: string, time = '00:00:00'): Date | null {
  const m = `${dateIso}T${time}`.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let utc = guess - tzOffsetMs(guess);
  utc = guess - tzOffsetMs(utc);
  return new Date(utc);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const STANDARD_TOUR = /^(2hr (early|morning|midday|afternoon) tour|whole day tour)\s*-\s*(shared|private)$/i;

function toCents(v: string): number {
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function slotFor(tourName: string, startTime: string): TourTimeSlot | null {
  if (/whole\s*day/i.test(tourName)) return 'whole-day';
  // By name, not start time: a 5 PM sunset tour would otherwise land on the
  // late-afternoon slot, show as 3:30 and leave the evening's sunset slot open.
  // Out of the cruise's season too: the calendar still counts a booked
  // sunset cruise against the departures it overlaps (slotConflicts), and
  // the booking keeps its sunset time and cruise wording.
  if (/sunset/i.test(tourName)) return 'sunset';
  const m = startTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mins = +m[1] * 60 + +m[2];
  if (mins < 10 * 60) return 'morning';
  if (mins < 12 * 60) return 'mid-morning';
  if (mins < 15 * 60) return 'early-afternoon';
  return 'late-afternoon';
}

export interface MappedBooking {
  id: string;
  data: Record<string, unknown>;
  /** Fields refreshed on `--update-existing`. */
  syncFields: Record<string, unknown>;
  summary: {
    oldStatus: string;
    status: BookingStatus;
    tourId: string;
    standardTour: boolean;
    upcoming: boolean;
    unknownPartySize: boolean;
  };
}

export interface MapResult {
  mapped: MappedBooking[];
  skipped: { bookingId: string; reason: string }[];
}

export function mapRows(rows: Record<string, string>[], today: string, importedAt: Timestamp): MapResult {
  const mapped: MappedBooking[] = [];
  const skipped: { bookingId: string; reason: string }[] = [];

  // order id → booking ids, to find where a rescheduled booking moved to.
  const bookingsByOrder = new Map<string, string[]>();
  for (const r of rows) {
    for (const oid of (r.order_ids || '').split(';').map((s) => s.trim()).filter(Boolean)) {
      bookingsByOrder.set(oid, [...(bookingsByOrder.get(oid) ?? []), r.booking_id]);
    }
  }
  const statusById = new Map(rows.map((r) => [r.booking_id, (r.booking_status || '').toLowerCase()]));

  for (const r of rows) {
    const bookingId = (r.booking_id || '').trim();
    if (!/^\d+$/.test(bookingId)) {
      skipped.push({ bookingId: bookingId || '(blank)', reason: 'missing booking number' });
      continue;
    }
    const date = r.tour_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped.push({ bookingId, reason: `unreadable tour date "${date}"` });
      continue;
    }

    const oldTour = r.tour || '';
    const startTime = r.start_time || '';
    const timeSlot = slotFor(oldTour, startTime);
    if (!timeSlot) {
      skipped.push({ bookingId, reason: `unreadable start time "${startTime}"` });
      continue;
    }
    // The whole-day charter and the sunset cruise only run private.
    const privateOnly = timeSlot === 'whole-day' || timeSlot === 'sunset';
    const type: TourType = privateOnly || /private/i.test(oldTour) ? 'private' : 'shared';
    const tourId = `${timeSlot}-${type}`;
    const newTour = tours.find((t) => t.slug === tourId);
    if (!newTour) {
      skipped.push({ bookingId, reason: `no tour "${tourId}" in the new catalog` });
      continue;
    }
    const standardTour = STANDARD_TOUR.test(oldTour.trim());
    const tourName = standardTour ? newTour.name : oldTour;

    // ---- Status ---------------------------------------------------------
    const oldStatus = (r.booking_status || '').toLowerCase().trim();
    const upcoming = date >= today;
    const paidCents = toCents(r.amount_paid);
    const refundedCents = toCents(r.refunded);
    let status: BookingStatus;
    let cancellationReason: string | null = null;
    const notes: string[] = [`Imported from the old website (booking #${bookingId}).`];

    switch (oldStatus) {
      case 'confirmed':
        status = upcoming ? 'confirmed' : 'completed';
        break;
      case 'reserved':
        status = 'pending-payment';
        notes.push(
          `Reserved on the old site; $${(paidCents / 100).toFixed(2)} paid so far. Collect any balance outside the new site.`,
        );
        break;
      case 'rescheduled': {
        status = 'cancelled';
        const orderIds = (r.order_ids || '').split(';').map((s) => s.trim()).filter(Boolean);
        const movedTo = [
          ...new Set(
            orderIds
              .flatMap((oid) => bookingsByOrder.get(oid) ?? [])
              .filter((b) => b !== bookingId && statusById.get(b) !== 'rescheduled'),
          ),
        ];
        cancellationReason = movedTo.length
          ? `Rescheduled on the old site (moved to booking #${movedTo.join(', #')})`
          : 'Rescheduled on the old site';
        break;
      }
      case 'cancelled':
        status = 'cancelled';
        cancellationReason = 'Cancelled on the old site';
        break;
      case 'pending payment':
      case 'pending-payment':
        // An order nobody paid is an abandoned checkout, not a hold. One
        // with money paid (a deposit, or part of the price) is a reservation.
        if (paidCents - refundedCents <= 0) {
          status = 'cancelled';
          cancellationReason = paidCents > 0 ? 'Paid and refunded on the old site' : 'Not paid on the old site';
        } else {
          status = 'pending-payment';
          notes.push(
            `Pending payment on the old site; $${(paidCents / 100).toFixed(2)} paid so far. Collect any balance outside the new site.`,
          );
        }
        break;
      default:
        skipped.push({ bookingId, reason: `unknown old status "${r.booking_status}"` });
        continue;
    }

    let paymentStatus: PaymentStatus;
    if (paidCents <= 0) paymentStatus = 'pending';
    else if (refundedCents >= paidCents) paymentStatus = 'refunded';
    else if (refundedCents > 0) paymentStatus = 'partial-refund';
    else paymentStatus = 'paid';

    // ---- Party size -------------------------------------------------------
    const persons = parseInt(r.persons, 10);
    const unknownPartySize = !Number.isFinite(persons) || persons < 1;
    const guestCount = unknownPartySize ? 0 : persons;
    if (unknownPartySize) notes.push('Party size was not recorded on the old site.');
    if (r.customer_note) notes.push(`Customer note: ${r.customer_note}`);

    // ---- Timestamps -------------------------------------------------------
    const bookedOn = r.booked_on ? etToDate(r.booked_on.slice(0, 10), r.booked_on.slice(11, 19) || '00:00:00') : null;
    const fallback = etToDate(date, startTime) ?? new Date();
    const createdAt = Timestamp.fromDate(bookedOn ?? fallback);

    const legacy = {
      source: 'wordpress-charter-bookings',
      bookingId: Number(bookingId),
      oldStatus,
      tourName: oldTour,
      startTime,
      endTime: r.end_time || null,
      location: r.location || null,
      persons: r.persons || null,
      orderIds: r.order_ids || null,
      orderStatuses: r.order_statuses || null,
      couponCodes: r.coupon_codes || null,
      paymentMethod: r.payment_method || null,
      stripeTransactionIds: r.stripe_transaction_ids || null,
      netPaidCents: paidCents - refundedCents,
      bookedOn: r.booked_on || null,
      billing: {
        city: r.city || null,
        state: r.state || null,
        zip: r.zip || null,
        country: r.country || null,
      },
      importedAt,
    };

    const syncFields: Record<string, unknown> = {
      tourId,
      tourName,
      date,
      timeSlot,
      type,
      guestCount,
      customerName: r.customer_name || '',
      customerEmail: (r.email || '').toLowerCase(),
      customerPhone: r.phone || '',
      status,
      amountPaidCents: paidCents,
      amountRefundedCents: refundedCents,
      paymentStatus,
      cancellationReason,
      // The old export has no cancellation date; leave it empty rather than guess.
      cancelledAt: null,
      cancelledBy: status === 'cancelled' ? 'admin' : null,
      // A re-sync that puts back a booking cancelled in the new admin drops
      // what that cancel recorded, or the money owed back by hand would
      // come off a live booking's takings. Still cancelled, it's still owed,
      // up to what the CSV leaves unrefunded (resyncFields).
      ...(status !== 'cancelled' && {
        manualRefundCents: null,
        manualRefundedAt: null,
        cancellationReasonPrivate: null,
        cancelledByClosure: null,
        closureRefundCents: null,
      }),
      legacy,
      updatedAt: importedAt,
    };

    const data: Record<string, unknown> = {
      id: `legacy-${bookingId}`,
      ...syncFields,
      emergencyContactName: '',
      emergencyContactPhone: '',
      guests: [],
      manateeMannersAcknowledged: false,
      manateeMannersAcknowledgedAt: null,
      liabilityWaiverSigned: false,
      liabilityWaiverSignedAt: null,
      adminNotes: notes.join('\n'),
      accessToken: randomUUID(),
      // Suppress the day-after follow-up email (functions/src/postTourFollowup.ts).
      postTourFollowupSentAt: importedAt,
      postTourFollowupMessageId: 'legacy-import',
      createdAt,
    };

    mapped.push({
      id: `legacy-${bookingId}`,
      data,
      syncFields,
      summary: { oldStatus, status, tourId, standardTour, upcoming, unknownPartySize },
    });
  }

  return { mapped, skipped };
}

/**
 * What `--update-existing` writes over a doc imported before, given what it
 * holds now: the CSV's fields, squared with what the new admin did to it
 * meanwhile.
 *  - Cancelled in both, the money owed back by hand can't be more than the
 *    CSV says is still unrefunded. A refund Travis gave on the old site
 *    comes in as amountRefundedCents, and owing it by hand as well would
 *    take it off the takings twice.
 *  - Cancelled in the new admin and put back by the CSV, or moved to
 *    another departure on the old site, it loses its closure. Otherwise it
 *    would wait on the customer again, and be cancelled and emailed again.
 */
export function resyncFields(m: MappedBooking, current: Record<string, unknown>): Record<string, unknown> {
  const fields = { ...m.syncFields };
  if (fields.status === 'cancelled') {
    const unrefunded = Math.max(0, (fields.amountPaidCents as number) - (fields.amountRefundedCents as number));
    const byHand = typeof current.manualRefundCents === 'number' ? current.manualRefundCents : 0;
    if (byHand > unrefunded) fields.manualRefundCents = unrefunded > 0 ? unrefunded : null;
  }
  const putBack = current.status === 'cancelled' && fields.status !== 'cancelled';
  const moved = current.date !== fields.date || current.timeSlot !== fields.timeSlot;
  if (current.closure && (putBack || moved)) fields.closure = FieldValue.delete();
  return fields;
}

/**
 * What the re-sync changes on a doc imported before, beyond refreshing it:
 * its status, its departure, or the money owed back by hand. Mostly that's
 * the old site catching up, but it's also how a cancel or a move made in
 * the new admin, and not on the old site, gets undone, so the dry run lists
 * these to check first. One short phrase per change, no customer details.
 */
export function resyncChanges(m: MappedBooking, current: Record<string, unknown>): string[] {
  const fields = resyncFields(m, current);
  const out: string[] = [];
  const labels = { status: 'status', date: 'date', timeSlot: 'slot', tourId: 'tour' } as const;
  for (const [key, label] of Object.entries(labels)) {
    if (fields[key] !== current[key]) out.push(`${label} ${String(current[key] ?? '(none)')} → ${String(fields[key])}`);
  }
  // Left out of the fields, what the new admin recorded stands.
  const owed = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  const dollars = (v: number | null) => (v === null ? 'none' : `$${(v / 100).toFixed(2)}`);
  if ('manualRefundCents' in fields && owed(fields.manualRefundCents) !== owed(current.manualRefundCents)) {
    out.push(`owed back by hand ${dollars(owed(current.manualRefundCents))} → ${dollars(owed(fields.manualRefundCents))}`);
  }
  if (current.manualRefundedAt && fields.manualRefundedAt === null) out.push('Refunded by hand → cleared');
  return out;
}

// ---------------------------------------------------------------------------
// Report (counts only; no customer details are printed)
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1;
  return out;
}

function printTable(title: string, counts: Record<string, number>) {
  console.log(`\n${title}`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}

/**
 * Upcoming imports the new calendar wouldn't have let book together, by its
 * own rules (src/lib/availability.ts): a private tour has its departure to
 * itself, shared seats stop at the boat's capacity (an unknown party size
 * fills it), the whole-day charter needs the day otherwise empty, and two
 * departures that overlap (the sunset cruise and the 3:30, late in the
 * season) can't both go. One line per clash.
 */
export function seatConflicts(holding: MappedBooking[]): string[] {
  const slotOf = (m: MappedBooking) => m.data.timeSlot as TourTimeSlot;
  const ids = (ms: MappedBooking[]) => ms.map((m) => m.id).join(', ');
  const byDate = new Map<string, MappedBooking[]>();
  for (const m of holding) byDate.set(String(m.data.date), [...(byDate.get(String(m.data.date)) ?? []), m]);

  const out: string[] = [];
  for (const [date, ms] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ms.length > 1 && ms.some((m) => slotOf(m) === 'whole-day')) {
      out.push(`${date}: whole-day charter plus other bookings that day: ${ids(ms)}`);
      continue;
    }
    const slots = [...new Set(ms.map(slotOf))];
    for (const slot of slots) {
      const inSlot = ms.filter((m) => slotOf(m) === slot);
      if (inSlot.length > 1 && inSlot.some((m) => m.data.type === 'private')) {
        out.push(`${date} ${slot}: private tour plus another booking: ${ids(inSlot)}`);
      }
      const seats = inSlot
        .filter((m) => m.data.type === 'shared')
        .reduce((sum, m) => sum + ((m.data.guestCount as number) >= 1 ? (m.data.guestCount as number) : BOAT_CAPACITY), 0);
      if (seats > BOAT_CAPACITY) {
        out.push(`${date} ${slot}: ${seats} shared seats on a ${BOAT_CAPACITY}-seat boat: ${ids(inSlot)}`);
      }
      // slotConflicts goes both ways; report each pair once.
      for (const other of slotConflicts(slot, date).filter((o) => slots.includes(o) && slot < o)) {
        out.push(`${date}: ${slot} and ${other} overlap: ${ids(ms.filter((m) => [slot, other].includes(slotOf(m))))}`);
      }
    }
  }
  return out;
}

function report(result: MapResult, totalRows: number, today: string) {
  const { mapped, skipped } = result;
  console.log(`\nRead ${totalRows} rows. Mapped ${mapped.length}, skipped ${skipped.length}. Today (ET): ${today}`);
  printTable('Old status → new status', countBy(mapped, (m) => `${m.summary.oldStatus} → ${m.summary.status}`));
  printTable('New tour', countBy(mapped, (m) => m.summary.tourId + (m.summary.standardTour ? '' : '  (old name kept)')));

  const byDate = (a: MappedBooking, b: MappedBooking) => String(a.data.date).localeCompare(String(b.data.date));
  const legacyOf = (m: MappedBooking) => m.data.legacy as { startTime: string; orderStatuses: string | null };

  const upcoming = mapped.filter((m) => m.summary.upcoming && ['confirmed', 'pending-payment'].includes(m.summary.status));
  console.log(`\nUpcoming bookings that will hold seats on the new calendar: ${upcoming.length}`);
  for (const m of upcoming.sort(byDate)) {
    // A sunset tour's departure is worked out from the sun now; show it
    // beside the old site's time so a big gap gets a call to the customer.
    const date = String(m.data.date);
    const slot = m.data.timeSlot as TourTimeSlot;
    const sunset =
      slot === 'sunset'
        ? `  old site ${legacyOf(m).startTime}, sunset cruise leaves ${slotStartTime('sunset', date)}${slotRunsOn('sunset', date) ? '' : ' (out of season)'}`
        : '';
    console.log(`  ${date}  ${slot.padEnd(16)} ${m.summary.status.padEnd(16)} ${m.id}${sunset}`);
  }

  const conflicts = seatConflicts(upcoming);
  if (conflicts.length) {
    console.log('\n⚠ Bookings the new calendar wouldn’t allow together (check these by hand):');
    for (const line of conflicts) console.log(`  ${line}`);
  }

  // Old "pending payment" orders: unpaid ones are now cancelled, paid ones
  // reservations. The order status says what WooCommerce last knew.
  const pending = mapped.filter((m) => m.summary.upcoming && /^pending[ -]payment$/.test(m.summary.oldStatus));
  if (pending.length) {
    console.log(`\nUpcoming old-site "pending payment" orders (check against the old site before the launch re-sync): ${pending.length}`);
    for (const m of pending.sort(byDate)) {
      const paid = `$${((m.data.amountPaidCents as number) / 100).toFixed(2)} paid`;
      const order = legacyOf(m).orderStatuses ? `  order: ${legacyOf(m).orderStatuses}` : '';
      console.log(`  ${m.data.date}  ${String(m.data.timeSlot).padEnd(16)} ${m.summary.status.padEnd(16)} ${paid.padEnd(14)} ${m.id}${order}`);
    }
  }

  const money = mapped.reduce((s, m) => s + (m.data.amountPaidCents as number), 0);
  const refunds = mapped.reduce((s, m) => s + (m.data.amountRefundedCents as number), 0);
  console.log(`\nPayments carried over: $${(money / 100).toFixed(2)} paid, $${(refunds / 100).toFixed(2)} refunded.`);
  console.log(`Party size unknown (guestCount 0): ${mapped.filter((m) => m.summary.unknownPartySize).length}`);

  if (skipped.length) {
    console.log('\nSkipped rows:');
    for (const s of skipped) console.log(`  #${s.bookingId}: ${s.reason}`);
  }
}

/** The existing docs `--update-existing` changes (resyncChanges), by tour date, ids only. */
function reportResync(mapped: MappedBooking[], existing: Map<string, Record<string, unknown>>) {
  const lines = mapped
    .map((m) => ({ m, changes: existing.has(m.id) ? resyncChanges(m, existing.get(m.id)!) : [] }))
    .filter(({ changes }) => changes.length > 0)
    .sort((a, b) => String(a.m.data.date).localeCompare(String(b.m.data.date)));
  console.log(`\nExisting bookings whose status, departure or money owed back the re-sync ${dryRun ? 'would change' : 'changes'}: ${lines.length}`);
  for (const { m, changes } of lines) console.log(`  ${m.id}  ${changes.join('; ')}`);
  if (dryRun && lines.length) {
    console.log('A cancel or move made in the new admin but not on the old site is undone by this. Make it on the old site, then export again.');
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  if (!fileArg) {
    throw new Error('Pass the bookings CSV: npm run import:legacy -- --file ~/Downloads/CRMF_bookings_2023-2026.csv --dry-run');
  }
  const file = path.resolve(fileArg.replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(file)) throw new Error(`CSV not found: ${file}`);
  if (path.resolve(file).startsWith(root + path.sep)) {
    console.warn('⚠ The CSV is inside the repo. Move it out so customer data never gets committed.');
  }

  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in (rows[0] ?? {})));
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.join(', ')}`);

  const today = todayInEt();
  const importedAt = Timestamp.now();
  const result = mapRows(rows, today, importedAt);
  report(result, rows.length, today);

  if (previewOut) {
    fs.writeFileSync(previewOut, JSON.stringify(result.mapped.map((m) => m.data), null, 2));
    console.log(`\nPreview of the documents written to ${previewOut} (contains customer data — delete when done).`);
  }

  // A plain dry run needs no sign-in. With --update-existing it reads the
  // docs the re-sync would change (reads only), to list what it would undo.
  if (dryRun && !updateExisting) {
    console.log('\n(dry-run) Nothing was written. Firebase Admin was not initialized.');
    return;
  }

  initAdmin();
  const db = getFirestore();
  const col = db.collection('bookings');

  // Find which legacy docs already exist, and what they hold (getAll in chunks).
  const existing = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < result.mapped.length; i += 300) {
    const refs = result.mapped.slice(i, i + 300).map((m) => col.doc(m.id));
    const snaps = await db.getAll(...refs);
    snaps.filter((s) => s.exists).forEach((s) => existing.set(s.id, s.data()!));
  }

  if (updateExisting) reportResync(result.mapped, existing);
  if (dryRun) {
    const toCreate = result.mapped.filter((m) => !existing.has(m.id)).length;
    console.log(`\n(dry-run) Nothing was written. It would create ${toCreate} and update ${existing.size}.`);
    return;
  }

  let created = 0;
  let updated = 0;
  let skippedExisting = 0;
  const writer = db.bulkWriter();
  writer.onWriteError((err) => {
    console.error(`  ✗ ${err.documentRef.id}: ${err.message}`);
    return err.failedAttempts < 3;
  });

  for (const m of result.mapped) {
    const ref = col.doc(m.id);
    const current = existing.get(m.id);
    if (!current) {
      writer.create(ref, m.data);
      created++;
    } else if (updateExisting) {
      writer.set(ref, resyncFields(m, current), { merge: true });
      updated++;
    } else {
      skippedExisting++;
    }
  }
  await writer.close();

  console.log(
    `\n✓ Done. Created ${created}, updated ${updated}, left ${skippedExisting} existing untouched` +
      (skippedExisting && !updateExisting ? ' (re-run with --update-existing to refresh them)' : '') +
      '.',
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error('\n✗ Import failed:');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
