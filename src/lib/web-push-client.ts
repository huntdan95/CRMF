/*
 * Browser side of web push, shared by the crew app's and the admin app's
 * notification switches (src/components/crew/CrewNotifications.tsx,
 * src/components/admin/AdminNotifications.tsx).
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
  return (
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** VAPID keys are base64url; PushManager.subscribe wants the raw bytes. */
function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * True when `sub` was made with a different VAPID key than this build's. A
 * browser that doesn't report the key gets the benefit of the doubt.
 */
function madeWithOtherKey(sub: PushSubscription, key: Uint8Array): boolean {
  const existing = sub.options?.applicationServerKey;
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  return bytes.length !== key.length || bytes.some((b, i) => b !== key[i]);
}

/**
 * This device's subscription for the current VAPID key, made if needed. One
 * left over from an older key can't receive anything (the push service
 * rejects our signature), so it's dropped, server copy too (`forget`), and
 * replaced.
 */
export async function currentSubscription(
  reg: ServiceWorkerRegistration,
  existing: PushSubscription | null,
  forget: (endpoint: string) => Promise<void>,
): Promise<PushSubscription> {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY!);
  if (existing) {
    if (!madeWithOtherKey(existing, key)) return existing;
    await forget(existing.endpoint).catch(() => undefined);
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}
