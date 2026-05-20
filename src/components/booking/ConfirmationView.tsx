'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  fetchBooking,
  type FetchedBooking,
} from '@/lib/functions-client';
import { formatPrice, slotLabels } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { clsx } from '@/lib/clsx';

interface Props {
  bookingId: string;
  accessToken: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; booking: FetchedBooking }
  | { phase: 'error'; message: string };

export function ConfirmationView({ bookingId, accessToken }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    if (!accessToken) {
      setState({
        phase: 'error',
        message:
          'Your confirmation link is missing the access token. Use the link in your email instead.',
      });
      return;
    }

    let cancelled = false;
    // Retry a couple times — the Stripe webhook flips status from
    // `pending-payment` → `confirmed` asynchronously, and the customer may
    // land on this page before the webhook lands.
    async function loadWithRetry(attempt = 0): Promise<void> {
      try {
        const { booking } = await fetchBooking(bookingId, accessToken!);
        if (cancelled) return;
        if (
          booking.status === 'pending-payment' &&
          attempt < 5
        ) {
          await new Promise((r) => setTimeout(r, 1500 + attempt * 500));
          if (!cancelled) await loadWithRetry(attempt + 1);
          return;
        }
        setState({ phase: 'ready', booking });
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Could not load your booking.',
        });
      }
    }
    loadWithRetry();
    return () => {
      cancelled = true;
    };
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
          Something&rsquo;s off
        </h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <p className="mt-4 text-sm">
          Your booking is probably fine. Check your inbox for the confirmation
          email, or call us at{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="text-[var(--color-brand-blue)] underline"
          >
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>
    );
  }

  const { booking } = state;
  const isPending = booking.status === 'pending-payment';

  return (
    <div className="space-y-6">
      <div
        className={clsx(
          'rounded-2xl p-6 border',
          isPending
            ? 'bg-[var(--color-cream)] border-[var(--color-coral)]/30'
            : 'bg-[var(--color-brand-blue)] text-white border-transparent',
        )}
      >
        <h2
          className={clsx(
            'font-display text-2xl sm:text-3xl leading-tight',
            isPending ? 'text-[var(--color-ink)]' : '',
          )}
        >
          {isPending
            ? 'Waiting for payment confirmation…'
            : 'You\'re booked. See you on the water.'}
        </h2>
        <p
          className={clsx(
            'mt-2',
            isPending ? 'text-[var(--color-ink-soft)]' : 'text-white/85',
          )}
        >
          {isPending
            ? "Stripe is finalizing your payment. This page will update automatically as soon as it lands."
            : `A confirmation email is on its way to ${booking.customerEmail}. Save this page — it's also your self-service link.`}
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h3 className="font-display text-lg mb-4">Your booking</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Tour" value={booking.tourName} />
          <Row label="Date" value={formatFriendlyDate(booking.date)} />
          <Row label="Slot" value={slotLabels[booking.timeSlot]} />
          <Row
            label="Type"
            value={booking.type === 'private' ? 'Private — whole boat' : 'Shared'}
          />
          <Row label="Guests" value={String(booking.guestCount)} />
          <Row
            label="Paid"
            value={formatPrice(booking.amountPaidCents)}
          />
        </dl>

        <div className="mt-6 pt-4 border-t border-[var(--color-ink)]/8">
          <h4 className="font-medium text-sm text-[var(--color-ink-soft)] uppercase tracking-widest mb-2">
            Your party
          </h4>
          <ol className="text-sm space-y-1">
            {booking.guests.map((g, i) => (
              <li key={i}>
                {i + 1}. {g.name}
                {g.age != null && (
                  <span className="text-[var(--color-ink-soft)]">
                    {' '}
                    (age {g.age})
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

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
        <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
          Show up 15 minutes before your start time. Bring a swimsuit and a
          towel — we provide wetsuits, fins, mask, and snorkel.
        </p>
      </div>

      <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5 sm:p-6">
        <h3 className="font-display text-lg">Need to make changes?</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Bookmark this link — it&rsquo;s how you cancel or reschedule without
          calling.
        </p>
        <p className="mt-3 text-xs font-mono break-all text-[var(--color-ink)] bg-white rounded px-2 py-1 border border-[var(--color-ink)]/8">
          {`${siteConfig.url}/my-booking/${booking.id}?t=${booking.accessToken}`}
        </p>
        <p className="mt-3 text-sm">
          Or just call Travis at{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
          >
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>

      <div className="text-center">
        <Link
          href="/"
          className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
        >
          Back to crystalrivermanateefun.com
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[120px_1fr] gap-2">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
