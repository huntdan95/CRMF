import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';

/*
 * The Firebase app on its own, without Auth, Firestore or Storage, so the
 * analytics every page starts (src/lib/firebase/analytics.ts) doesn't ship
 * those to visitors. Admin and crew code gets them from ./client.
 */

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

export const firebaseConfig = {
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
