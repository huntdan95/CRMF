'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  bookingLoadMessage,
  fetchBooking,
  FunctionError,
  type FetchedBooking,
} from '@/lib/functions-client';
import { formatClock, formatPrice, slotLabels } from '@/lib/tours';
import { slotStartMinutes } from '@/lib/schedule';
import { formatFriendlyDate } from '@/lib/date';
import { marinaNow } from '@/lib/availability';
import { siteConfig } from '@/lib/site-config';
import { inRefundGrace } from '@/lib/refund-policy';
import { TourWeather } from './TourWeather';
import { StepIndicator } from './Controls';
import { DRAFT_KEY, forgetHold } from './DetailsForm';
import { WaiverCallout } from '@/components/waiver/WaiverCallout';

interface Props {
  bookingId: string;
  accessToken: string | null;
}

type State =
  | { phase: 'loading' }
  /** `stalled`: still unpaid after we stopped checking. */
  | { phase: 'ready'; booking: FetchedBooking; stalled?: boolean }
  | { phase: 'error'; message: string };

/** How long to keep checking for Stripe's payment confirmation. */
const POLL_FOR_MS = 2 * 60_000;

export function ConfirmationView({ bookingId, accessToken }: Props) {
  const [loaded, setState] = useState<State>({ phase: 'loading' });
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const state: State = accessToken
    ? loaded
    : {
        phase: 'error',
        message: 'Your confirmation link is missing the access token. Use the link in your email instead.',
      };

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    let showingWait = false;
    const startedAt = Date.now();
    async function loadWithRetry(attempt = 0): Promise<void> {
      try {
        const { booking } = await fetchBooking(bookingId, accessToken!);
        if (cancelled) return;
        // Stripe sent them here, so this checkout went through.
        forgetHold(bookingId);
        if (booking.status === 'pending-payment') {
          // Stripe's webhook usually lands within seconds, but a cold start
          // can take longer. Show the waiting state while we keep checking.
          if (Date.now() - startedAt < POLL_FOR_MS) {
            // From the third check on (a failed check also counts as one).
            if (attempt >= 2 && !showingWait) {
              showingWait = true;
              setState({ phase: 'ready', booking });
            }
            await new Promise((r) => setTimeout(r, Math.min(1500 + attempt * 500, 5000)));
            if (!cancelled) await loadWithRetry(attempt + 1);
            return;
          }
          setState({ phase: 'ready', booking, stalled: true });
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
        // A failed check while we wait for Stripe (a phone switching
        // networks, a cold start) is just one more retry, not a reason to
        // swap the page for an error. That includes the very first one,
        // straight back from paying; only a bad link (4xx) fails at once. A
        // timeout (408) or rate limit (429) isn't a bad link: the next check
        // can go through.
        const badLink =
          err instanceof FunctionError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 408 &&
          err.status !== 429;
        if ((attempt > 0 || !badLink) && Date.now() - startedAt < POLL_FOR_MS) {
          await new Promise((r) => setTimeout(r, 5000));
          if (!cancelled) await loadWithRetry(attempt + 1);
          return;
        }
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

  // Loading gives way to the booking, and "waiting for payment" to "you're
  // booked", with nothing a screen reader would notice. Take focus to the
  // new headline, unless the guest has already put it somewhere else. (The
  // headlines' outline-none! beats the site-wide focus ring: focus moved on
  // page load would otherwise ring the headline for everyone.)
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== headlineRef.current) return;
    headlineRef.current?.focus({ preventScroll: true });
  }, [loaded, accessToken]);

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
        <h2 ref={headlineRef} tabIndex={-1} className="text-xl font-bold text-[var(--color-buoy-deep)] outline-none!">
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
  // Travis closed the departure: nothing to meet or put in a calendar. They
  // pick a new date or a refund on their booking page (same test as
  // MyBookingView).
  const closure =
    booking.closure && (booking.status === 'confirmed' || booking.status === 'pending-payment')
      ? booking.closure
      : null;
  const isPending = booking.status === 'pending-payment' && !closure;
  const isCancelled = booking.status === 'cancelled';
  // Still "confirmed" until Travis marks the tour done, but once the boat
  // has left (marina time) there's nothing to meet or add to a calendar.
  // A closed one stays open for choosing, as on MyBookingView.
  const now = marinaNow();
  const departed =
    booking.status === 'confirmed' &&
    !closure &&
    (booking.date < now.date ||
      (booking.date === now.date && now.minutes >= slotStartMinutes(booking.timeSlot, booking.date)));
  // Completed or no-show, or left already: the trip date has been and gone.
  const isOver = booking.status === 'completed' || booking.status === 'no-show' || departed;
  // Travis closed the departure but left them booked on it (same test as
  // MyBookingView): he's contacting them himself, so it isn't "see you on
  // the water", and there's nothing yet to meet or put in a calendar.
  const closedBooked =
    booking.status === 'confirmed' &&
    !closure &&
    !!booking.departureClosed &&
    !inRefundGrace(booking.refundGraceUntil);
  const isActive = !isPending && !isCancelled && !isOver && !closure && !closedBooked;
  const calendarUrl = `/book/confirmation/${booking.id}/calendar.ics?t=${booking.accessToken}`;
  const vcfUrl = `/travis.vcf`;
  const myBookingPath = `/my-booking/${booking.id}?t=${booking.accessToken}`;
  // The address this page was opened on, so the link works on staging too
  // (siteConfig.url is the live domain, which may not serve this site yet).
  const origin = typeof window === 'undefined' ? siteConfig.url : window.location.origin;
  const selfServiceUrl = `${origin}${myBookingPath}`;

  return (
    <div className="space-y-6">
      {/* Progress only makes sense once the booking has loaded. */}
      {(isPending || isActive) && <StepIndicator step={isPending ? 3 : 4} />}

      {/* Celebratory hero */}
      {isPending ? (
        <div className="rounded-2xl p-6 bg-white border border-[var(--color-buoy)]/40">
          <h2 ref={headlineRef} tabIndex={-1} className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)] outline-none!">
            {state.stalled ? 'Your payment is taking longer than usual' : 'Waiting for payment confirmation…'}
          </h2>
          {state.stalled ? (
            <>
              <p className="mt-2 text-[var(--color-ink-soft)]">
                If it went through, you&rsquo;ll get a confirmation email at{' '}
                <span className="font-medium text-[var(--color-ink)]">{booking.customerEmail}</span>{' '}
                within a few minutes. Please don&rsquo;t book again in the
                meantime.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex items-center rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-spring-deep)]"
              >
                Check again
              </button>
            </>
          ) : (
            <p className="mt-2 text-[var(--color-ink-soft)]">
              Stripe is finalizing your payment. This page will update
              automatically as soon as it lands.
            </p>
          )}
        </div>
      ) : isCancelled ? (
        <div className="rounded-2xl p-6 bg-white border border-[var(--color-error)]/30">
          <h2 ref={headlineRef} tabIndex={-1} className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)] outline-none!">
            This booking is cancelled
          </h2>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            {booking.amountRefundedCents > 0
              ? `${formatPrice(booking.amountRefundedCents)} has been refunded to your card. It can take 5–10 business days to show up. `
              : ''}
            Questions? Call or text Travis at{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="font-medium text-[var(--color-ink)] underline underline-offset-2"
            >
              {siteConfig.contact.phone}
            </a>
            .
          </p>
        </div>
      ) : isOver ? (
        <div className="rounded-2xl p-6 bg-white border border-[var(--color-sand)]">
          <h2 ref={headlineRef} tabIndex={-1} className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)] outline-none!">
            This tour has already happened
          </h2>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            Thanks for booking with us. We&rsquo;d love to have you back on the water.
          </p>
        </div>
      ) : closure ? (
        <div className="rounded-2xl p-6 bg-[var(--color-mist)] border border-[var(--color-spring)]/30">
          <h2 ref={headlineRef} tabIndex={-1} className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)] outline-none!">
            Travis had to close this tour
          </h2>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            {closure.reason}. Your booking isn&rsquo;t lost: move it to another date at no charge, or take a
            full refund.
          </p>
          <Link
            href={myBookingPath}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold bg-[var(--color-buoy)] text-[var(--color-ink)] hover:bg-[var(--color-buoy-deep)]"
          >
            Pick a new date or a refund
          </Link>
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            If you haven&rsquo;t chosen by {formatFriendlyDate(closure.decideBy)}, we&rsquo;ll{' '}
            {booking.amountPaidCents > booking.amountRefundedCents ? 'refund you in full' : 'cancel the booking'}{' '}
            automatically. Questions? Call or text{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>
            .
          </p>
        </div>
      ) : closedBooked ? (
        <div className="rounded-2xl p-6 bg-[var(--color-mist)] border border-[var(--color-spring)]/30">
          <h2 ref={headlineRef} tabIndex={-1} className="text-2xl font-bold leading-tight sm:text-3xl text-[var(--color-ink)] outline-none!">
            Travis has had to close this trip
          </h2>
          <p className="mt-2 text-[var(--color-ink-soft)]">
            Your booking and payment are safe. Capt. Travis will be in touch to move you to another date or
            refund you in full. Questions? Call or text{' '}
            <a href={siteConfig.contact.phoneHref} className="font-medium underline underline-offset-2">
              {siteConfig.contact.phone}
            </a>
            .
          </p>
          <Link
            href={myBookingPath}
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-semibold border border-[var(--color-ink)]/20 text-[var(--color-ink)] hover:border-[var(--color-ink)]/40"
          >
            Your booking page
          </Link>
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
            <h2 ref={headlineRef} tabIndex={-1} className="mt-6 text-display text-[2.2rem] sm:text-5xl outline-none!">
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

      {isActive && <WaiverCallout bookingId={booking.id} accessToken={booking.accessToken} />}

      {/* Weather */}
      {isActive && <TourWeather date={booking.date} />}

      {/* Booking details */}
      <div className="rounded-2xl bg-white border border-[var(--color-sand)] p-5 sm:p-6">
        <h3 className="text-lg font-bold mb-4">Your booking</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Tour" value={booking.tourName} />
          <Row label="Date" value={formatFriendlyDate(booking.date)} />
          <Row
            label="Slot"
            value={
              booking.timeSlot === 'sunset'
                ? `${slotLabels.sunset}, departs ${formatClock(slotStartMinutes('sunset', booking.date))}`
                : slotLabels[booking.timeSlot]
            }
          />
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

      {/* Where to meet, and how to change it: only while the trip is on. */}
      {(isPending || isActive) && (<>
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
              Arrive 20 to 30 minutes before your departure. Park and meet
              in the Pete&rsquo;s Pier parking lot.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--color-ink)]">Bring</p>
            <p className="mt-1 text-[var(--color-ink-soft)]">
              {booking.timeSlot === 'sunset'
                ? 'It’s BYOB: your own drinks and food.'
                : 'Wear your swimsuit under clothes suited to the weather, and bring your own towel and reef-safe sunscreen. We’ll provide everything else on the boat.'}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
          Can&rsquo;t find Travis? Call{' '}
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
        <Link
          href={myBookingPath}
          className="mt-3 block text-xs font-mono break-all text-[var(--color-ink)] underline underline-offset-2 bg-white rounded px-2 py-1 border border-[var(--color-sand)] hover:border-[var(--color-ink)]/40"
        >
          {selfServiceUrl}
        </Link>
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
      </>)}

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
