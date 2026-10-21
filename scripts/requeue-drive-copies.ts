/**
 * One-off, after the functions deploy that stopped counting Google sign-in
 * failures as Drive copy tries: puts back in the queue the trip photos the
 * old functions gave up copying to Drive for that reason.
 *
 * The old functions counted every failed copy as one of a file's 5 tries,
 * including those Google wouldn't sign the site in for (access removed,
 * token expired) and those Drive turned away for the whole account (it was
 * full). Files uploaded while that lasted used up their tries within about
 * 5 hours, and `retryDriveCopies` never picks them up again: Trip photos
 * says "Drive copy failed (gave up)". The new functions wait on those
 * failures instead (DriveAuthError and DriveRefusedError in
 * functions/src/lib/google-drive.ts).
 *
 * Usage:
 *   npm run requeue:drive-copies                 # dry run: lists what it would put back
 *   npm run requeue:drive-copies -- --apply      # writes it
 *   npm run requeue:drive-copies -- --emulator   # local emulator
 *
 * Credentials: same as `npm run seed` (service-account vars in .env.local,
 * or GOOGLE_APPLICATION_CREDENTIALS). It reads with the `retryDriveCopies`
 * index, so run it once the deploy's indexes have built.
 *
 * It only sets the file's tries back to 0. The hourly retry then copies it
 * once Drive takes files again (Admin → Settings says whether it does). A
 * file given up on for a failure of its own stays given up on. Safe to
 * re-run. Prints trip ids and counts only.
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
import { getFirestore } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');

// ---------------------------------------------------------------------------
// Which files (pure, tested in test/requeue-drive-copies.test.ts)
// ---------------------------------------------------------------------------

/** MAX_DRIVE_ATTEMPTS in functions/src/tripPhotos.ts: the retry skips a file with this many tries. */
export const MAX_DRIVE_ATTEMPTS = 5;

/** A trip file's `drive` field (TripFileDoc in functions/src/tripPhotos.ts). */
export interface DriveState {
  status?: string;
  attempts?: number;
  error?: string | null;
}

/**
 * The old functions' wording for a failure the new ones wait on: Google's
 * sign-in refusing the token, a 401 from Drive (signed out), or Drive
 * refusing the whole account (ACCOUNT_REFUSALS in google-drive.ts).
 */
const WAITS_NOW =
  /^Google token refresh failed|failed \(401\)|storageQuotaExceeded|storage quota has been exceeded|accessNotConfigured|SERVICE_DISABLED|domainPolicy/i;

/** Given up on (no more tries), whatever the reason. */
function gaveUp(drive: DriveState | undefined): boolean {
  return drive?.status === 'failed' && (drive.attempts ?? 0) >= MAX_DRIVE_ATTEMPTS;
}

/** Given up on for a failure that wasn't the file's own, so it goes back in the queue. */
export function shouldRequeue(drive: DriveState | undefined): boolean {
  return gaveUp(drive) && WAITS_NOW.test(drive?.error ?? '');
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

async function run() {
  initAdmin();
  const db = getFirestore();

  // The same collection group and index as retryDriveCopies.
  const given = await db
    .collectionGroup('files')
    .where('drive.status', '==', 'failed')
    .where('drive.attempts', '>=', MAX_DRIVE_ATTEMPTS)
    .get();
  const todo = given.docs.filter((d) => shouldRequeue(d.get('drive') as DriveState | undefined));

  console.log(`\n${given.size} trip photos given up on for Drive; ${todo.length} of them because Drive wasn't taking files.`);
  if (given.size > todo.length) {
    console.log(`  ${given.size - todo.length} failed for reasons of their own (Admin → Trip photos), and stay as they are.`);
  }
  if (todo.length === 0) {
    console.log('Nothing to put back.');
    return;
  }
  const byTrip = new Map<string, number>();
  for (const d of todo) {
    const trip = d.ref.parent.parent?.id ?? '?';
    byTrip.set(trip, (byTrip.get(trip) ?? 0) + 1);
  }
  console.log(`${apply ? 'Putting back' : 'Would put back'}:`);
  for (const [trip, n] of [...byTrip].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${trip}: ${n}`);

  if (!apply) {
    console.log('\n(dry run) Nothing was written. Run again with --apply to put them back in the queue.');
    return;
  }

  let written = 0;
  let failed = 0;
  for (const d of todo) {
    try {
      // Only if nothing has touched the file since it was read (deleted, say).
      await d.ref.update({ 'drive.attempts': 0 }, { lastUpdateTime: d.updateTime });
      written++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${d.ref.path}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(
    `\n✓ Done. Put back ${written}` +
      (failed ? `, ${failed} not written (run again to pick them up)` : '') +
      '. retryDriveCopies copies them within the hour once Drive takes files (Admin → Settings says whether it does).',
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error('\n✗ Requeue failed:');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
