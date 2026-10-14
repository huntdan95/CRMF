'use client';

import { useEffect, useState } from 'react';
import type { BookingDoc } from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import { signedAtLabel, subscribeWaiversForBooking, type WaiverDoc } from '@/lib/admin-waivers';
import { clsx } from '@/lib/clsx';
import { FunctionError } from '@/lib/functions-client';
import { waiverSigningLink } from '@/lib/waiver/link';
import { waiverCoverage } from '@/lib/waiver/people';

/** Set on the booking by the waiver reminder (functions/src/waiverReminder.ts). */
interface ReminderFields {
  waiverReminderSentAt?: { seconds: number; nanoseconds: number } | null;
}

const REMINDER_SKIPPED: Record<string, string> = {
  'all-signed': 'Everyone has signed, so no reminder went out.',
  'not-confirmed': 'Only confirmed bookings get reminders.',
  past: 'This trip has already happened.',
  'in-progress': 'A reminder is already on its way.',
  'already-sent': 'A reminder already went out.',
  'not-found': 'Booking not found.',
};

/**
 * Booking detail → Waivers: who on the booking has signed, each signed
 * PDF, and the signing link to send anyone who hasn't (or to hand over
 * the phone at the dock).
 */
export function BookingWaivers({ booking }: { booking: BookingDoc & ReminderFields }) {
  const [waivers, setWaivers] = useState<WaiverDoc[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [reminderFlash, setReminderFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );

  useEffect(() => {
    return subscribeWaiversForBooking(booking.id, setWaivers, () => setLoadError(true));
  }, [booking.id]);

  useEffect(() => {
    let live = true;
    waiverSigningLink(window.location.origin, booking.id, booking.accessToken).then((l) => {
      if (live) setLink(l);
    });
    return () => {
      live = false;
    };
  }, [booking.id, booking.accessToken]);

  const active = booking.status === 'confirmed';
  const coverage = waivers ? waiverCoverage(booking.guests, booking.guestCount, waivers) : null;
  const allSigned = coverage ? coverage.signedCount >= coverage.needed : false;
  const smsBody = link
    ? `Hi! Please sign the waiver for your manatee tour before we head out. Every adult signs their own; parents sign for kids under 18: ${link}`
    : '';
  const reminderSentAt = booking.waiverReminderSentAt
    ? new Date(booking.waiverReminderSentAt.seconds * 1000).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  async function sendReminder() {
    const ask = reminderSentAt
      ? `A reminder already went to ${booking.customerEmail} on ${reminderSentAt}. Send another?`
      : `Email ${booking.customerEmail} a reminder listing who still needs to sign, with the signing link?`;
    if (!confirm(ask)) return;
    setReminding(true);
    setReminderFlash(null);
    try {
      const result = await admin.sendWaiverReminder(booking.id);
      setReminderFlash(
        result.sent
          ? { kind: 'ok', message: `Reminder emailed to ${booking.customerEmail}.` }
          : { kind: 'err', message: REMINDER_SKIPPED[result.skipped ?? ''] ?? 'Not sent.' },
      );
    } catch (err) {
      setReminderFlash({
        kind: 'err',
        message: err instanceof FunctionError ? err.message : 'Failed.',
      });
    } finally {
      setReminding(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy the signing link:', link);
    }
  }

  return (
    <div className="lg:col-span-2 bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="font-display text-base">Waivers</h3>
        {coverage && (
          <span
            className={clsx(
              'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
              allSigned
                ? 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]'
                : 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
            )}
          >
            {allSigned
              ? 'Everyone signed'
              : `${coverage.signedCount} of ${coverage.needed} signed`}
          </span>
        )}
      </div>

      {loadError && (
        <p className="text-sm text-[var(--color-coral-dark)]">
          Couldn’t load waivers. Refresh, or sign out and back in.
        </p>
      )}
      {!waivers && !loadError && (
        <p className="text-sm text-[var(--color-ink-soft)] animate-pulse">Loading waivers…</p>
      )}

      {coverage && waivers && (
        <>
          <ul className="text-sm divide-y divide-[var(--color-ink)]/8">
            {coverage.roster.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {r.name}
                  {r.age != null && <span className="text-[var(--color-ink-soft)]"> (age {r.age})</span>}
                </span>
                {r.covered ? (
                  <span className="text-[var(--color-brand-blue-dark)]">
                    ✓ Signed
                    {r.covered.minor && (
                      <span className="text-[var(--color-ink-soft)]"> by {r.covered.signerName}</span>
                    )}
                    {r.covered.name !== r.name && (
                      <span className="text-[var(--color-ink-soft)]"> as “{r.covered.name}”</span>
                    )}
                  </span>
                ) : (
                  <span className="font-medium text-[var(--color-coral-dark)]">Not signed</span>
                )}
              </li>
            ))}
          </ul>

          {coverage.unmatched.length > 0 && (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              Also signed, but didn’t match a name on the booking:{' '}
              <span className="text-[var(--color-ink)]">
                {coverage.unmatched.map((p) => `${p.name}${p.minor ? ' (child)' : ''}`).join(', ')}
              </span>
              . Check whether they’re one of the people above under another name.
            </p>
          )}

          {waivers.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs uppercase tracking-widest text-[var(--color-ink-soft)] mb-2">
                Signed waivers ({waivers.length})
              </h4>
              <ul className="space-y-2">
                {waivers.map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--color-ink)]/[0.03] px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {w.signer.name}
                        {!w.signer.participating && (
                          <span className="font-normal text-[var(--color-ink-soft)]"> · not going, signed for kids</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-ink-soft)]">
                        {signedAtLabel(w)}
                        {w.minors.length > 0 &&
                          ` · for ${w.minors.map((m) => `${m.name} (${m.ageOnTripDate})`).join(', ')}`}
                        {w.accompanyingAdult && ` · with ${w.accompanyingAdult} on the boat`}
                        {w.signatureMethod === 'typed' && ' · typed signature'}
                      </p>
                      {w.tripDate !== booking.date && (
                        // Moved since signing: the ages above are for the old date.
                        <p className="text-xs text-[var(--color-coral-dark)]">
                          Signed for {w.tripDate}; the trip is now {booking.date}.
                          {w.minors.length > 0 && ' Check the kids are still under 18 on the new date.'}
                        </p>
                      )}
                    </div>
                    <a
                      href={`/admin/waivers/${w.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
                    >
                      View PDF
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {active && link && (
        <div className="mt-4 pt-4 border-t border-[var(--color-ink)]/8">
          <p className="text-sm text-[var(--color-ink-soft)] mb-2">
            {allSigned
              ? 'Signing link, if anyone else joins the trip:'
              : 'Send this link to anyone who hasn’t signed, or open it and hand them your phone:'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
            >
              {copied ? 'Copied' : 'Copy signing link'}
            </button>
            <a
              href={`sms:${booking.customerPhone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(smsBody)}`}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
            >
              Text it to {booking.customerName.split(' ')[0]}
            </a>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
            >
              Open signing page
            </a>
            {coverage && !allSigned && (
              <button
                type="button"
                onClick={sendReminder}
                disabled={reminding}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-50"
              >
                {reminding ? 'Sending…' : 'Send waiver reminder'}
              </button>
            )}
          </div>
          {coverage && !allSigned && (
            <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
              {reminderSentAt
                ? `Reminder emailed to ${booking.customerName.split(' ')[0]} on ${reminderSentAt}.`
                : `If anyone still hasn’t signed, ${booking.customerName.split(' ')[0]} gets a reminder email at 3 PM the day before the trip.`}
            </p>
          )}
          {reminderFlash && (
            <p
              role="status"
              className={clsx(
                'mt-2 text-sm',
                reminderFlash.kind === 'ok'
                  ? 'text-[var(--color-brand-blue-dark)]'
                  : 'text-[var(--color-coral-dark)]',
              )}
            >
              {reminderFlash.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
