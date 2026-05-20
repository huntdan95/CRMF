import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  // measurementId is optional — only set if you want Analytics.
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const REQUIRED_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const;

function requireConfig(): typeof firebaseConfig {
  const missing = REQUIRED_KEYS.filter((k) => !firebaseConfig[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web config env vars: ${missing.map((k) => `NEXT_PUBLIC_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`).join(', ')}. ` +
        `Copy .env.local.example to .env.local and fill in the values from the Firebase console.`,
    );
  }
  return firebaseConfig;
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(requireConfig());
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getBucket(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}

/**
 * Browser-only Firebase Analytics init. Returns `null` on the server, in
 * unsupported browsers, or when `measurementId` isn't configured.
 */
export async function initAnalyticsIfSupported() {
  if (typeof window === 'undefined') return null;
  if (!firebaseConfig.measurementId) return null;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (!(await isSupported())) return null;
  return getAnalytics(getFirebaseApp());
}
