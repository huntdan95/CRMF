'use client';

import { useEffect, useState } from 'react';
import { InstallHint, isIos, isStandalone } from './InstallHint';
import { clsx } from '@/lib/clsx';

type State =
  | 'loading'
  | 'install' // iPhone in Safari: has to be added to the home screen first
  | 'unsupported'
  | 'denied'
  | 'off'
  | 'on';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const SW_URL = '/crew-sw.js';
const SW_SCOPE = '/crew';

function pushSupported(): boolean {
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

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/api/crew/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  if (res.status === 401) {
    window.location.assign('/crew/login');
    return;
  }
  if (!res.ok) throw new Error(`Saving the subscription failed (${res.status})`);
}

/**
 * Turns booking notifications on or off for this phone, and sends a test.
 * The subscription is re-saved every time the app opens, so the server's
 * copy heals itself if it was ever dropped.
 */
export function CrewNotifications() {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) {
        setState(isIos() && !isStandalone() ? 'install' : 'unsupported');
        return;
      }
      try {
        await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === 'denied') {
          setState('denied');
        } else if (sub && Notification.permission === 'granted') {
          setState('on');
          await saveSubscription(sub).catch(() => undefined);
        } else {
          setState('off');
        }
      } catch {
        if (!cancelled) setState('unsupported');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setFlash(null);
    try {
      // First thing in the tap handler: iOS only shows the permission
      // prompt in direct response to a tap.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
        }));
      await saveSubscription(sub);
      setState('on');
      setFlash({ kind: 'ok', message: 'Notifications are on. Send yourself a test to be sure.' });
    } catch {
      setFlash({ kind: 'err', message: 'Couldn’t turn notifications on. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setFlash(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/crew/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setFlash({ kind: 'err', message: 'Couldn’t turn notifications off. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch('/api/crew/push/test', { method: 'POST' });
      if (res.status === 401) {
        window.location.assign('/crew/login');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setFlash({
        kind: 'ok',
        message:
          'Test sent. It takes a few seconds — go to your home screen to see it pop up.',
      });
    } catch {
      setFlash({ kind: 'err', message: 'Couldn’t send the test. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  }

  if (state === 'install') return <InstallHint />;

  return (
    <section
      aria-labelledby="crew-notifications"
      className="rounded-2xl border border-[var(--color-ink)]/8 bg-white p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="crew-notifications" className="font-semibold">
            Booking notifications
          </h2>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
            {state === 'loading' && 'Checking this phone…'}
            {state === 'on' && 'On for this phone. You’ll get a ping when a tour is booked.'}
            {state === 'off' && 'Get a ping on this phone whenever a tour is booked.'}
            {state === 'denied' &&
              'Blocked for this app. Turn them on in your phone’s Settings → Notifications → Manatee Crew, then reopen the app.'}
            {state === 'unsupported' &&
              'This browser can’t get notifications. On an iPhone, update to iOS 16.4 or later and open the app from your home screen.'}
          </p>
        </div>
        {state === 'on' && (
          <span className="mt-0.5 shrink-0 rounded-full bg-[var(--color-mist)] px-2.5 py-1 text-xs font-semibold text-[var(--color-spring)]">
            On
          </span>
        )}
      </div>

      {state === 'off' && (
        <button
          type="button"
          onClick={turnOn}
          disabled={busy}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-[var(--color-buoy)] px-5 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)] disabled:opacity-60"
        >
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}

      {state === 'on' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={sendTest}
            disabled={busy}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] border border-[var(--color-ink)]/20 px-4 text-sm font-semibold hover:border-[var(--color-ink)] disabled:opacity-60"
          >
            Send a test
          </button>
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-[10px] px-4 text-sm font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] disabled:opacity-60"
          >
            Turn off
          </button>
        </div>
      )}

      {flash && (
        <p
          role={flash.kind === 'err' ? 'alert' : 'status'}
          className={clsx(
            'mt-3 text-sm',
            flash.kind === 'err' ? 'text-[var(--color-error)]' : 'text-[var(--color-spring)]',
          )}
        >
          {flash.message}
        </p>
      )}
    </section>
  );
}
