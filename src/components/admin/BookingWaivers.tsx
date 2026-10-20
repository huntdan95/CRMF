'use client';

import { useEffect, useState } from 'react';
import type { BookingDoc } from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import {
  sameDeviceSigners,
  signedAtLabel,
  subscribeWaiversForBooking,
  type WaiverDoc,
} from '@/lib/admin-waivers';
import { addDaysIso, marinaNow } from '@/lib/availability';
import { clsx } from '@/lib/clsx';
import { FunctionError } from '@/lib/functions-client';
import { waiverSigningLink } from '@/lib/waiver/link';
import { waiverCoverage } from '@/lib/waiver/people';
import { isLegacy } from './booking-labels';

/** Set on the booking by the waiver reminder (functions/src/waiverReminder.ts). */
interface ReminderFields {
  waiverReminderSentAt?: { seconds: number; nanoseconds: number } | null;
  /** `date/timeSlot` it went out for; missing on reminders sent before that was kept. */
  waiverReminderSentFor?: string | null;
}

const REMINDER_SKIPPED: Record<string, string> = {
  'all-signed': 'Everyone has signed, so no reminder went out.',
  'not-confirmed': 'Only confirmed bookings and old-site reservations get reminders.',
  closed: 'You closed this tour, so they’re picking a new date or a refund first.',
  past: 'This trip has already happened.',
  'no-address': 'There’s no email address on this booking.',
  'in-progress': 'A reminder is already on its way.',
  'already-sent': 'A reminder already went out.',
  'not-found': 'Booking not found.',
};

/**
 * Booking detail → Waivers: who on the booking has signed, each signed
 * PDF, and the signing link to send anyone who hasn't (or to hand over
 * the phone at the dock). `closedBooked` and `callingOff` are the booking
 * page's: a departure Travis closed and left them booked on, or is calling
 * off right now.
 */
export function BookingWaivers({
  booking,
  closedBooked = false,
  callingOff = false,
}: {
  booking: BookingDoc & ReminderFields;
  closedBooked?: boolean;
  callingOff?: boolean;
}) {
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

  // Old-site deposit bookings are imported as pending-payment but are real
  // guests; their party signs too.
  const active =
    booking.status === 'confirmed' ||
    (booking.status === 'pending-payment' && booking.id.startsWith('legacy-'));
  // Who the 3 PM job reminds: a trip going ahead (isGoingAhead in
  // functions/src/lib/types.ts) on a departure Travis hasn't closed.
  const remindable =
    (booking.status === 'confirmed' || (booking.status === 'pending-payment' && isLegacy(booking))) &&
    !booking.closure;
  // It runs at 3 PM for the next day's trips, so it's still to come only for
  // a trip after tomorrow, or tomorrow's before 3 PM. A trip today, or one
  // booked or moved onto tomorrow after 3, gets none unless Travis sends it.
  const now = marinaNow();
  const tomorrow = addDaysIso(now.date, 1);
  const reminderComing = booking.date > tomorrow || (booking.date === tomorrow && now.minutes < 15 * 60);
  // The 3 PM job also skips any departure a closed day covers, left booked
  // or being called off (waiverReminder.ts), so none is coming for those.
  const departureClosed = closedBooked || callingOff;
  const tripAhead = booking.date >= now.date;
  // Some old-site bookings came with no email address: nothing to send to.
  const noEmail = !booking.customerEmail?.trim();
  // A reminder for a departure the booking has since moved from doesn't count.
  const remindedThisTrip =
    !!booking.waiverReminderSentAt &&
    (!booking.waiverReminderSentFor || booking.waiverReminderSentFor === `${booking.date}/${booking.timeSlot}`);
  const sameDevice = waivers ? sameDeviceSigners(waivers) : new Map<string, string[]>();
  const coverage = waivers ? waiverCoverage(booking.guests, booking.guestCount, waivers) : null;
  const allSigned = coverage?.complete ?? false;
  const smsBody = link
    ? `Hi! Please sign the waiver for your ${booking.timeSlot === 'sunset' ? 'sunset cruise' : 'manatee tour'} before we head out. Every adult signs their own; parents sign for kids under 18: ${link}`
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
      : coverage?.needed === 0
        ? `Email ${booking.customerEmail} a reminder to make sure everyone in their party has signed, with the signing link?`
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
              : coverage.needed === 0
                ? `${coverage.signedCount} signed · party size not recorded`
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
                          ` · for ${w.minors
                            .map(
                              (m) =>
                                `${m.name} (${m.ageOnTripDate}${m.relationship === 'legal-guardian' ? ', legal guardian' : m.relationship === 'parent' ? ', parent' : ''})`,
                            )
                            .join(', ')}`}
                        {w.accompanyingAdult && ` · with ${w.accompanyingAdult} on the boat`}
                        {w.signatureMethod === 'typed' && ' · typed signature'}
                      </p>
                      {w.signer.participating && sameDevice.has(w.id) && (
                        <p className="text-xs text-[var(--color-coral-dark)]">
                          Signed on the same phone as {sameDevice.get(w.id)!.join(', ')}. Fine if
                          they passed the phone around; if not, ask {w.signer.name.split(' ')[0]} at
                          the dock whether they signed it themselves, and have them sign again if not.
                        </p>
                      )}
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
            <a
              href="/admin/waivers/paper"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
            >
              Print paper copy
            </a>
            {coverage && !allSigned && (
              <button
                type="button"
                onClick={sendReminder}
                disabled={reminding || noEmail}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-50"
              >
                {reminding ? 'Sending…' : noEmail ? 'Waiver reminder: no email on file' : 'Send waiver reminder'}
              </button>
            )}
          </div>
          {coverage && !allSigned && (remindedThisTrip || (remindable && tripAhead)) && (
            <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
              {remindedThisTrip
                ? `Reminder emailed to ${booking.customerName.split(' ')[0]} on ${reminderSentAt}.`
                : noEmail
                  ? `There’s no email on file for ${booking.customerName.split(' ')[0]}, so no reminder goes out. Text them the link instead.`
                  : departureClosed
                    ? `No automatic reminder goes out while the departure is closed.${closedBooked ? ` Use “Send waiver reminder” to email ${booking.customerName.split(' ')[0]} yourself.` : ''}`
                    : reminderComing
                      ? `If anyone still hasn’t signed, ${booking.customerName.split(' ')[0]} gets a reminder email at 3 PM the day before the trip.`
                      : `The automatic reminder goes out at 3 PM the day before, so ${booking.customerName.split(' ')[0]} won’t get one for this trip. Use “Send waiver reminder” to email them now.`}
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
