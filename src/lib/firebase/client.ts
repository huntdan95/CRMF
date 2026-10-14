import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

/**
 * Google sign-in runs Firebase's helper pages (`/__/auth/*`) on the auth
 * domain. On a live https site that's the site's own host, and
 * next.config.ts proxies those paths to Firebase. With the default
 * `<project>.firebaseapp.com` the helper is a different site, and Safari,
 * home-screen apps and newer Chrome withhold its storage, so sign-in fails
 * with "missing initial state". Firebase only loads the helper over https,
 * so local `next dev` (plain http) and the server keep the configured
 * domain.
 */
function authDomain(): string | undefined {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return window.location.host;
  }
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: authDomain(),
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
 * Pages whose URL holds a booking's access token (`?t=`, which can read
 * and cancel the booking) or a Stripe session id. Analytics reports the
 * full page URL, so it never starts on these: the token would sit in the
 * Analytics property for anyone with access to read.
 */
function carriesSecret(loc: Location): boolean {
  const params = new URLSearchParams(loc.search);
  return (
    params.has('t') ||
    params.has('session_id') ||
    loc.pathname.startsWith('/my-booking') ||
    loc.pathname.startsWith('/book/confirmation')
  );
}

/**
 * Browser-only Firebase Analytics init. Returns `null` on the server, in
 * unsupported browsers, when `measurementId` isn't configured, or on a
 * page whose URL carries a booking token.
 */
export async function initAnalyticsIfSupported() {
  if (typeof window === 'undefined') return null;
  if (!firebaseConfig.measurementId) return null;
  if (carriesSecret(window.location)) return null;
  const { getAnalytics, isSupported } = await import('firebase/analytics');
  if (!(await isSupported())) return null;
  return getAnalytics(getFirebaseApp());
}
