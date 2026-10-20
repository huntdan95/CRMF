'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  BOAT_CAPACITY,
  departureClosed,
  marinaNow,
  matchesKind,
  tourStatus,
  type TourKind,
} from '@/lib/availability';
import { departureTimes, formatPrice, type MarketingTour } from '@/lib/tours';
import { useTourCatalog } from '@/components/TourCatalog';
import { formatFriendlyDate, isValidIsoDate } from '@/lib/date';
import { checkoutRefusalMessage, FunctionError, releaseCheckoutHold } from '@/lib/functions-client';
import { siteConfig } from '@/lib/site-config';
import type { WetsuitSizes } from '@/lib/site-settings';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowLeft, ArrowRight, Info, Shield, Spinner } from '@/components/ui/icons';
import { clsx } from '@/lib/clsx';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { DeparturePicker, priceFor } from './DeparturePicker';
import { GuestStepper, KindFilter, StepIndicator } from './Controls';
import { DetailsForm, draftGuestCount, forgetHold, readHold } from './DetailsForm';
import { MobileSummaryBar, TripSummary } from './TripSummary';
import { useAvailability } from './useAvailability';

const FORM_ID = 'booking-details';
const KINDS: TourKind[] = ['any', 'shared', 'private', 'whole-day'];

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** What the guest picked, for a sentence: "the 8:00 AM {shared tour}". */
function departureName(tour: MarketingTour): string {
  if (tour.timeSlot === 'whole-day') return 'whole-day charter';
  if (tour.timeSlot === 'sunset') return 'sunset cruise';
  return tour.type === 'shared' ? 'shared tour' : 'private boat';
}

/** "Saturday, October 24": the year goes without saying. */
function dayName(iso: string) {
  return formatFriendlyDate(iso).replace(/, \d{4}$/, '');
}

function readParams(sp: URLSearchParams, today: string, maxDate: string, tours: readonly MarketingTour[]) {
  const getTourBySlug = (slug: string) => tours.find((t) => t.slug === slug);
  const rawDate = sp.get('date');
  const date = rawDate && isValidIsoDate(rawDate) && rawDate >= today && rawDate <= maxDate ? rawDate : null;
  const tour = getTourBySlug(sp.get('tour') ?? '');
  const guests = Math.min(BOAT_CAPACITY, Math.max(1, Number.parseInt(sp.get('guests') ?? '', 10) || 2));
  const rawKind = sp.get('type') as TourKind | null;
  // Only an explicit ?type= filters; links from a tour page set it.
  const kind: TourKind = rawKind && KINDS.includes(rawKind) ? rawKind : 'any';
  return {
    date,
    tour: tour?.active ? tour : undefined,
    guests,
    kind,
    wantsDetails: sp.get('step') === 'details',
    bounced: getTourBySlug(sp.get('bounced') ?? ''),
  } as const;
}

