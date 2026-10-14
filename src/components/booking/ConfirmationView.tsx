'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  bookingLoadMessage,
  fetchBooking,
  type FetchedBooking,
} from '@/lib/functions-client';
import { formatPrice, slotLabels } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { siteConfig } from '@/lib/site-config';
import { TourWeather } from './TourWeather';
import { StepIndicator } from './Controls';
import { DRAFT_KEY } from './DetailsForm';

interface Props {
  bookingId: string;
  accessToken: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; booking: FetchedBooking }
  | { phase: 'error'; message: string };

export function ConfirmationView({ bookingId, accessToken }: Props) {
  const [loaded, setState] = useState<State>({ phase: 'loading' });
  const state: State = accessToken
    ? loaded
    : {
        phase: 'error',
        message: 'Your confirmation link is missing the access token. Use the link in your email instead.',
      };

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    async function loadWithRetry(attempt = 0): Promise<void> {
      try {
        const { booking } = await fetchBooking(bookingId, accessToken!);
        if (cancelled) return;
        if (booking.status === 'pending-payment' && attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500 + attempt * 500));
          if (!cancelled) await loadWithRetry(attempt + 1);
          return;
        }
        if (booking.status === 'confirmed') {
          try {
            sessionStorage.removeItem(DRAFT_KEY);
          } catch {
            // Storage unavailable; nothing to clear.
          }
        }
        setState({ phase: 'ready', booking });
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: 'error',
          message: bookingLoadMessage(err),
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
          Something&rsquo;s off
        </h2>
        <p className="mt-2 text-sm">{state.message}</p>
        <p className="mt-4 text-sm">
          Your booking is probably fine. Check your inbox for the
          confirmation email, or call us at{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="font-medium text-[var(--color-ink)] underline underline-offset-2"
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
  const calendarUrl = `/book/confirmation/${booking.id}/calendar.ics?t=${booking.accessToken}`;
  const vcfUrl = `/travis.vcf`;
  const selfServiceUrl = `${siteConfig.url}/my-booking/${booking.id}?t=${booking.accessToken}`;

  return (
    <div className="space-y-6">
      {/* Progress only makes sense once the booking has loaded. */}
      <StepIndicator step={isPending ? 3 : 4} />

      {/* Celebratory hero */}
      {isPending ? (
        <div className="rounded-2xl p-6 bg-white border border-[var(--color-buoy)]/40">
          <h2 className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)]">
            Waiting for payment confirmation…
          </h2>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            Stripe is finalizing your payment. This page will update
            automatically as soon as it lands.
          </p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-[var(--color-spring-deep)] text-white p-7 sm:p-10">
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[var(--color-buoy)] text-[var(--color-ink)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12.5l4 4 10-10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h2 className="mt-6 text-display text-[2.2rem] sm:text-5xl">
              You&rsquo;re booked. See you on the water.
            </h2>
            <p className="mt-4 text-white/85 max-w-xl">
              Confirmation email on the way to{' '}
              <span className="font-medium text-white">{booking.customerEmail}</span>.
              Save this page — it&rsquo;s also your self-service link.
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              <a
                href={calendarUrl}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[var(--color-ink)] hover:bg-[var(--color-mist)] text-sm font-medium transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Add to calendar
              </a>
              <a
                href={vcfUrl}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                  <path d="M4 21c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Save Travis to contacts
              </a>
            </div>
          </div>

          {/* Soft glow behind the hero */}
          <div
            aria-hidden
            className="absolute -bottom-12 -right-12 w-56 h-56 rounded-full bg-[var(--color-spring-bright)]/20 blur-3xl"
          />
        </div>
      )}

      {/* Weather */}
      {!isPending && <TourWeather date={booking.date} />}

      {/* Booking details */}
      <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-5 sm:p-6">
        <h3 className="text-lg font-bold mb-4">Your booking</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Tour" value={booking.tourName} />
          <Row label="Date" value={formatFriendlyDate(booking.date)} />
          <Row label="Slot" value={slotLabels[booking.timeSlot]} />
          <Row
            label="Type"
            value={booking.type === 'private' ? 'Private — whole boat' : 'Shared'}
          />
          <Row label="Guests" value={String(booking.guestCount)} />
          <Row label="Paid" value={formatPrice(booking.amountPaidCents)} />
        </dl>

        <div className="mt-6 pt-4 border-t border-[var(--color-sand)]">
          <h4 className="text-label text-[var(--color-ink-soft)] mb-2">
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

      {/* Where to meet */}
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

        <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-[var(--color-ink)]">Arrival</p>
            <p className="mt-1 text-[var(--color-ink-soft)]">
              Show up 15 minutes early. Free parking on site. Travis
              will meet you at the dock with the boat ready.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--color-ink)]">Bring</p>
            <p className="mt-1 text-[var(--color-ink-soft)]">
              Swimsuit + your own towel + reef-safe sunscreen.
              We&rsquo;ll provide everything else on the boat.
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
          Can&rsquo;t find Travis at the dock? Call{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
          >
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>

      {/* Self-service */}
      <div className="rounded-2xl bg-[var(--color-paper)] border border-[var(--color-sand)] p-5 sm:p-6">
        <h3 className="text-lg font-bold">Need to make changes?</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Bookmark this link — it&rsquo;s how you cancel or reschedule
          without calling.
        </p>
        <p className="mt-3 text-xs font-mono break-all text-[var(--color-ink)] bg-white rounded px-2 py-1 border border-[var(--color-sand)]">
          {selfServiceUrl}
        </p>
        <p className="mt-3 text-sm">
          Or just call Travis at{' '}
          <a
            href={siteConfig.contact.phoneHref}
            className="font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
          >
            {siteConfig.contact.phone}
          </a>
          .
        </p>
      </div>

      <div className="text-center">
        <Link
          href="/"
          className="text-sm font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)] underline-offset-4 hover:underline"
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
