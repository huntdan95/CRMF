/**
 * One-off, right after the deploy that added `manualRefundCents`: fills it
 * in on old-site bookings cancelled before that deploy.
 *
 * Until then, cancelling a booking paid on the old website left the money
 * owed back only in the private note ("… was paid on the old website.
 * Refund it by hand.") and the audit log. Without `manualRefundCents`,
 * Reports and the dashboard count that money as kept, the booking page has
 * no "Refunded by hand" button, and the customer's page says nothing was
 * refunded.
 *
 * Usage:
 *   npm run backfill:manual-refunds                 # dry run: lists what it would change
 *   npm run backfill:manual-refunds -- --apply      # writes it
 *   npm run backfill:manual-refunds -- --emulator   # local emulator
 *   npm run backfill:manual-refunds -- --apply --base https://crystalrivermanateefun.com
 *                                                   # admin links on the domain, once it has moved
 *
 * Credentials: same as `npm run seed` (service-account vars in .env.local,
 * or GOOGLE_APPLICATION_CREDENTIALS).
 *
 * What it changes, on cancelled bookings only (see backfillChange):
 *  - An old-site booking with money paid and not refunded, and either that
 *    note or a `booking.cancel` audit entry with money to refund by hand,
 *    gets `manualRefundCents` = paid − refunded.
 *  - A booking Travis cancelled without the email going out, with a reason
 *    he typed (the cancel dialog told him only he'd see it), gets
 *    `cancellationReasonPrivate`, so the customer's page leaves the reason
 *    off. The audit entry can't tell "don't email them" from an email that
 *    failed, so either way it's kept private: run this right after the
 *    deploy, before new cancellations pile up.
 *
 * Safe to re-run: a booking that already has the field is left alone, and a
 * booking changed between the read and the write isn't written (run again).
 * Prints booking ids and amounts only, no customer details.
 *
 * It can't tell which of that money Travis has already paid back: most of
 * it he will have, by hand, long ago. So once it has written, it lists every
 * booking still owed back by hand and not marked refunded, with its admin
 * link, for him to tap "Refunded by hand" on each one he's paid. Until he
 * does, the customer's page says he'll refund them and the admin lists the
 * money as owed. The links are on the App Hosting address unless `--base`
 * says otherwise: until the domain moves, crystalrivermanateefun.com is
 * still the WordPress site.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { config as loadEnv } from 'dotenv';
import {
  initializeApp,
  cert,
  applicationDefault,
  getApps,
} from 'firebase-admin/app';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');

/**
 * The admin site the "Refunded by hand" links open: App Hosting's own
 * address, which serves this site before and after the domain moves
 * (siteConfig.url is the domain, still WordPress until launch).
 */
export const DEFAULT_ADMIN_BASE = 'https://default--crmf-99aad.us-east4.hosted.app';

/** `--base <url>`, or the App Hosting address, without a trailing slash. */
export function adminBase(argv: readonly string[]): string {
  const i = argv.indexOf('--base');
  if (i < 0) return DEFAULT_ADMIN_BASE;
  const raw = argv[i + 1] ?? '';
  if (!/^https?:\/\/[^/\s]+/.test(raw)) throw new Error(`--base needs the site's address, like https://crystalrivermanateefun.com`);
  return raw.replace(/\/+$/, '');
}

