'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchBooking,
  type FetchedBooking,
} from '@/lib/functions-client';
import { formatPrice, slotLabels, getTourBySlug } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';
import { CancelDialog } from './CancelDialog';
import { RescheduleDialog } from './RescheduleDialog';

interface Props {
  bookingId: string;
  accessToken: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; booking: FetchedBooking }
  | { phase: 'error'; message: string };

export function MyBookingView({ bookingId, accessToken }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [dialog, setDialog] = useState<'cancel' | 'reschedule' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    if (!accessToken) {
      setState({
        phase: 'error',
        message:
          'This link is missing the access token. Use the link in your confirmation email instead.',
      });
      return;
    }
    try {
      const { booking } = await fetchBooking(bookingId, accessToken);
      setState({ phase: 'ready', booking });
    } catch (err) {
      setState({
        phase: 'error',
        message:
          err instanceof Error ? err.message : 'Could not load your booking.',
      });
    }
  }

  useEffect(() => {
    setState({ phase: 'loading' });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, accessToken]);

  if (state.phase === 'loading') {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-8 text-center">
        <p className="text-[var(--color-ink-soft)] animate-pulse">
          Loading your booking…
        </p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 p-6">
        <h2 className="font-display text-xl text-[var(--color-coral-dark)]">
          Couldn&rsquo;t open your booking
        </h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <p className="mt-4 text-sm">
          Call us at{' '}
          <a href={siteConfig.contact.phoneHref} className="text-[var(--color-brand-blue)] underline">
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
  const readonly = cancelled || completed;
  const tour = getTourBySlug(booking.tourId);

  const statusBadge = readonly
    ? cancelled
      ? {
          label: 'Cancelled',
          className: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
        }
      : {
          label: booking.status === 'no-show' ? 'No-show' : 'Completed',
          className: 'bg-[var(--color-manatee)]/20 text-[var(--color-ink)]',
        }
    : {
        label: booking.status === 'pending-payment' ? 'Pending payment' : 'Confirmed',
        className: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
      };

  return (
    <div className="space-y-6">
      {flash && (
        <div className="rounded-2xl bg-[var(--color-brand-blue)]/10 border border-[var(--color-brand-blue)]/20 p-4 text-sm">
          {flash}
        </div>
      )}

      <header className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
            Booking · {booking.id.slice(0, 8)}…
          </p>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl leading-tight">
            {booking.tourName}
          </h2>
          <p className="mt-1 text-[var(--color-ink-soft)]">
            {formatFriendlyDate(booking.date)} · {slotLabels[booking.timeSlot]}
            {tour && (
              <>
                {' · '}
                {tour.startTimeDisplay} – {tour.endTimeDisplay}
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

      <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h3 className="font-display text-lg mb-3">Your booking</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Type" value={booking.type === 'private' ? 'Private — whole boat' : 'Shared'} />
          <Row label="Guests" value={String(booking.guestCount)} />
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

        <div className="mt-5 pt-4 border-t border-[var(--color-ink)]/8">
          <h4 className="font-medium text-sm text-[var(--color-ink-soft)] uppercase tracking-widest mb-2">
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

        <div className="mt-5 pt-4 border-t border-[var(--color-ink)]/8 text-sm">
          <p>
            <strong>Emergency contact:</strong> {booking.emergencyContactName}{' '}
            <span className="text-[var(--color-ink-soft)]">
              · {booking.emergencyContactPhone}
            </span>
          </p>
        </div>
      </div>

      {/* Where to meet (only meaningful for active bookings) */}
      {!readonly && (
        <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
          <h3 className="font-display text-lg">Where to meet</h3>
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
            className="mt-3 inline-block text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
          >
            Directions →
          </a>
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            Show up 15 minutes early. Bring a swimsuit and a towel — wetsuits,
            fins, mask, and snorkel are on the boat.
          </p>
        </div>
      )}

      {/* Cancellation summary */}
      {cancelled && (
        <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5 sm:p-6">
          <h3 className="font-display text-lg">Cancellation</h3>
          {booking.cancellationReason && (
            <p className="mt-2 text-sm">
              <strong>Reason:</strong> {booking.cancellationReason}
            </p>
          )}
          <p className="mt-2 text-sm">
            <strong>Refunded:</strong> {formatPrice(booking.amountRefundedCents)}
            {booking.amountRefundedCents === 0 && ' (none per policy)'}
          </p>
          {booking.cancelledAt && (
            <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
              Cancelled on{' '}
              {new Date(booking.cancelledAt).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {!readonly && (
        <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-3">
          <h3 className="font-display text-lg">Need to make changes?</h3>
          <p className="text-sm text-[var(--color-ink-soft)]">
            The fastest path is a phone call to{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
            >
              {siteConfig.contact.phone}
            </a>
            . You can also use the buttons below.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDialog('reschedule')}
              className="inline-flex items-center justify-center px-5 py-3 rounded-full border border-[var(--color-brand-blue)] text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)] hover:text-white font-medium"
            >
              Request a different date
            </button>
            <button
              type="button"
              onClick={() => setDialog('cancel')}
              className="inline-flex items-center justify-center px-5 py-3 rounded-full bg-[var(--color-coral)]/10 text-[var(--color-coral-dark)] border border-[var(--color-coral)]/30 hover:bg-[var(--color-coral)] hover:text-white hover:border-[var(--color-coral)] font-medium"
            >
              Cancel booking
            </button>
          </div>
          <p className="text-xs text-[var(--color-ink-soft)] pt-1">
            Cancellation policy: 72+ hours before tour = full refund. 24-72
            hours = 50%. Less than 24 hours = no refund (call Travis for
            emergencies). Travis-cancelled tours always refund in full.
          </p>
        </div>
      )}

      <div className="text-center pt-2">
        <Link
          href="/"
          className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
        >
          Back to crystalrivermanateefun.com
        </Link>
      </div>

      {dialog === 'cancel' && tour && (
        <CancelDialog
          booking={booking}
          tourStartTime={tour.startTime}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            setDialog(null);
            setFlash('Cancelled. Watch your email for the receipt.');
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
            setFlash(
              "Request sent — Travis usually replies within a day. Your current booking stays put until then.",
            );
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[120px_1fr] gap-2">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
