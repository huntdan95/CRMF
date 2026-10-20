'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InstallHint, isIos, isStandalone } from '@/components/crew/InstallHint';
import { clsx } from '@/lib/clsx';
import { currentSubscription, pushSupported } from '@/lib/web-push-client';
import { Badge, PanelBody, PanelFooter, PanelHeader, buttonClass, panelClass } from './ui';

type State =
  | 'loading'
  | 'install' // iPhone in Safari: has to be added to the home screen first
  | 'unsupported'
  | 'denied'
  | 'off'
  | 'on';

const SW_URL = '/admin-sw.js';
const SW_SCOPE = '/admin';

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/api/admin/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  if (res.status === 401) {
    window.location.assign('/admin/login?next=/admin/settings');
    return;
  }
  if (!res.ok) throw new Error(`Saving the subscription failed (${res.status})`);
}

async function deleteSubscription(endpoint: string): Promise<void> {
  await fetch('/api/admin/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

/**
 * Where this device stands: registers the admin service worker and, if
 * notifications are already on, re-saves the subscription so the server's
 * copy heals itself if it was ever dropped.
 */
function useAdminPushState(): [State, (s: State) => void] {
  const [state, setState] = useState<State>('loading');
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
          const current = await currentSubscription(reg, sub, deleteSubscription).catch(() => null);
          if (cancelled) return;
          if (!current) {
            setState('off');
            return;
          }
          setState('on');
          await saveSubscription(current).catch(() => undefined);
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
  return [state, setState];
}

/**
 * Admin → Settings: push notifications on this phone or computer for new
 * bookings, customer cancellations, contact messages, reschedule requests,
 * private feedback, bounced emails and the 6 PM review list
 * (functions/src/adminNotifications.ts). Per device: turning them on here
 * doesn't turn them on anywhere else.
 */
export function AdminNotifications() {
  const [state, setState] = useAdminPushState();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);

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
      const sub = await currentSubscription(reg, await reg.pushManager.getSubscription(), deleteSubscription);
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
        await deleteSubscription(sub.endpoint);
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
      const res = await fetch('/api/admin/push/test', { method: 'POST' });
      if (res.status === 401) {
        window.location.assign('/admin/login?next=/admin/settings');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setFlash({ kind: 'ok', message: 'Test sent. It takes a few seconds; go to your home screen to see it pop up.' });
    } catch {
      setFlash({ kind: 'err', message: 'Couldn’t send the test. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="notifications" className={clsx(panelClass, 'overflow-hidden scroll-mt-20')}>
      <PanelHeader
        title="Notifications on this device"
        description="A ping for new bookings, customer cancellations, messages, reschedule requests, private feedback, bounced emails, and tonight’s review requests. Tapping one opens the right page."
        aside={state === 'on' ? <Badge tone="spring">On</Badge> : undefined}
      />
      <PanelBody className="space-y-3 text-sm">
        {state === 'install' && (
          <InstallHint appName="Manatee Admin" notifications="Admin notifications" />
        )}
        {state === 'loading' && <p className="text-[var(--color-ink-soft)] animate-pulse">Checking this device…</p>}
        {state === 'on' && <p>On for this device. Turn them on separately on each phone or computer you use.</p>}
        {state === 'off' && <p>Off for this device.</p>}
        {state === 'denied' && (
          <p>
            Blocked for this app. Turn them on in your phone’s Settings → Notifications → Manatee Admin (or your
            browser’s site settings), then reopen the app.
          </p>
        )}
        {state === 'unsupported' && (
          <p>
            This browser can’t get notifications. On an iPhone, update to iOS 16.4 or later and open the app from your
            home screen.
          </p>
        )}
        {flash && (
          <p
            role={flash.kind === 'err' ? 'alert' : 'status'}
            className={clsx('font-medium', flash.kind === 'err' ? 'text-[var(--color-coral-dark)]' : 'text-[var(--color-spring)]')}
          >
            {flash.message}
          </p>
        )}
      </PanelBody>
      {(state === 'off' || state === 'on') && (
        <PanelFooter>
          {state === 'off' ? (
            <button type="button" onClick={turnOn} disabled={busy} className={buttonClass('primary')}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          ) : (
            <>
              <button type="button" onClick={turnOff} disabled={busy} className={buttonClass('ghost')}>
                Turn off
              </button>
              <button type="button" onClick={sendTest} disabled={busy} className={buttonClass('secondary')}>
                Send a test
              </button>
            </>
          )}
        </PanelFooter>
      )}
    </section>
  );
}

/**
 * Stops this device's admin notifications, for signing out: a signed-out
 * device shouldn't keep getting customers' names. Never throws.
 */
export async function stopAdminPushOnThisDevice(): Promise<void> {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration(SW_SCOPE) : undefined;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await deleteSubscription(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } catch {
    // Nothing to stop, or the browser won't say.
  }
}

const NUDGE_DISMISSED = 'crmf-admin-push-nudge-dismissed';

/**
 * Dashboard: a one-line prompt to turn notifications on for this device,
 * until they're on or Travis dismisses it.
 */
export function AdminNotificationsNudge() {
  const [state] = useAdminPushState();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage once
      setDismissed(localStorage.getItem(NUDGE_DISMISSED) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || (state !== 'off' && state !== 'install')) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)] px-4 py-3 text-sm">
      <p className="min-w-0 flex-1">
        {state === 'install'
          ? 'Want a ping on this phone for new bookings and messages? Add the admin to your Home Screen first.'
          : 'Want a ping on this device for new bookings and messages?'}
      </p>
      <Link href="/admin/settings#notifications" className={buttonClass('primary', 'sm')}>
        {state === 'install' ? 'Show me how' : 'Turn on'}
      </Link>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(NUDGE_DISMISSED, '1');
          } catch {
            // Private browsing: it just comes back next time.
          }
        }}
        className={buttonClass('ghost', 'sm')}
      >
        Not now
      </button>
    </div>
  );
}
