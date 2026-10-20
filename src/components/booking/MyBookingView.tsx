'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  bookingLoadMessage,
  fetchBooking,
  type FetchedBooking,
} from '@/lib/functions-client';
import { departureTimes, formatPrice, slotLabels, getTourBySlug } from '@/lib/tours';
import { slotStartTime } from '@/lib/schedule';
import { formatFriendlyDate } from '@/lib/date';
import { marinaNow } from '@/lib/availability';
import { inRefundGrace, refundGraceExplanation } from '@/lib/refund-policy';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';
import { CancelDialog } from './CancelDialog';
import { RescheduleDialog } from './RescheduleDialog';
import { MoveDialog } from './MoveDialog';
import { ClosureRefundDialog } from './ClosureRefundDialog';
import { WaiverCallout } from '@/components/waiver/WaiverCallout';

interface Props {
  bookingId: string;
  accessToken: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; booking: FetchedBooking }
  | { phase: 'error'; message: string };

export function MyBookingView({ bookingId, accessToken }: Props) {
  const [loaded, setState] = useState<State>({ phase: 'loading' });
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | 'move' | 'closure-refund' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  // A request is waiting on Travis: don't invite a second one.
  const [rescheduleSent, setRescheduleSent] = useState(false);
  const state: State = accessToken
    ? loaded
    : {
        phase: 'error',
        message: 'This link is missing the access token. Use the link in your confirmation email instead.',
      };

  async function fetchState(): Promise<State> {
    try {
      const { booking } = await fetchBooking(bookingId, accessToken!);
      return { phase: 'ready', booking };
    } catch (err) {
      return {
        phase: 'error',
        message: bookingLoadMessage(err),
      };
    }
  }

  /** Re-read after a cancellation. */
  function load() {
    if (accessToken) fetchState().then(setState);
  }

  useEffect(() => {
    if (!accessToken) return;
    let stale = false;
    fetchState().then((next) => {
      if (!stale) setState(next);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, accessToken]);

  // A dialog finished (cancelled, moved, request sent). The button that opened
  // it is gone or disabled once the booking reloads, so focus goes to what
  // happened instead, which also brings it into view on a phone.
  useEffect(() => {
    if (flash) flashRef.current?.focus();
  }, [flash]);

  if (state.phase === 'loading') {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-8 text-center">
        <p className="text-[var(--color-ink-soft)] animate-pulse">
          Loading your booking…
        </p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl bg-[var(--color-error)]/5 border border-[var(--color-error)]/30 p-6">
        <h2 className="text-xl font-bold text-[var(--color-buoy-deep)]">
          Couldn&rsquo;t open your booking
        </h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <p className="mt-4 text-sm">
          Call us at{' '}
          <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
            {siteConfig.contact.phone}
          </a>{' '}
          — we can look it up by name or email.
        </p>
      </div>
    );
  }

  const { booking } = state;
  const cancelled = booking.status === 'cancelled';
  const completed =
    booking.status === 'completed' || booking.status === 'no-show';
  const tour = getTourBySlug(booking.tourId);
  // Still "confirmed" (Travis marks tours done later), but the boat has
  // left: nothing to meet, cancel or move any more.
  const now = marinaNow();
  // From the schedule: the sunset cruise leaves at a different time each day.
  // Keyed on the booking's own slot, as cancelBooking's refund is.
  const departs = tour ? slotStartTime(booking.timeSlot, booking.date) : '00:00';
  const [startH, startM] = departs.split(':').map(Number) as [number, number];
  const departed =
    !cancelled &&
    !completed &&
    (booking.date < now.date || (booking.date === now.date && !!tour && now.minutes >= startH * 60 + startM));
  // Travis closed the departure: they pick a new date or a refund, even
  // once the closed date has passed.
  const closure =
    booking.closure && (booking.status === 'confirmed' || booking.status === 'pending-payment')
      ? booking.closure
      : null;
  const readonly = cancelled || completed || (departed && !closure);
  // Booked on the old website: the money isn't in this site's Stripe, so
  // cancelBooking turns these away and Travis cancels them himself.
  const oldSite = booking.id.startsWith('legacy-');
  // Travis reopened the trip after offering a new date or a refund: the
  // refund still stands until the offer's deadline, whatever the policy.
  const refundGrace =
    !oldSite && booking.amountPaidCents > booking.amountRefundedCents && inRefundGrace(booking.refundGraceUntil)
      ? refundGraceExplanation(booking.refundGraceUntil!, booking.date)
      : null;
  // Travis closed the departure but left them booked on it: he's contacting
  // them himself, and cancelBooking turns a cancel away instead of giving
  // the policy refund. Not while a reopened trip's full refund still stands,
  // nor for a checkout never paid for, which can still be let go of.
  const closedBooked =
    booking.status === 'confirmed' &&
    !closure &&
    !!booking.departureClosed &&
    !inRefundGrace(booking.refundGraceUntil);

  const statusBadge = readonly
    ? cancelled
      ? {
          label: 'Cancelled',
          className: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
        }
      : {
          label: booking.status === 'no-show' ? 'No-show' : departed ? 'Past tour' : 'Completed',
          className: 'bg-[var(--color-mist)] text-[var(--color-ink)]',
        }
    : closure
      ? {
          label: 'Tour closed',
          className: 'bg-[var(--color-buoy)] text-[var(--color-ink)]',
        }
      : {
          // An old-site reservation is pending-payment here, but it's a real
          // trip (any balance is settled with Travis), not a checkout to finish.
          label: booking.status === 'pending-payment' ? (oldSite ? 'Reserved' : 'Pending payment') : 'Confirmed',
          className: 'bg-[var(--color-spring)] text-white',
        };

  return (
    <div className="space-y-6">
      {flash && (
        <div
          ref={flashRef}
          tabIndex={-1}
          className="rounded-xl bg-[var(--color-mist)] border border-[var(--color-spring)]/25 p-4 text-sm outline-none"
        >
          {flash}
        </div>
      )}

      {closure && (
        <div className="rounded-2xl bg-[var(--color-mist)] border border-[var(--color-spring)]/30 p-5 sm:p-6">
          <h3 className="text-lg font-bold">Travis had to close this tour</h3>
          <p className="mt-2 text-sm">
            {closure.reason}. Your booking isn&rsquo;t lost: move it to another date at no charge, or take a
            full refund.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setDialog('move')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]"
            >
              Pick a new date
            </button>
            <button
              type="button"
              onClick={() => setDialog('closure-refund')}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-ink)]/20 bg-white px-5 font-semibold text-[var(--color-ink)] hover:border-[var(--color-ink)]"
            >
              {booking.amountPaidCents > booking.amountRefundedCents ? 'Refund me instead' : 'Cancel instead'}
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            If you haven&rsquo;t chosen by {formatFriendlyDate(closure.decideBy)},{' '}
            {booking.amountPaidCents <= booking.amountRefundedCents
              ? 'we’ll cancel the booking automatically'
              : oldSite
                ? 'we’ll cancel the booking and Travis will refund you in full himself'
                : 'we’ll refund you in full automatically'}
            . Questions? Call or text{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>
            .
          </p>
        </div>
      )}

      <header className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="text-label text-[var(--color-spring)]">
            Booking · {booking.id.slice(0, 8)}…
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">
            {booking.tourName}
          </h2>
          <p className="mt-1 text-[var(--color-ink-soft)]">
            {formatFriendlyDate(booking.date)} · {slotLabels[booking.timeSlot]}
            {tour && (
              <>
                {' · '}
                {departureTimes(tour, booking.date).start} – {departureTimes(tour, booking.date).end}
              </>
            )}
          </p>
        </div>
        <span
          className={clsx(
            'self-start inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
            statusBadge.className,
          )}
        >
          {statusBadge.label}
        </span>
      </header>

      <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-5 sm:p-6">
        <h3 className="text-lg font-bold mb-3">Your booking</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Type" value={booking.type === 'private' ? 'Private — whole boat' : 'Shared'} />
          {/* 0 is an old-website booking that never recorded its party size. */}
          <Row label="Guests" value={booking.guestCount > 0 ? String(booking.guestCount) : 'Not recorded'} />
          <Row label="Paid" value={formatPrice(booking.amountPaidCents)} />
          {booking.amountRefundedCents > 0 && (
            <Row
              label="Refunded"
              value={formatPrice(booking.amountRefundedCents)}
            />
          )}
          <Row label="Customer" value={booking.customerName} />
          <Row label="Email" value={booking.customerEmail} />
          <Row label="Phone" value={booking.customerPhone} />
        </dl>

        <div className="mt-5 pt-4 border-t border-[var(--color-sand)]">
          <h4 className="text-label text-[var(--color-ink-soft)] mb-2">
            Your party
          </h4>
          <ol className="text-sm space-y-1">
            {booking.guests.map((g, i) => (
              <li key={i}>
                {i + 1}. {g.name}
                {g.age != null && (
                  <span className="text-[var(--color-ink-soft)]"> (age {g.age})</span>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5 pt-4 border-t border-[var(--color-sand)] text-sm">
          <p>
            <strong>Emergency contact:</strong> {booking.emergencyContactName}{' '}
            <span className="text-[var(--color-ink-soft)]">
              · {booking.emergencyContactPhone}
            </span>
          </p>
        </div>
      </div>

      {/* Not once the boat has left, and not while the tour is closed: they're
          choosing a new date or a refund. An old-site reservation is still
          pending-payment here but is a real trip, as on the waiver page. */}
      {!readonly &&
        !closure &&
        (booking.status === 'confirmed' || (booking.status === 'pending-payment' && oldSite)) && (
        <WaiverCallout bookingId={booking.id} accessToken={booking.accessToken} />
      )}

      {/* Where to meet (only meaningful for active bookings) */}
      {!readonly && !closure && (
        <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-5 sm:p-6">
          <h3 className="text-lg font-bold">Where to meet</h3>
          <p className="mt-2 text-sm">
            <strong>{siteConfig.marina.name}</strong>
            <br />
            {siteConfig.marina.streetAddress}
            <br />
            {siteConfig.marina.city}, {siteConfig.marina.region}{' '}
            {siteConfig.marina.postalCode}
          </p>
          <a
            href={siteConfig.marina.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)] underline-offset-4 hover:underline"
          >
            Directions →
          </a>
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {booking.timeSlot === 'sunset'
              ? 'Show up 15 minutes early. It’s BYOB: bring your own drinks and food.'
              : 'Show up 15 minutes early. Bring a swimsuit and your own towel — wetsuit, mask, snorkel, bottled water, and hot chocolate are on the boat.'}
          </p>
        </div>
      )}

      {/* Cancellation summary */}
      {cancelled && (
        <div className="rounded-2xl bg-[var(--color-paper)] border border-[var(--color-sand)] p-5 sm:p-6">
          <h3 className="text-lg font-bold">Cancellation</h3>
          {booking.cancellationReason && (
            <p className="mt-2 text-sm">
              <strong>Reason:</strong> {booking.cancellationReason}
            </p>
          )}
          {(booking.manualRefundCents ?? 0) > 0 ? (
            // Paid on the old website: nothing goes back through this site.
            // Travis marks it in admin once he's sent it.
            booking.manualRefundedAt ? (
              <p className="mt-2 text-sm">
                <strong>Refunded:</strong> {formatPrice(booking.manualRefundCents!)} by Travis on{' '}
                {marinaDay(booking.manualRefundedAt)}
              </p>
            ) : (
              <p className="mt-2 text-sm">
                <strong>Refund:</strong> Travis will refund {formatPrice(booking.manualRefundCents!)}{' '}
                himself, since you booked on our old website.
              </p>
            )
          ) : booking.amountPaidCents === 0 ? (
            // An unpaid checkout: no policy came into it.
            <p className="mt-2 text-sm">Nothing was charged, so there&rsquo;s nothing to refund.</p>
          ) : (
            <p className="mt-2 text-sm">
              <strong>Refunded:</strong> {formatPrice(booking.amountRefundedCents)}
              {booking.amountRefundedCents === 0 && ' (none per policy)'}
            </p>
          )}
          {booking.cancelledAt && (
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Cancelled on {marinaDay(booking.cancelledAt)}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {!readonly && !closure && (
        <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-5 sm:p-6 space-y-3">
          <h3 className="text-lg font-bold">Need to make changes?</h3>
          <p className="text-sm text-[var(--color-ink-soft)]">
            The fastest path is a phone call to{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
            >
              {siteConfig.contact.phone}
            </a>
            . You can also {oldSite || closedBooked ? 'ask for a different date below' : 'use the buttons below'}.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDialog('reschedule')}
              disabled={rescheduleSent}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-ink)]/20 px-5 font-semibold text-[var(--color-ink)] hover:border-[var(--color-ink)] disabled:opacity-50"
            >
              {rescheduleSent ? 'Date change requested' : 'Request a different date'}
            </button>
            {!oldSite && !closedBooked && (
              <button
                type="button"
                onClick={() => setDialog('cancel')}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-error)]/40 px-5 font-semibold text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white"
              >
                Cancel booking
              </button>
            )}
          </div>
          {closedBooked && (
            <p className="text-sm font-medium">
              Capt. Travis has closed this trip and will be in touch with you directly. You can also call or
              text him at{' '}
              <a
                href={siteConfig.contact.phoneHref}
                className="font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
              >
                {siteConfig.contact.phone}
              </a>
              .
            </p>
          )}
          {oldSite && !closedBooked && (
            <p className="text-sm">
              You booked on our old website, so this booking can&rsquo;t be cancelled online. To cancel, call
              or text Travis at{' '}
              <a
                href={siteConfig.contact.phoneHref}
                className="font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
              >
                {siteConfig.contact.phone}
              </a>
              {' '}and he&rsquo;ll sort it out.
            </p>
          )}
          {refundGrace && <p className="text-sm font-medium">{refundGrace}</p>}
          <p className="text-xs text-[var(--color-ink-soft)] pt-1">
            Cancellation policy: 72+ hours before tour = full refund. Less
            than 72 hours = no refund. Travis-cancelled tours always refund
            in full.
          </p>
        </div>
      )}

      <div className="text-center pt-2">
        <Link
          href="/"
          className="text-sm font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)] underline-offset-4 hover:underline"
        >
          Back to crystalrivermanateefun.com
        </Link>
      </div>

      {dialog === 'cancel' && tour && (
        <CancelDialog
          booking={booking}
          tourStartTime={departs}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null);
            // Unpaid holds are cancelled without an email (nothing to refund).
            setFlash(
              booking.amountPaidCents > 0
                ? 'Cancelled. Watch your email for the receipt.'
                : 'Cancelled. Nothing was charged, so there’s no refund to wait for.',
            );
            load();
          }}
        />
      )}
      {dialog === 'move' && (
        <MoveDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onMoved={(date, departs) => {
            setDialog(null);
            setFlash(`Moved to ${formatFriendlyDate(date)}, ${departs}. A new confirmation is on its way to your email.`);
            load();
          }}
        />
      )}
      {dialog === 'closure-refund' && (
        <ClosureRefundDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onRefunded={(message) => {
            setDialog(null);
            setFlash(message);
            load();
          }}
        />
      )}
      {dialog === 'reschedule' && (
        <RescheduleDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onSubmitted={() => {
            setDialog(null);
            setRescheduleSent(true);
            setFlash(
              "Request sent — Travis usually replies within a day. Your current booking stays put until then.",
            );
          }}
        />
      )}
    </div>
  );
}

/** "October 21, 2026", the marina's day for an ISO timestamp. */
function marinaDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[120px_1fr] gap-2">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
