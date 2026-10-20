'use client';

import { useSyncExternalStore } from 'react';
import { clsx } from '@/lib/clsx';

const noopSubscribe = () => () => {};

/** iPhone or iPad (iPadOS reports itself as a Mac with a touchscreen). */
export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * On an iPhone in Safari: explains that the app (the crew app, or the admin
 * app) has to be added to the home screen first. iOS only allows web
 * notifications from home-screen apps, and the home-screen app keeps its
 * own sign-in separate from Safari's, so signing in before adding it would
 * have to be done twice. Renders nothing anywhere else.
 */
export function InstallHint({
  tone = 'light',
  appName = 'Manatee Crew',
  notifications = 'Booking notifications',
}: {
  tone?: 'light' | 'dark';
  /** The name it gets on the home screen. */
  appName?: string;
  notifications?: string;
}) {
  // false on the server; the real answer once hydrated.
  const show = useSyncExternalStore(
    noopSubscribe,
    () => isIos() && !isStandalone(),
    () => false,
  );

  if (!show) return null;
  return (
    <div
      className={clsx(
        'rounded-2xl p-4 text-sm leading-relaxed',
        tone === 'dark'
          ? 'bg-white/10 text-white ring-1 ring-white/20'
          : 'bg-[var(--color-mist)] text-[var(--color-ink)]',
      )}
    >
      <p className="font-semibold">On an iPhone? Add this to your Home Screen first.</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Tap the Share button{' '}
          <ShareIcon className="inline-block -mt-1 align-middle" /> in Safari.
        </li>
        <li>Choose “Add to Home Screen”, then “Add”.</li>
        <li>Open {appName} from your home screen and sign in there.</li>
      </ol>
      <p className={clsx('mt-2', tone === 'dark' ? 'text-white/75' : 'text-[var(--color-ink-soft)]')}>
        {notifications} only work from the Home Screen app.
      </p>
    </div>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="Share" className={className}>
      <path
        d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
