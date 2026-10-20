'use client';

import { useState } from 'react';
import { clsx } from '@/lib/clsx';

interface Links {
  httpsUrl: string;
  webcalUrl: string;
}

/**
 * Lets a signed-in crew member put the trips in their own phone calendar:
 * makes them a calendar link (POST /api/crew/calendar) and shows how to add
 * it. Making a new one stops the old one, so it asks first if they have
 * one. Travis can also email it from Admin → Crew.
 */
export function CrewCalendarLink({ linkSince }: { linkSince: string | null }) {
  const [links, setLinks] = useState<Links | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLink = links !== null || linkSince !== null;

  async function makeLink() {
    if (
      hasLink &&
      !confirm('Make a new calendar link? The one you have now stops working, so you’ll need to add the new one.')
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/crew/calendar', { method: 'POST' });
      if (res.status === 401) {
        window.location.assign('/crew/login');
        return;
      }
      const json = (await res.json().catch(() => ({}))) as Partial<Links> & { error?: string };
      if (!res.ok || !json.httpsUrl || !json.webcalUrl) {
        throw new Error(json.error ?? 'Couldn’t make a calendar link just now. Try again in a minute.');
      }
      setLinks({ httpsUrl: json.httpsUrl, webcalUrl: json.webcalUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t make a calendar link just now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.httpsUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="crew-calendar"
      className="rounded-2xl border border-[var(--color-ink)]/8 bg-white p-4 shadow-[var(--shadow-card)]"
    >
      <h2 id="crew-calendar" className="font-semibold">
        Trips in your calendar
      </h2>
      <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">
        {links
          ? 'Here’s your new link. Your old one, if you had one, has stopped working.'
          : linkSince
            ? `You made a calendar link on ${linkSince}. Lost it, or adding another phone? Make a new one.`
            : 'Every booked trip in your phone’s calendar, kept up to date. Times and headcounts only.'}
      </p>

      {links && (
        <div className="mt-3 space-y-3 text-sm">
          <a
            href={links.webcalUrl}
            className="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-[var(--color-buoy)] px-5 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]"
          >
            Add to iPhone calendar
          </a>
          <p className="text-[var(--color-ink-soft)]">Then tap Subscribe, then Add.</p>
          <div>
            <p className="font-semibold">Google Calendar</p>
            <p className="mt-0.5 text-[var(--color-ink-soft)]">
              Copy the link. On a computer, go to calendar.google.com, click + next to Other calendars, then From
              URL, and paste it.
            </p>
            <p className="mt-2 break-all rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3 font-mono text-xs">
              {links.httpsUrl}
            </p>
            <button
              type="button"
              onClick={copy}
              className="mt-2 inline-flex h-10 items-center justify-center rounded-[10px] border border-[var(--color-ink)]/20 px-4 text-sm font-semibold hover:border-[var(--color-ink)]"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="text-[var(--color-ink-soft)]">
            iPhone checks for changes fairly often. Google Calendar can take hours, so go by the notifications and the
            [CRMF] emails for last-minute changes. Keep the link to yourself: anyone with it can see the schedule.
          </p>
        </div>
      )}

      {!links && (
        <button
          type="button"
          onClick={makeLink}
          disabled={busy}
          className={clsx(
            'mt-3 inline-flex h-11 w-full items-center justify-center rounded-[10px] px-5 font-semibold disabled:opacity-60',
            linkSince
              ? 'border border-[var(--color-ink)]/20 text-[var(--color-ink)] hover:border-[var(--color-ink)]'
              : 'bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]',
          )}
        >
          {busy ? 'Making your link…' : linkSince ? 'Make a new calendar link' : 'Get my calendar link'}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}
    </section>
  );
}