export function BookingFlow({ wetsuitSizes }: { wetsuitSizes: WetsuitSizes }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { tours, seasons } = useTourCatalog();

  // The marina clock, ticking, so a departure closes on screen when it
  // reaches the online cutoff even if the page has been open for an hour.
  const [now, setNow] = useState(() => marinaNow());
  useEffect(() => {
    const id = window.setInterval(() => setNow(marinaNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const today = now.date;
  const maxDate = useMemo(() => addDays(today, 365), [today]);

  const { date, tour: wanted, guests, kind, wantsDetails, bounced } = readParams(
    new URLSearchParams(sp.toString()),
    today,
    maxDate,
    tours,
  );

  // The calendar follows the selected date's month unless the guest has
  // paged away from it.
  const [paged, setPaged] = useState<{ year: number; month0: number; anchor: string | null } | null>(null);
  const [anchorYear, anchorMonth] = (date ?? today).split('-').map(Number) as [number, number];
  const view = paged && paged.anchor === date ? paged : { year: anchorYear, month0: anchorMonth - 1 };
  const { getDay, isPending, loading, invalidate } = useAvailability(view.year, view.month0, date);

  const [notice, setNotice] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(() => sp.get('cancelled') === '1');
  const [submitting, setSubmitting] = useState(false);
  // Freeing the seats of a checkout the guest backed out of.
  const [releasing, setReleasing] = useState(false);
  // That release failed, so this tab's unpaid checkout may still be holding
  // its seats until Stripe expires it.
  const [holdKept, setHoldKept] = useState(false);
  const departuresRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const day = date ? getDay(date) : undefined;
  const dayPending = (!!date && !day && isPending(date)) || releasing;

  // The tour in the URL is a preference; it's only "selected" if it can
  // actually be booked for this date and group size. While checkout is
  // starting, or the guest's own unpaid hold is being released, hold on
  // to it so a background refresh can't pull the form out from under them.
  const wantedStatus = wanted && date ? tourStatus(wanted, day, guests, { date, now }) : null;
  const bookable = wanted && date && wantedStatus?.bookable && matchesKind(wanted, kind) ? wanted : null;
  const selected = (submitting || (releasing && wantsDetails)) && wanted && date ? wanted : bookable;
  const step = wantsDetails && selected ? 'details' : 'choose';

  const update = useCallback(
    (patch: Record<string, string | number | null>, mode: 'replace' | 'push' = 'replace') => {
      const next = new URLSearchParams(window.location.search);
      // One-shot markers never survive a change.
      next.delete('cancelled');
      next.delete('bounced');
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      const url = `${pathname}?${next.toString()}`;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  // On arrival: drop the one-shot ?cancelled marker from the URL (the
  // banner is already showing), and since Stripe's cancel URL doesn't
  // carry the group size, take it from the saved draft.
  useEffect(() => {
    const patch: Record<string, string | number | null> = {};
    if (!sp.get('guests') && sp.get('step') === 'details') {
      const saved = draftGuestCount();
      if (saved && saved !== guests) patch.guests = saved;
    }
    if (sp.get('cancelled') || Object.keys(patch).length) update(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from Stripe without paying (its cancel link, or the browser's Back
  // button, which may restore this page from the back-forward cache): free
  // that checkout's seats now instead of when Stripe expires it in 30
  // minutes, then reload availability without it. Checkouts that were paid
  // are left alone by the server.
  useEffect(() => {
    let active = true;
    async function release() {
      const hold = readHold();
      if (!hold) return;
      setReleasing(true);
      try {
        await releaseCheckoutHold(hold);
        forgetHold(hold.bookingId);
      } catch (err) {
        // A 4xx means there's nothing of ours to release. Otherwise keep it:
        // the next checkout sends it along and the server tries again.
        if (err instanceof FunctionError && err.status < 500) forgetHold(hold.bookingId);
      }
      if (!active) return;
      setHoldKept(readHold() !== null);
      invalidate();
      setReleasing(false);
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void release();
    };
    void release();
    window.addEventListener('pageshow', onShow);
    return () => {
      active = false;
      window.removeEventListener('pageshow', onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asked for the details step but the departure can't be booked (sold
  // out, already left, filtered out): go back to choosing, and say why.
  useEffect(() => {
    if (!wantsDetails || selected || submitting || dayPending) return;
    update({ step: null, bounced: wanted?.slug ?? null });
  }, [wantsDetails, selected, submitting, dayPending, wanted, update]);

  // New step: start at the top and move focus to its heading, so screen
  // reader users hear where they are.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Tell people when the tour they came for doesn't work on the date they
  // picked, instead of silently dropping it.
  const problemTour = bounced ?? (wanted && wantedStatus && !wantedStatus.bookable && !dayPending ? wanted : null);
  // Seats taken while this tab's own unpaid checkout couldn't be released:
  // that checkout may be what's taking them. Not when Travis closed the
  // departure, or when the release went through (then waiting won't help).
  const ownHoldInWay =
    holdKept && !!wantedStatus && !wantedStatus.bookable && wantedStatus.reason !== 'closed';
  const wantedProblem =
    problemTour && date
      ? departureClosed(date, problemTour.timeSlot, now)
        ? // The online cutoff passed (often while they were filling in details,
          // and the clock tick bounced them here): no hold is in the way, so
          // say what DetailsForm says.
          `Online booking for the ${departureTimes(problemTour, date).start} departure has closed. For same-day seats, call ${siteConfig.contact.phone}, or pick another departure.`
        : `The ${departureTimes(problemTour, date).start} ${departureName(problemTour)} isn’t available for ${guests} on ${dayName(date)}.` +
          (bounced
            ? `${ownHoldInWay ? ' Your earlier hold may be what’s in the way; it can take up to 30 minutes to clear.' : ''} Pick another departure below, or call ${siteConfig.contact.phone}.`
            : ' Pick another departure below.')
      : null;
  // Sent back from the details step: say why at the top, where the step
  // change scrolls to. By the departures it's a screen or two down on a phone,
  // and the form would seem to vanish for no reason.
  const topNotice =
    notice ??
    (bounced ? wantedProblem : null) ??
    (showCancelled && step === 'details'
      ? 'Checkout was cancelled, so nothing was charged. Your details are still here whenever you’re ready.'
      : null);

  function chooseDate(iso: string) {
    setNotice(null);
    setShowCancelled(false);
    update({ date: iso });
    // On phones the departures are below the calendar; bring them up.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() =>
        departuresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }

  function chooseDeparture(slug: string) {
    setNotice(null);
    update({ tour: slug });
  }

  function goToDetails() {
    if (!selected || !date) return;
    setNotice(null);
    update({ step: 'details' }, 'push');
  }

  function backToChoose() {
    setShowCancelled(false);
    update({ step: null }, 'push');
  }

  // Checkout turned the departure down. Say why in the guest's terms: the
  // server's message is written for Travis (slot keys, ISO dates).
  function onUnavailable(reason: string | undefined, holdSent: boolean) {
    invalidate();
    setShowCancelled(false);
    const why =
      wanted && date
        ? checkoutRefusalMessage(reason, {
            departure: `the ${departureTimes(wanted, date).start} ${departureName(wanted)} on ${dayName(date)}`,
            guests,
            holdSent,
          })
        : 'That departure is no longer available.';
    setNotice(`${why} Pick another departure, or call ${siteConfig.contact.phone}.`);
    // Unselect the departure that just failed, so Continue can't take
    // them straight back into the same refusal.
    update({ step: null, tour: null });
  }

  const total = selected && date ? priceFor(selected, guests, date, seasons) : null;

  // The phone bar swaps Continue for Pay in the same spot. The keys make
  // that a new <button>: if React reused Continue's, the keypress that
  // moved to the details step would carry on into a submit of the
  // still-empty form.
  const continueButton = (
    <button
      key="continue"
      type="button"
      onClick={goToDetails}
      disabled={!selected}
      className={buttonClasses({ size: 'lg', className: 'w-full' })}
    >
      Continue
      <ArrowRight size={18} />
    </button>
  );

  const payButton = (
    <button
      key="pay"
      type="submit"
      form={FORM_ID}
      disabled={submitting}
      className={buttonClasses({ size: 'lg', className: 'w-full' })}
    >
      {submitting ? (
        <>
          <Spinner size={18} />
          Opening secure checkout…
        </>
      ) : (
        <>
          Pay {total != null ? formatPrice(total) : ''}
          <ArrowRight size={18} />
        </>
      )}
    </button>
  );

  return (
    <div className="pb-32 lg:pb-20">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="flex flex-col gap-5 pt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-10">
          <StepIndicator step={step === 'details' ? 2 : 1} />
          <p className="hidden items-center gap-2 text-sm text-[var(--color-ink-soft)] sm:flex">
            <Shield size={16} className="text-[var(--color-spring)]" />
            Secure payment by Stripe
          </p>
        </div>

        {/* Always in the page, so screen readers announce what appears in it. */}
        <div role="status">
          {topNotice && (
            <div className="mt-6 flex gap-3 rounded-xl border border-[var(--color-buoy)]/40 bg-[var(--color-buoy)]/10 px-4 py-3.5 text-[0.9375rem]">
              <Info size={20} className="mt-0.5 shrink-0 text-[var(--color-buoy-deep)]" />
              <p>{topNotice}</p>
            </div>
          )}
        </div>

        {step === 'choose' ? (
          <>
            <header className="mt-8 max-w-2xl">
              <h1 ref={headingRef} tabIndex={-1} className="text-display text-[2.4rem] outline-none sm:text-[3.25rem]">
                Book your tour
              </h1>
              <p className="mt-3 text-lg text-[var(--color-ink-soft)]">
                Live seat counts for every departure. You&rsquo;ll get a
                confirmation by email the moment you pay.
              </p>
            </header>

            <section
              aria-label="Your group"
              className="mt-8 grid gap-5 rounded-2xl border border-[var(--color-sand)] bg-white p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-10"
            >
              <div className="flex items-center justify-between gap-6 lg:justify-start">
                <div>
                  <h2 id="guest-count-label" className="font-bold">How many are coming?</h2>
                  <p className="text-sm text-[var(--color-ink-soft)]">Six seats on the boat. Kids count too.</p>
                </div>
                <GuestStepper value={guests} onChange={(n) => update({ guests: n })} />
              </div>
              <div className="border-t border-[var(--color-sand)] pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
                <KindFilter
                  date={date}
                  today={today}
                  value={kind}
                  onChange={(k) =>
                    update({ type: k === 'any' ? null : k, tour: wanted && matchesKind(wanted, k) ? wanted.slug : null })
                  }
                />
              </div>
            </section>

            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-8">
              <section className="rounded-2xl border border-[var(--color-sand)] bg-white p-5 sm:p-6 lg:sticky lg:top-24">
                <AvailabilityCalendar
                  year={view.year}
                  month0={view.month0}
                  onMonthChange={(year, month0) => setPaged({ year, month0, anchor: date })}
                  selected={date}
                  onSelect={chooseDate}
                  getDay={getDay}
                  guests={guests}
                  kind={kind}
                  today={today}
                  now={now}
                  maxDate={maxDate}
                  loading={loading}
                />
              </section>

              <div ref={departuresRef}>
                <section className="rounded-2xl border border-[var(--color-sand)] bg-[var(--color-paper)] p-3 sm:p-5">
                  <div className="px-2 pt-2 sm:px-1 sm:pt-1">
                    {/* Always in the page, so a guest count that rules out the
                        chosen departure is announced, not just shown. */}
                    <div role="status">
                      {wantedProblem && !notice && !bounced && (
                        <p className="mb-4 rounded-lg bg-white px-3.5 py-2.5 text-sm text-[var(--color-ink)]">
                          {wantedProblem}
                        </p>
                      )}
                    </div>
                    <DeparturePicker
                      date={date}
                      day={day}
                      pending={dayPending}
                      now={now}
                      guests={guests}
                      kind={kind}
                      selectedSlug={selected?.slug ?? null}
                      onSelect={chooseDeparture}
                    />
                  </div>
                </section>

                <div className="sticky bottom-4 mt-4 hidden items-center gap-5 rounded-2xl border border-[var(--color-sand)] bg-white/95 p-4 pl-6 shadow-[var(--shadow-lift)] backdrop-blur lg:flex">
                  <div className="min-w-0 flex-1">
                    {selected && date ? (
                      <>
                        <p className="truncate font-semibold">
                          {formatFriendlyDate(date).replace(/, \d{4}$/, '')} · {departureTimes(selected, date).start} ·{' '}
                          {selected.timeSlot === 'whole-day'
                            ? 'Whole day'
                            : selected.timeSlot === 'sunset'
                              ? 'Sunset cruise'
                              : selected.type === 'shared'
                                ? 'Shared'
                                : 'Private'}
                        </p>
                        <p className="text-sm text-[var(--color-ink-soft)]">
                          {guests} {guests === 1 ? 'guest' : 'guests'} · {formatPrice(total ?? 0)} total
                        </p>
                      </>
                    ) : (
                      <p className="text-[var(--color-ink-soft)]">
                        {date ? 'Choose a departure to continue.' : 'Choose a date, then a departure.'}
                      </p>
                    )}
                  </div>
                  <div className="w-48 shrink-0">{continueButton}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <header className="mt-8 max-w-2xl">
              <button
                type="button"
                onClick={backToChoose}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-spring)] hover:text-[var(--color-ink)]"
              >
                <ArrowLeft size={16} />
                Change date or departure
              </button>
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-display text-[2.4rem] outline-none sm:text-[3.25rem]">
                Who&rsquo;s coming?
              </h1>
              <p className="mt-3 text-lg text-[var(--color-ink-soft)]">
                A couple of minutes of details, then you&rsquo;ll pay on
                Stripe&rsquo;s secure checkout.
              </p>
            </header>

            <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
              <div>
                {selected && date && (
                  <DetailsForm
                    key={`${selected.slug}-${date}`}
                    tour={selected}
                    date={date}
                    guests={guests}
                    formId={FORM_ID}
                    onSubmittingChange={setSubmitting}
                    onUnavailable={onUnavailable}
                    now={now}
                    wetsuitSizes={wetsuitSizes}
                  />
                )}
                <div className="mt-6 hidden lg:block">
                  <div className="max-w-sm">{payButton}</div>
                  <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
                    You&rsquo;ll finish on Stripe. We never see or store your card.
                  </p>
                </div>
              </div>
              <aside className="lg:sticky lg:top-24">
                <TripSummary tour={selected} date={date} guests={guests} action={payButton} onEdit={backToChoose} />
              </aside>
            </div>
          </>
        )}
      </div>

      <MobileSummaryBar
        tour={selected}
        date={date}
        guests={guests}
        action={
          <div className={clsx(step === 'details' ? 'w-44' : 'w-36')}>
            {step === 'details' ? payButton : continueButton}
          </div>
        }
      />
    </div>
  );
}
