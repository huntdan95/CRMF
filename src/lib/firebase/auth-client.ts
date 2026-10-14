'use client';

import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  getRedirectResult,
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

/** Returns the current admin's freshly-issued ID token, or throws. */
export async function getAdminIdToken(forceRefresh = false): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('Not signed in.');
  return user.getIdToken(forceRefresh);
}
