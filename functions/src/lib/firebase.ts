/**
 * Firebase Admin SDK init for Cloud Functions.
 *
 * Cloud Functions automatically populate ADC, so no service-account key is
 * needed in this environment.
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();

export { FieldValue, Timestamp } from 'firebase-admin/firestore';
