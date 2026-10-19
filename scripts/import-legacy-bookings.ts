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
 *  - Old "pending payment" → `pending-payment`.
 *  - Tours map to the new slot by start time; whole-day and sunset by name.
 *    Sunset tours go on the sunset cruise (private), so they hold the boat
 *    at sundown, not at 3:30. Sunset, eco and older 3-hour tours keep their
 *    old name.
 *  - Every imported booking is marked as already having had its post-tour
 *    follow-up, so the daily follow-up job never emails old customers.
 *  - No Stripe payment intent is set. Refunds for these bookings must be
 *    issued in Stripe directly, not through the new admin.
 *
 * Re-runs: by default, existing `legacy-*` docs are skipped. With
 * `--update-existing`, the old-site fields (status, date, tour, customer,
 * amounts, `legacy`) are refreshed; the access token, createdAt, admin notes
 * and follow-up markers are left alone.
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
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { tours } from '../src/lib/tours';
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
        status = 'pending-payment';
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

function report(result: MapResult, totalRows: number, today: string) {
  const { mapped, skipped } = result;
  console.log(`\nRead ${totalRows} rows. Mapped ${mapped.length}, skipped ${skipped.length}. Today (ET): ${today}`);
  printTable('Old status → new status', countBy(mapped, (m) => `${m.summary.oldStatus} → ${m.summary.status}`));
  printTable('New tour', countBy(mapped, (m) => m.summary.tourId + (m.summary.standardTour ? '' : '  (old name kept)')));

  const upcoming = mapped.filter((m) => m.summary.upcoming && ['confirmed', 'pending-payment'].includes(m.summary.status));
  console.log(`\nUpcoming bookings that will hold seats on the new calendar: ${upcoming.length}`);
  for (const m of upcoming.sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)))) {
    console.log(`  ${m.data.date}  ${String(m.data.timeSlot).padEnd(16)} ${m.summary.status.padEnd(16)} ${m.id}`);
  }

  // Seat conflicts between upcoming imports (two privates in one slot, etc.).
  const bySlot = new Map<string, MappedBooking[]>();
  for (const m of upcoming) {
    const k = `${m.data.date} ${m.data.timeSlot}`;
    bySlot.set(k, [...(bySlot.get(k) ?? []), m]);
  }
  const conflicts = [...bySlot.entries()].filter(
    ([, ms]) => ms.length > 1 && ms.some((m) => m.data.type === 'private'),
  );
  if (conflicts.length) {
    console.log('\n⚠ Slots with a private tour plus another booking (check these by hand):');
    for (const [k, ms] of conflicts) console.log(`  ${k}: ${ms.map((m) => m.id).join(', ')}`);
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

  if (dryRun) {
    console.log('\n(dry-run) Nothing was written. Firebase Admin was not initialized.');
    return;
  }

  initAdmin();
  const db = getFirestore();
  const col = db.collection('bookings');

  // Find which legacy docs already exist (getAll in chunks).
  const existing = new Set<string>();
  for (let i = 0; i < result.mapped.length; i += 300) {
    const refs = result.mapped.slice(i, i + 300).map((m) => col.doc(m.id));
    const snaps = await db.getAll(...refs);
    snaps.filter((s) => s.exists).forEach((s) => existing.add(s.id));
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
    if (!existing.has(m.id)) {
      writer.create(ref, m.data);
      created++;
    } else if (updateExisting) {
      writer.set(ref, m.syncFields, { merge: true });
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