export function adminBookingUrl(base: string, id: string): string {
  return `${base}/admin/bookings/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// What to change (pure, tested in test/backfill-manual-refunds.test.ts)
// ---------------------------------------------------------------------------

/** The booking fields the decision reads. */
export interface BackfillBooking {
  id: string;
  legacy?: unknown;
  status?: string;
  amountPaidCents?: number;
  amountRefundedCents?: number;
  manualRefundCents?: number;
  manualRefundedAt?: unknown;
  adminNotes?: string;
  cancellationReason?: string | null;
  cancellationReasonPrivate?: boolean;
}

/** A `booking.cancel` audit entry's payload (adminCancelBooking). */
export type CancelAuditPayload = Record<string, unknown>;

export interface BackfillChange {
  manualRefundCents?: number;
  cancellationReasonPrivate?: true;
}

/** The note adminCancelOne left on an old-site booking it cancelled. */
const REFUND_BY_HAND_NOTE = /was paid on the old website\. Refund it by hand\./;

function isLegacy(b: BackfillBooking): boolean {
  return !!b.legacy || b.id.startsWith('legacy-');
}

function cents(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * The fields to add to one booking, from it and its `booking.cancel` audit
 * entries, or null when there's nothing to do.
 *
 * Money owed back needs evidence that this site cancelled it with old-site
 * money still owed: a booking imported already cancelled (refunded, or
 * moved, on the old site) has neither the note nor an audit entry, and is
 * left alone.
 */
export function backfillChange(b: BackfillBooking, cancels: readonly CancelAuditPayload[]): BackfillChange | null {
  if (b.status !== 'cancelled') return null;
  const change: BackfillChange = {};

  const owed = cents(b.amountPaidCents) - cents(b.amountRefundedCents);
  const toldToRefund =
    REFUND_BY_HAND_NOTE.test(b.adminNotes ?? '') || cancels.some((p) => cents(p.manualRefundCents) > 0);
  if (isLegacy(b) && b.manualRefundCents == null && owed > 0 && toldToRefund) change.manualRefundCents = owed;

  const reason = (b.cancellationReason ?? '').trim();
  const privately = cancels.some(
    (p) => p.emailed === false && typeof p.reason === 'string' && p.reason.trim() !== '' && p.reason.trim() === reason,
  );
  if (b.cancellationReasonPrivate !== true && reason && privately) change.cancellationReasonPrivate = true;

  return Object.keys(change).length > 0 ? change : null;
}

/**
 * Old-site money still owed back by hand on a booking, with `change`
 * written (null if it wasn't): what "Refunded by hand" would record. 0 once
 * Travis has recorded it, or when nothing is owed.
 */
export function stillOwedByHand(b: BackfillBooking, change: BackfillChange | null): number {
  if (b.status !== 'cancelled' || b.manualRefundedAt) return 0;
  return cents(change?.manualRefundCents ?? b.manualRefundCents);
}

// ---------------------------------------------------------------------------
// Env + Firebase Admin (mirrors scripts/seed.ts)
// ---------------------------------------------------------------------------

const root = path.resolve(__dirname, '..');
loadEnv({ path: path.join(root, '.env.local') });
loadEnv({ path: path.join(root, '.env') });

// Only now: .env.local can set FIRESTORE_EMULATOR_HOST too, and the Admin
// SDK then goes to the emulator whatever this says.
const useEmulator = flags.has('--emulator') || !!process.env.FIRESTORE_EMULATOR_HOST;
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
    console.log(
      `→ Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})` +
        (flags.has('--emulator') ? '' : '. FIRESTORE_EMULATOR_HOST is set: unset it to reach the live project.'),
    );
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
      'Or pass --emulator to use a local emulator (FIRESTORE_EMULATOR_HOST=localhost:8080).',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function describeChange(id: string, b: BackfillBooking, c: BackfillChange): string {
  const parts: string[] = [];
  if (c.manualRefundCents != null) parts.push(`owed back by hand $${(c.manualRefundCents / 100).toFixed(2)}`);
  if (c.cancellationReasonPrivate) parts.push('reason made private (cancelled without an email)');
  return `  ${id}${isLegacy(b) ? '' : ' (booked on this site)'}: ${parts.join('; ')}`;
}

async function run() {
  // Before anything is written: a bad --base would only show at the end.
  const base = adminBase(process.argv.slice(2));
  initAdmin();
  const db = getFirestore();

  const [bookings, audits] = await Promise.all([
    db.collection('bookings').where('status', '==', 'cancelled').get(),
    db.collection('auditLog').where('action', '==', 'booking.cancel').get(),
  ]);
  const cancelsOf = new Map<string, CancelAuditPayload[]>();
  for (const a of audits.docs) {
    const { targetId, payload } = a.data() as { targetId?: string; payload?: CancelAuditPayload };
    if (!targetId) continue;
    cancelsOf.set(targetId, [...(cancelsOf.get(targetId) ?? []), payload ?? {}]);
  }

  const todo = bookings.docs.flatMap((doc) => {
    const b = { ...(doc.data() as Omit<BackfillBooking, 'id'>), id: doc.id };
    const change = backfillChange(b, cancelsOf.get(doc.id) ?? []);
    return change ? [{ doc, b, change }] : [];
  });

  console.log(`\nRead ${bookings.size} cancelled bookings and ${audits.size} cancel entries in the audit log.`);
  if (todo.length === 0) {
    console.log('Nothing to change.');
    listStillOwed(bookings.docs, new Map(), base);
    return;
  }
  console.log(`${apply ? 'Changing' : 'Would change'} ${todo.length}:`);
  for (const { doc, b, change } of todo) console.log(describeChange(doc.id, b, change));
  const owed = todo.reduce((s, t) => s + (t.change.manualRefundCents ?? 0), 0);
  if (owed > 0) console.log(`Money owed back by hand, in total: $${(owed / 100).toFixed(2)}`);

  if (!apply) {
    console.log(
      '\n(dry run) Nothing was written. Run again with --apply to write these. It then lists the bookings to tap ' +
        '“Refunded by hand” on, for the money Travis has already paid back.',
    );
    return;
  }

  const written = new Map<string, BackfillChange>();
  let failed = 0;
  for (const { doc, change } of todo) {
    try {
      // Only if nothing has touched the booking since it was read: one that
      // changed meanwhile is refused, and the next run decides afresh.
      await doc.ref.update({ ...change }, { lastUpdateTime: doc.updateTime });
      written.set(doc.id, change);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${doc.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n✓ Done. Wrote ${written.size}` + (failed ? `, ${failed} not written (run again to pick them up)` : '') + '.');
  listStillOwed(bookings.docs, written, base);
}

/**
 * Every cancelled booking still owed back by hand and not marked refunded,
 * with its admin link, counting what this run wrote and what an earlier run
 * did, so running it again lists them too.
 */
function listStillOwed(docs: QueryDocumentSnapshot[], written: ReadonlyMap<string, BackfillChange>, base: string) {
  const stillOwed = docs.flatMap((doc) => {
    const b = { ...(doc.data() as Omit<BackfillBooking, 'id'>), id: doc.id };
    const owed = stillOwedByHand(b, written.get(doc.id) ?? null);
    return owed > 0 ? [{ id: doc.id, owed }] : [];
  });
  if (stillOwed.length === 0) return;
  console.log(
    `\nStill owed back by hand, as far as the site knows (${stillOwed.length}). Open each one Travis has already ` +
      'paid back and tap “Refunded by hand”. Until then, the customer’s booking page says he’ll refund them, and ' +
      'the admin lists the money as owed.',
  );
  for (const { id, owed } of stillOwed) {
    console.log(`  ${id}  $${(owed / 100).toFixed(2)}  ${adminBookingUrl(base, id)}`);
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('\n✗ Backfill failed:');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
