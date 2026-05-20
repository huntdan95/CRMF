'use client';

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from './client';

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
