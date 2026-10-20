'use client';

import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseApp, getFirebaseAuth } from './client';

/** Plain-English text for a failed sign-in, written for a non-technical reader. */
export function signInErrorMessage(err: unknown): string {
  if (!(err instanceof FirebaseError)) {
    return err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
  }
  switch (err.code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Tap “Continue with Google” again. If nothing opens, turn off “Block Pop-ups” in your browser’s settings and try once more.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/redirect-cancelled-by-user':
    case 'auth/user-cancelled':
      return 'The Google window closed before sign-in finished. Tap “Continue with Google” to try again.';
    case 'auth/network-request-failed':
      return 'Couldn’t reach Google. Check your Wi-Fi or phone signal, then try again.';
    case 'auth/web-storage-unsupported':
      return 'This browser is blocking something sign-in needs. This usually means Private Browsing is on. Open this page in a normal Safari or Chrome window and try again.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a few minutes, then try again.';
    default:
      return `Google sign-in didn’t work. Try again, and if it keeps happening, send a screenshot of this message to whoever looks after the website. (${err.code})`;
  }
}

/**
 * Sends the browser to Google's sign-in page in this tab; Google sends it
 * back to the current URL, where `finishGoogleSignIn()` picks up the result.
 * Staying in one tab works in home-screen apps and never trips a pop-up
 * blocker. It needs the helper pages on this site's host (see authDomain()
 * in ./client), so local `next dev` over plain http uses a pop-up window
 * instead and resolves with the user. Otherwise it never resolves.
 */
export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (getFirebaseApp().options.authDomain === window.location.host) {
    return signInWithRedirect(auth, provider);
  }
  const { user } = await signInWithPopup(auth, provider);
  return user;
}

/**
 * The user Google just sent back from `signInWithGoogle()`, or null when
 * this page load isn't a return from Google. Only the first call per page
 * load sees the user.
 *
 * Waiting for Firebase Auth to start also loads the helper frame that the
 * pop-up window needs. Call this before the sign-in button is tapped: if
 * the frame loads after the tap, Safari no longer treats the window as
 * opened by the tap and blocks it (`auth/popup-blocked`).
 */
export async function finishGoogleSignIn(): Promise<User | null> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
}

export async function adminSignOut(): Promise<void> {
  // Clear the httpOnly server cookie first…
  await fetch('/api/admin/session', { method: 'DELETE' });
  // …then clear the client-side Firebase session.
  await signOut(getFirebaseAuth());
}

/**
 * The admin session cookie let the page load, but this browser has no
 * Firebase sign-in and couldn't get one back from the session, so nothing
 * can be read or saved until Travis signs in again here.
 */
export class AdminSignedOutError extends Error {
  constructor() {
    super('This device isn’t signed in any more. Sign out, then sign back in.');
    this.name = 'AdminSignedOutError';
  }
}

/** When this tab last sent Travis back to sign in (see `signInAgain`). */
const SIGN_IN_AGAIN_AT = 'crmf-admin-sign-in-again-at';
const SIGN_IN_AGAIN_EVERY_MS = 10 * 60 * 1000;

let restoring: Promise<void> | null = null;

/**
 * Makes sure Firebase Auth is signed in on this device, which Firestore
 * reads and admin function calls need. Admin pages only load with a valid
 * session cookie, but the cookie and the Firebase sign-in are kept apart:
 * an iPhone copies Safari's cookies into the Home Screen app and leaves the
 * Firebase sign-in behind, and Safari can clear one without the other.
 * When the sign-in is missing, the server swaps the cookie for a Firebase
 * token; failing that, Travis is sent to sign in with Google once more.
 */
export async function ensureAdminFirebaseUser(): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  if (auth.currentUser) return;
  restoring ??= restoreFromSession().finally(() => {
    restoring = null;
  });
  return restoring;
}

async function restoreFromSession(): Promise<void> {
  const res = await fetch('/api/admin/session/firebase', { method: 'POST' }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { token?: string } | null) : null;
  if (body?.token) {
    try {
      await signInWithCustomToken(getFirebaseAuth(), body.token);
      return;
    } catch (err) {
      console.error('Firebase sign-in from the admin session failed', err);
    }
  }
  if (res === null) {
    throw new Error('Couldn’t reach the website. Check your Wi-Fi or phone signal, then reload the page.');
  }
  return signInAgain();
}

/**
 * Off to the sign-in page, back to this page after. At most once every 10
 * minutes per tab: a device that won't keep the sign-in gets the message
 * instead of bouncing to the sign-in page every time.
 */
function signInAgain(): Promise<never> {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(SIGN_IN_AGAIN_AT)) || 0;
  } catch {
    // Storage blocked: just send them.
  }
  if (Date.now() - last < SIGN_IN_AGAIN_EVERY_MS) {
    return Promise.reject(new AdminSignedOutError());
  }
  try {
    sessionStorage.setItem(SIGN_IN_AGAIN_AT, String(Date.now()));
  } catch {
    // As above.
  }
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/admin/login?next=${encodeURIComponent(next)}&reason=device`);
  // The page is going away; nothing waiting on this should carry on.
  return new Promise<never>(() => {});
}

/** Returns the current admin's freshly-issued ID token, or throws. */
export async function getAdminIdToken(forceRefresh = false): Promise<string> {
  await ensureAdminFirebaseUser();
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('Not signed in.');
  return user.getIdToken(forceRefresh);
}
