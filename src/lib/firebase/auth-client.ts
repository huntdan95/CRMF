'use client';

import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './client';

/**
 * Starts Firebase Auth before the sign-in button is tapped. On Safari and
 * phones the SDK must load a helper frame before it can open the Google
 * window. If that load happens after the tap, Safari no longer treats the
 * window as opened by the tap and blocks it (`auth/popup-blocked`). Resolves
 * once the frame has loaded or failed.
 */
export async function prepareGoogleSignIn(): Promise<void> {
  await getFirebaseAuth().authStateReady();
}

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

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(getFirebaseAuth(), provider);
  return user;
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
