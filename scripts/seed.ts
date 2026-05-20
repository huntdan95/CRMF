/**
 * Seed the Firestore `tours` collection from the marketing-side catalog.
 *
 * Usage:
 *   npm run seed                  # writes to the project in .env.local
 *   npm run seed -- --dry-run     # prints what would be written
 *   npm run seed -- --emulator    # forces use of the local Firestore emulator
 *
 * Credentials:
 *   Either set FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL +
 *   FIREBASE_ADMIN_PRIVATE_KEY in .env.local, OR point
 *   GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON file.
 *
 * Idempotent: docs are written with `set` keyed by `slug`, so re-running this
 * script overwrites a tour record with the latest definition. Bookings and
 * blackouts are untouched.
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

import { tours, toCanonicalTour } from '../src/lib/tours';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const useEmulator =
  args.has('--emulator') || !!process.env.FIRESTORE_EMULATOR_HOST;

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

// Load .env.local first (Next.js convention), then fall back to .env.
const root = path.resolve(__dirname, '..');
loadEnv({ path: path.join(root, '.env.local') });
loadEnv({ path: path.join(root, '.env') });

if (useEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
}

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------

function initAdmin() {
  if (getApps().length > 0) return;

  if (useEmulator) {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_ADMIN_PROJECT_ID ||
      'demo-crystal-river';
    initializeApp({ projectId });
    console.log(
      `→ Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
    );
    return;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
    console.log(`→ Authenticated with service account for ${projectId}`);
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!fs.existsSync(credPath)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${credPath}`,
      );
    }
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
    console.log(
      `→ Authenticated via GOOGLE_APPLICATION_CREDENTIALS (${credPath})`,
    );
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
// Run
// ---------------------------------------------------------------------------

async function run() {
  const docs = tours.map(toCanonicalTour);

  console.log(
    `\nSeeding ${docs.length} tour records to "tours" (mode: ${dryRun ? 'dry-run' : 'write'}).`,
  );

  for (const tour of docs) {
    const summary = `  · ${tour.slug.padEnd(22)} ${tour.startTime}  ${
      tour.type
    }${tour.type === 'shared' ? ` $${(tour.pricePerPerson ?? 0) / 100}/pp` : ` $${(tour.flatPrice ?? 0) / 100} flat`}`;
    console.log(summary);
  }

  if (dryRun) {
    console.log('\n(dry-run) Nothing was written. Firebase Admin was not initialized.');
    return;
  }

  initAdmin();
  const db = getFirestore();
  const collection = db.collection('tours');

  for (const tour of docs) {
    await collection.doc(tour.slug).set(tour, { merge: false });
  }

  console.log(`\n✓ Wrote ${docs.length} tours to Firestore.`);
}

run().catch((err) => {
  console.error('\n✗ Seed failed:');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
