'use client';

import { useEffect, useRef, useState } from 'react';
import {
  adminAuthReady,
  getClosureAction,
  listBlackoutsBetween,
  listGuestFeedback,
  subscribeBooking,
  type BookingDoc,
  type GuestFeedbackDoc,
} from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import { departureTimes, formatPrice, tours } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { marinaNow } from '@/lib/availability';
import { NO_WETSUIT } from '@/lib/site-settings';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import { Chat, Mail, Phone } from '@/components/ui/icons';
import {
  awaitingMove,
  canMarkAfterTour,
  canMarkCompleted,
  canRefundHere,
  canResendConfirmation,
  cancelledByLabel,
  departureClosed,
  emailBounces,
  followupAllowed,
  goingAhead,
  isLegacy,
  isStaleClosure,
  partySize,
  paymentLabel,
  slotLabel,
  statusLabel,
  statusTone,
  stillPaying,
  typeLabel,
} from './booking-labels';
import { CancelAdminDialog } from './dialogs/CancelAdminDialog';
import { PartialRefundDialog } from './dialogs/PartialRefundDialog';
import { EditBookingDialog } from './dialogs/EditBookingDialog';
import { RescheduleAdminDialog } from './dialogs/RescheduleAdminDialog';
import { NoteDialog } from './dialogs/NoteDialog';
import { FixEmailDialog } from './dialogs/FixEmailDialog';
import { EraseBookingDialog } from './dialogs/EraseBookingDialog';
import { Badge, DateTile, PanelBody, PanelHeader, buttonClass, panelClass } from './ui';
import { BookingWaivers } from './BookingWaivers';
import { BookingTripPhotos } from './BookingTripPhotos';
import { onTheBoat } from './TripPhotosAdmin';

interface Props {
  bookingId: string;
}

type DialogKind =
  | null
  | 'cancel'
  | 'partial-refund'
  | 'edit'
  | 'reschedule'
  | 'note'
  | 'fix-email'
  | 'erase';

type Flash = { kind: 'ok' | 'err'; message: string };

const FOLLOWUP_SKIPPED: Record<string, string> = {
  'not-yet': 'Not sent: the boat isn’t back yet. It can go once the trip is over.',
  'too-old': 'Not sent: the tour was too long ago.',
  'not-confirmed': 'Not sent: this booking is cancelled, a no-show, or refunded.',
  'already-sent': 'Not sent: they’ve already had one.',
  'not-found': 'Not sent: booking not found.',
  closed: 'Not sent: you called off this departure.',
  suppressed: 'Not sent: they’ve asked not to get these emails.',
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof FunctionError ? err.message : fallback;
}

export function BookingDetail({ bookingId }: Props) {
  const [booking, setBooking] = useState<BookingDoc | null | undefined>(undefined);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busyMark, setBusyMark] = useState<
    'completed' | 'no-show' | 'resend' | 'followup' | 'refund-by-hand' | 'reset-links' | null
  >(null);

  useEffect(() => {
    let unsub = () => {};
    // Left the page before sign-in was ready: don't start a listener that
    // nothing would ever stop.
    let left = false;
    (async () => {
      try {
        await adminAuthReady();
        if (left) return;
        unsub = subscribeBooking(bookingId, (b) => setBooking(b));
      } catch {
        if (!left) setBooking(null);
      }
    })();
    return () => {
      left = true;
      unsub();
    };
  }, [bookingId]);

  // "Tell Travis privately" messages from the thank-you email. The push
  // for one opens this page, so they're shown here in full (the push and
  // the email preview are cut short). Read once: a new one comes with a
  // push, and tapping it loads the page again.
  const [feedback, setFeedback] = useState<{ bookingId: string; items: GuestFeedbackDoc[] } | null>(null);
  useEffect(() => {
    let left = false;
    listGuestFeedback(bookingId)
      .then((items) => {
        if (!left) setFeedback({ bookingId, items });
      })
      // Nothing to show: the card stays hidden, and the email still has it.
      .catch(() => {});
    return () => {
      left = true;
    };
  }, [bookingId]);
  const feedbackItems = feedback?.bookingId === bookingId ? feedback.items : [];

  // Good news fades on its own; problems stay until Travis closes them.
  useEffect(() => {
    if (flash?.kind !== 'ok') return;
    const t = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Cancel and Erase take the button that opened them away with them (the
  // booking can't be changed or erased any more), so once the dialog hands
  // focus back it would fall to the page: it goes to the heading instead,
  // after the dialog's own hand-back, and the toast says what happened.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  useEffect(() => {
    if (dialog || !focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [dialog]);

  // The blackouts on the trip's day, for a booking still on it. A closure
  // the previous version's reopen left behind (isStaleClosure) still has
  // the customer choosing, but if they went out anyway Travis can mark the
  // trip; telling one apart also takes the closure's record. And a booking
  // with no closure on a departure Travis closed (left booked, closed from
  // MCP, or paid for after it closed) didn't go out: like one waiting on a
  // closure, it stays movable and cancellable after its date, and is only
  // marked if it went out after all (ranAnyway below), as the server
  // checks. Unless that's a closure still in its undo window (or going
  // out) that cancels them or offers a new date: its
  // blackout goes up when Travis confirms, but nobody is left booked, so
  // that's `closing`, read from the covering blackouts' closure actions as
  // the dashboard does (departureOff in src/lib/closed-departures.ts).
  const closureId = booking && awaitingMove(booking) ? booking.closure!.blackoutId : null;
  const onTrip = !!booking && (goingAhead(booking) || awaitingMove(booking));
  const tripDate = booking?.date;
  const tripSlot = booking?.timeSlot;
  const dayKey = onTrip ? `${closureId ?? '-'} ${tripDate} ${tripSlot}` : null;
  const [day, setDay] = useState<{
    key: string;
    stale: boolean;
    closed: boolean;
    closing: { choice: 'offer' | 'cancel'; sending: boolean } | null;
  } | null>(null);
  useEffect(() => {
    if (!onTrip || !tripDate || !tripSlot) return;
    let left = false;
    Promise.all([listBlackoutsBetween(tripDate, tripDate), closureId ? getClosureAction(closureId) : null])
      .then(async ([blackouts, action]) => {
        const covering = blackouts.filter((bo) => departureClosed(tripSlot, [bo]));
        // Couldn't tell: it reads as left booked, which still hides Mark.
        const actions = await Promise.all(covering.map((bo) => getClosureAction(bo.id).catch(() => null)));
        const going = actions.find(
          (a) => !!a && (a.state === 'pending' || a.state === 'finalizing') && a.choice !== 'keep',
        );
        if (left) return;
        setDay({
          key: `${closureId ?? '-'} ${tripDate} ${tripSlot}`,
          stale: !!closureId && isStaleClosure(tripSlot, blackouts, action),
          closed: covering.length > 0,
          closing: going && going.choice !== 'keep' ? { choice: going.choice, sending: going.state === 'finalizing' } : null,
        });
      })
      // Couldn't tell: the mark buttons stay hidden for a closure, and show
      // otherwise (the server still turns a closed departure away).
      .catch(() => {});
    return () => {
      left = true;
    };
  }, [onTrip, closureId, tripDate, tripSlot]);
  const dayKnown = !!dayKey && day?.key === dayKey;
  const staleClosure = dayKnown && day.stale;
  const onClosedDeparture = dayKnown && day.closed && !!booking && goingAhead(booking) && !booking.closure;
  const callingOff = onClosedDeparture && day.closing ? day.closing : null;
  const closedBooked = onClosedDeparture && !callingOff;

  // The mark buttons go by the clock: no-show once the trip has left,
  // completed once it's back. Nothing else re-renders the page then, so
  // until it can be marked completed, look again every half minute and
  // whenever the page comes back into view (a tab left open from the night
  // before), and they turn up without a reload.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!booking || booking.date < marinaNow().date || !goingAhead(booking) || callingOff || canMarkCompleted(booking, staleClosure)) return;
    const tick = () => setClock((n) => n + 1);
    const t = window.setTimeout(tick, 30_000);
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [booking, clock, staleClosure, callingOff]);

  if (booking === undefined) {
    return (
      <div className="bg-white rounded-2xl border border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
        Loading booking…
      </div>
    );
  }
  if (booking === null) {
    return (
      <div className="bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 rounded-2xl p-6">
        <h2 className="font-display text-xl">Couldn’t open this booking</h2>
        <p className="mt-2 text-sm">
          It may have been deleted, or you’ve been signed out. Pull down to
          refresh the page. If that doesn’t work, sign out and sign back in.
        </p>
      </div>
    );
  }

  const b = booking;
  const firstName = b.customerName.split(' ')[0] || b.customerName;
  const tour = tours.find((t) => t.slug === b.tourId);
  const legacy = isLegacy(b);
  const active = b.status === 'confirmed' || b.status === 'pending-payment';
  // Cancelling or moving only makes sense before the tour has gone, or on a
  // departure Travis closed: while the customer is still choosing they have
  // until after the closed date, and moving or cancelling it settles it; one
  // he left booked didn't go out, so it's how he gives them a new date or
  // their money back, however long after.
  const changeable = active && (b.date >= marinaNow().date || awaitingMove(b) || closedBooked);
  // No-show once the departure has left, completed once it's back, as the
  // server checks (it turns away any departure a blackout covers).
  const markable = canMarkAfterTour(b, staleClosure, onClosedDeparture);
  const completable = canMarkCompleted(b, staleClosure, onClosedDeparture);
  // On a departure he closed and left them booked on, a trip that went out
  // after all (the weather cleared) is marked here on its own, once it has
  // left, with a confirm that says so: reopening the day would reopen every
  // trip it closed. The server takes it with `ranAnyway`, unless a closing
  // of the departure is still in its undo window or going out.
  const ranAnyway = closedBooked && canMarkAfterTour(b);
  const ranAnywayBack = ranAnyway && canMarkCompleted(b);
  const backAt = tour ? departureTimes(tour, b.date).end : null;
  const pastConfirmed = b.status === 'confirmed' && !changeable;
  const oldUnpaid = b.status === 'pending-payment' && !changeable && !markable;
  const owedByHand = b.status === 'cancelled' && (b.manualRefundCents ?? 0) > 0;
  // Whether resetting the links emails them the new ones, as the server
  // decides it: the confirmation, the "pick a new date" email while they
  // can still choose, or after the trip the photos email if one went. No
  // confirmation for a departure he closed: it would say the trip's on.
  const resendable = canResendConfirmation(b) && !onClosedDeparture;
  // "Erase personal details", as the server allows it (erasable in
  // functions/src/lib/admin-erase.ts): cancelled, marked, or its date has
  // passed, and not while they can still pick a new date.
  const erasable =
    !b.erasedAt &&
    (b.status === 'cancelled' ||
      (!b.closure && (b.status === 'completed' || b.status === 'no-show' || b.date < marinaNow().date)));
  const resetEmailsThem =
    resendable ||
    (awaitingMove(b) && !!b.closure && b.closure.decideBy >= marinaNow().date) ||
    (!!b.photosSentAt && b.date < marinaNow().date && onTheBoat(b));

  async function doMark(status: 'completed' | 'no-show', despiteClosure = false) {
    const ok = confirm(
      despiteClosure
        ? 'Did this trip go out after all, though you closed it?\n\n' +
            (status === 'completed'
              ? `If it did, ${b.customerName}’s tour is marked completed, like any trip that ran.`
              : `If it did, ${b.customerName} is marked a no-show: they didn’t turn up. No money is refunded and nobody is emailed.`) +
            ' Any other trips you closed that day stay closed. This can’t be undone.'
        : status === 'completed'
          ? `Mark ${b.customerName}’s tour as completed?\n\nThis can’t be undone.`
          : `Mark ${b.customerName} as a no-show?\n\nUse this when they didn’t turn up. No money is refunded and nobody is emailed. This can’t be undone.`,
    );
    if (!ok) return;
    setBusyMark(status);
    setFlash(null);
    try {
      await admin.markBooking(b.id, status, despiteClosure);
      setFlash({ kind: 'ok', message: status === 'completed' ? 'Marked as completed.' : 'Marked as a no-show.' });
    } catch (err) {
      setFlash({ kind: 'err', message: errorText(err, 'That didn’t save. Try again in a minute.') });
    } finally {
      setBusyMark(null);
    }
  }

  async function doManualRefund() {
    const amount = formatPrice(b.manualRefundCents ?? 0);
    const ok = confirm(
      `Have you refunded ${amount} to ${b.customerName || 'the customer'} yourself, in Stripe or on the old website?\n\n` +
        'This only records it: no money moves. Their booking page will say it’s been refunded. This can’t be undone.',
    );
    if (!ok) return;
    setBusyMark('refund-by-hand');
    setFlash(null);
    try {
      await admin.recordManualRefund(b.id);
      setFlash({ kind: 'ok', message: `Recorded: ${amount} refunded by hand.` });
    } catch (err) {
      setFlash({ kind: 'err', message: errorText(err, 'That didn’t save. Try again in a minute.') });
    } finally {
      setBusyMark(null);
    }
  }

  async function doResetLinks() {
    const ok = confirm(
      `Reset ${firstName}’s booking links?\n\n` +
        'Use this when an email went to the wrong person. Every link sent so far stops working: their booking page, ' +
        'the calendar download, the photo gallery, the feedback link in their “thanks for coming” email, and the ' +
        'waiver links, including any they forwarded to their group. Waivers already signed stay signed.\n\n' +
        (!b.customerEmail
          ? 'Nothing is emailed: there’s no email address on the booking.'
          : resetEmailsThem
            ? `We email the new links to ${b.customerEmail}.`
            : 'Nothing is emailed: there’s no confirmation, “pick a new date” or photos email to send for this booking now.'),
    );
    if (!ok) return;
    setBusyMark('reset-links');
    setFlash(null);
    try {
      const { email } = await admin.resetBookingLinks(b.id);
      const what = (kind: 'confirmation' | 'closureOffer' | 'photos') =>
        kind === 'confirmation' ? 'their confirmation' : kind === 'photos' ? 'their photos email' : 'the “pick a new date” email';
      // The reset doesn't send "thanks for coming" again, so its feedback
      // link is left on the old token.
      const feedback = b.postTourFollowupSentAt
        ? ` The feedback link in their “thanks for coming” email stopped working too. ${
            followupAllowed(b) ? 'Send that email again if they need it.' : 'Call them if they need it.'
          }`
        : '';
      if (email.outcome === 'sent') {
        setFlash({ kind: 'ok', message: `Links reset. The old ones no longer work, and ${what(email.kind)} with the new ones went to ${email.to}.${feedback}` });
      } else if (email.outcome === 'skipped') {
        setFlash({ kind: 'ok', message: `Links reset. The old ones no longer work. Nothing was emailed. ${email.reason}${feedback}` });
      } else {
        setFlash({
          kind: 'err',
          message:
            `Links reset, so the old ones no longer work, but ${what(email.kind)} with the new ones didn’t go to ${email.to}. ${email.reason} ` +
            (email.kind === 'confirmation' ? 'Try “Email the confirmation again”, or call them.' : 'Call or text them.') +
            feedback,
        });
      }
    } catch (err) {
      setFlash({ kind: 'err', message: errorText(err, 'That didn’t work. Try again in a minute.') });
    } finally {
      setBusyMark(null);
    }
  }

  async function doResend() {
    if (!confirm(`Email the booking confirmation to ${b.customerEmail} again?`)) return;
    setBusyMark('resend');
    setFlash(null);
    try {
      await admin.resendConfirmation(b.id);
      setFlash({ kind: 'ok', message: `Confirmation emailed to ${b.customerEmail}.` });
    } catch (err) {
      setFlash({ kind: 'err', message: errorText(err, 'The email didn’t send. Try again in a minute.') });
    } finally {
      setBusyMark(null);
    }
  }

  async function doFollowup() {
    const again = b.postTourFollowupSentAt ? '\n\nThey may already have had one.' : '';
    if (!confirm(`Send ${firstName} the “thanks for coming” email (with the review link) at ${b.customerEmail}?${again}`)) return;
    setBusyMark('followup');
    setFlash(null);
    try {
      const result = await admin.sendPostTourFollowup(b.id, true);
      setFlash(
        result.sent
          ? { kind: 'ok', message: `Thank-you email sent to ${b.customerEmail}.` }
          : { kind: 'err', message: FOLLOWUP_SKIPPED[result.skipped ?? ''] ?? 'Not sent.' },
      );
    } catch (err) {
      setFlash({ kind: 'err', message: errorText(err, 'The email didn’t send. Try again in a minute.') });
    } finally {
      setBusyMark(null);
    }
  }

  const phoneDigits = b.customerPhone.replace(/[^\d+]/g, '');
  const bounces = emailBounces(b);

  return (
    <div className="space-y-5 pb-24">
      <Toast flash={flash} onClose={() => setFlash(null)} />

      <header className={clsx(panelClass, 'overflow-hidden')}>
        <div className="flex flex-wrap items-start gap-4 p-5">
          <DateTile iso={b.date} size="md" />
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-xs text-[var(--color-ink-soft)]">
              {legacy && b.legacy
                ? `Old website booking #${b.legacy.bookingId}`
                : `Booking ref ${b.id}`}
            </p>
            <h1 ref={headingRef} tabIndex={-1} className="text-display text-[1.75rem] sm:text-[2.25rem] leading-tight break-words outline-none">
              {b.customerName || (b.erasedAt ? 'Personal details erased' : 'No name given')}
            </h1>
            <p className="mt-1.5 font-semibold">
              {formatFriendlyDate(b.date)}
              {' · '}
              {tour
                ? `${departureTimes(tour, b.date).start} – ${departureTimes(tour, b.date).end}`
                : slotLabel(b.timeSlot)}
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              {b.tourName} · {typeLabel(b.type)} · {partySize(b)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(b)} size="md">
              {statusLabel(b)}
            </Badge>
            {bounces.length > 0 && (
              <Badge tone="alert" size="md">
                Email bounced
              </Badge>
            )}
          </div>
        </div>

        {/* One-tap contact — the thing Travis does most from his phone. */}
        {(phoneDigits || b.customerEmail) && (
          <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-line)] bg-[var(--color-paper)]/70 p-3 sm:px-5">
            {phoneDigits && (
              <ContactBtn href={`tel:${phoneDigits}`}>
                <Phone size={16} /> Call
              </ContactBtn>
            )}
            {phoneDigits && (
              <ContactBtn href={`sms:${phoneDigits}`}>
                <Chat size={16} /> Text
              </ContactBtn>
            )}
            {b.customerEmail && (
              <ContactBtn href={`mailto:${b.customerEmail}`}>
                <Mail size={16} /> Email
              </ContactBtn>
            )}
          </div>
        )}
      </header>

      {bounces.length > 0 && (
        <div role="alert" className="rounded-2xl bg-[var(--color-error)]/[0.08] border border-[var(--color-error)]/40 p-4 text-sm">
          <p className="font-semibold text-[var(--color-error)]">
            {bounces.length === 1 ? 'An email to' : 'Emails to'} {firstName} bounced.
          </p>
          <ul className="mt-1.5 space-y-1">
            {bounces.map((x) => (
              <li key={x.kind}>
                <span className="font-medium first-letter:uppercase inline-block">{x.label}</span>
                {' to '}
                <span className="break-all">{x.to}</span>
                {x.permanent ? ' (the address doesn’t work)' : ' (their mail server turned it away for now)'}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Call or text them for the right address, then fix it here and the emails go out again.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            {phoneDigits && (
              <a href={`tel:${phoneDigits}`} className={buttonClass('contact')}>
                <Phone size={16} /> Call {firstName}
              </a>
            )}
            <button type="button" onClick={() => setDialog('fix-email')} className={buttonClass('primary')}>
              Fix email and resend
            </button>
          </div>
        </div>
      )}

      {awaitingMove(b) && b.closure && (
        <div role="status" className="rounded-2xl bg-[var(--color-buoy)]/15 border border-[var(--color-buoy)]/40 p-4 text-sm">
          <p className="font-semibold">You closed this departure ({b.closure.reason.toLowerCase()}).</p>
          <p className="mt-1">
            {/* No offerEmailedAt: Resend refused it as the closure went out
                (sendClosureRemindersHourly sends it again), or there's no
                address to send it to. */}
            {b.closure.offerEmailedAt
              ? `${b.customerName || 'The customer'} was emailed to pick a new date or take a full refund on their booking page.`
              : b.customerEmail
                ? `The email asking ${b.customerName || 'the customer'} to pick a new date or take a full refund on their booking page wasn’t sent. It’s tried again within the hour; call or text them to be sure.`
                : `${b.customerName || 'The customer'} wasn’t emailed to pick a new date or take a full refund: there’s no email on file, so call them.`}{' '}
            {b.closure.refundRefused ? (
              <>
                Moving it with Reschedule settles it, or, once the money has gone back to them in Stripe (a dispute or
                a refund there), Cancel booking with &ldquo;Refund handled in Stripe&rdquo;.
              </>
            ) : (
              <>
                If they haven&rsquo;t by {formatFriendlyDate(b.closure.decideBy)}, it&rsquo;s cancelled and refunded
                automatically{isLegacy(b) ? ' (paid on the old website, so you’ll refund it yourself)' : ''}. Moving it
                with Reschedule settles it too.
              </>
            )}
          </p>
          {b.closure.refundRefused && (
            <p className="mt-1 font-semibold text-[var(--color-coral-dark)]">
              Refund failed: when the deadline passed, Stripe turned down their{' '}
              {formatPrice(b.closure.refundRefused.refundCents)}{' '}refund
              (&ldquo;{b.closure.refundRefused.stripeMessage}&rdquo;). Nothing was cancelled or refunded, and they
              haven&rsquo;t been told: call them. Stripe&rsquo;s dashboard shows why it can&rsquo;t be refunded.
            </p>
          )}
          {staleClosure && (
            <p className="mt-1">
              This day was reopened, so this booking is still choosing a new date or a refund. If they went out,{' '}
              {markable ? 'mark it below' : 'mark it once the trip has left'}{' '}and the automatic refund won&rsquo;t happen.
            </p>
          )}
        </div>
      )}

      {callingOff && (
        <div role="status" className="rounded-2xl bg-[var(--color-buoy)]/15 border border-[var(--color-buoy)]/40 p-4 text-sm">
          <p className="font-semibold">
            {callingOff.sending
              ? 'You’re calling off this departure. It’s going out now.'
              : 'You’re calling off this departure. The undo time is still open.'}
          </p>
          <p className="mt-1">
            {/* As Close a day's review put it: an old-site payment is his to
                refund, and with no email on file the site can't tell them. */}
            {callingOff.choice === 'cancel'
              ? `${firstName}’s booking is cancelled${legacy || b.amountPaidCents <= b.amountRefundedCents ? '' : ' and refunded in full'}`
              : b.customerEmail
                ? `${firstName} is emailed to pick a new date or take a full refund`
                : `${firstName} is offered a new date or a full refund`}
            {callingOff.sending
              ? ', with everyone else on it.'
              : ' when it’s up, with everyone else on it. To keep the trip going, undo it from the banner on Close a day or the dashboard.'}{' '}
            {legacy &&
              b.amountPaidCents > b.amountRefundedCents &&
              (callingOff.choice === 'cancel'
                ? 'They paid on the old website, so you’ll refund that yourself. '
                : 'They paid on the old website: if they take the refund or don’t choose in time, you refund it yourself. ')}
            {!b.customerEmail && 'There’s no email on file, so the site can’t tell them: call them. '}
            Leave this booking to the closure: cancelling it here sends the plain cancellation email instead of the closure&rsquo;s.
          </p>
        </div>
      )}

      {closedBooked && (
        <div role="status" className="rounded-2xl bg-[var(--color-buoy)]/15 border border-[var(--color-buoy)]/40 p-4 text-sm">
          <p className="font-semibold">You closed this departure and left {firstName} booked on it.</p>
          <p className="mt-1">
            Their booking page says you&rsquo;ll be in touch.{' '}
            {ranAnyway ? 'If it went out after all, mark it below. If it didn’t, move it' : 'Move it'} to another day, or
            cancel it to refund them in full{legacy ? ' (paid on the old website, so you’ll refund it yourself)' : ''},
            even once the date has passed.
            {/* The server won't reopen a day while a trip it closed has left
                with someone still booked on it (assertReopenable). */}
            {!ranAnyway &&
              ' If it goes ahead after all, reopen it under Close a day first. If another trip it closed has already left with people still booked on it, the day won’t reopen until you’ve marked, moved or cancelled them; or run this one anyway and mark it here once it has left.'}
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Customer">
          <dl className="divide-y divide-[var(--color-line)] text-sm">
            <Row label="Name" value={b.customerName || '—'} />
            <Row label="Phone" value={b.customerPhone ? <a href={`tel:${phoneDigits}`} className="text-[var(--color-brand-blue)] underline underline-offset-4">{b.customerPhone}</a> : '—'} />
            <Row label="Email" value={b.customerEmail ? <a href={`mailto:${b.customerEmail}`} className="text-[var(--color-brand-blue)] underline underline-offset-4 break-all">{b.customerEmail}</a> : '—'} />
            <Row
              label="Emergency contact"
              value={
                b.emergencyContactName || b.emergencyContactPhone ? (
                  <>
                    {b.emergencyContactName}
                    {b.emergencyContactPhone && (
                      <>
                        {' · '}
                        <a href={`tel:${b.emergencyContactPhone.replace(/[^\d+]/g, '')}`} className="text-[var(--color-brand-blue)] underline underline-offset-4">
                          {b.emergencyContactPhone}
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  'Not given'
                )
              }
            />
          </dl>
          {/* Their checkout sends them back with the token it was given, so not until it's paid. */}
          {!stillPaying(b) && (
            <button
              type="button"
              onClick={doResetLinks}
              disabled={busyMark !== null}
              className={clsx(buttonClass('secondary', 'sm'), 'mt-4')}
            >
              {busyMark === 'reset-links' ? 'Resetting…' : 'Reset their booking links'}
            </button>
          )}
        </Card>

        <Card title="Money">
          <dl className="divide-y divide-[var(--color-line)] text-sm">
            <Row label="Paid" value={formatPrice(b.amountPaidCents)} />
            {b.amountRefundedCents > 0 && (
              <Row
                label="Refunded"
                value={<span className="text-[var(--color-coral-dark)]">−{formatPrice(b.amountRefundedCents)}</span>}
              />
            )}
            <Row label="Payment" value={paymentLabel(b)} />
          </dl>
          {legacy && (
            <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
              Paid on the old website, so this site can’t refund it. Refunds
              for this booking have to be done in Stripe or the old site.
            </p>
          )}
          {b.stripePaymentIntentId && !legacy && (
            <p className="mt-3 text-xs text-[var(--color-ink-soft)] break-all">
              Stripe payment {b.stripePaymentIntentId}
            </p>
          )}
        </Card>

        <Card title={`Who’s coming (${partySize(b)})`} className="lg:col-span-2">
          {b.guests.length > 0 ? (
            <ol className="text-sm space-y-1 list-decimal list-inside">
              {b.guests.map((g, i) => (
                <li key={i}>
                  {g.name}
                  {g.age != null && (
                    <span className="text-[var(--color-ink-soft)]"> (age {g.age})</span>
                  )}
                  {g.wetsuitSize && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-[var(--color-brand-blue)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-brand-blue)]">
                      {g.wetsuitSize === NO_WETSUIT ? 'Not swimming' : `Wetsuit ${g.wetsuitSize}`}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">
              {legacy
                ? `The old website didn’t record guest names${b.legacy?.persons ? ` (it said: ${b.legacy.persons})` : ''}.`
                : 'No guest names yet.'}
            </p>
          )}
        </Card>

        <BookingWaivers booking={b} closedBooked={closedBooked} callingOff={!!callingOff} />

        <Card title="Private notes" className="lg:col-span-2">
          {b.adminNotes ? (
            <p className="text-sm whitespace-pre-wrap">{b.adminNotes}</p>
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">Nothing yet.</p>
          )}
          {/* The 8 PM crew email (functions/src/lib/crew-templates.ts) prints them for each booking. */}
          <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
            Customers never see these notes. The crew do: they&rsquo;re in the 8 PM crew email the night before the trip.
          </p>
          <button
            type="button"
            onClick={() => setDialog('note')}
            className={clsx(buttonClass('secondary', 'sm'), 'mt-4')}
          >
            {b.adminNotes ? 'Edit notes' : 'Add a note'}
          </button>
        </Card>

        {feedbackItems.length > 0 && (
          <Card title="Private feedback" className="lg:col-span-2">
            <ul className="divide-y divide-[var(--color-line)] text-sm">
              {feedbackItems.map((f) => (
                <li key={f.id} className="py-3 first:pt-0 last:pb-0">
                  {f.createdAt && (
                    <p className="text-xs text-[var(--color-ink-soft)]">{marinaDate(f.createdAt)}</p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap break-words">{f.message}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
              Sent from the link in their thank-you email. Only you see this; replying to the email it came in answers them.
            </p>
          </Card>
        )}

        <BookingTripPhotos booking={b} />

        {b.status === 'cancelled' && (
          <Card title="Cancellation" className="lg:col-span-2">
            <dl className="divide-y divide-[var(--color-line)] text-sm">
              <Row label="Cancelled by" value={cancelledByLabel(b)} />
              {b.cancellationReason && (
                <Row
                  label="Reason"
                  value={
                    <>
                      {b.cancellationReason}
                      {b.cancellationReasonPrivate && (
                        <span className="block text-xs font-normal text-[var(--color-ink-soft)]">
                          Only you see this. It isn’t on their booking page.
                        </span>
                      )}
                    </>
                  }
                />
              )}
              <Row
                label="Refunded"
                value={b.amountRefundedCents === 0 ? 'Nothing' : formatPrice(b.amountRefundedCents)}
              />
              {owedByHand &&
                (b.manualRefundedAt ? (
                  <Row
                    label="By hand"
                    value={`${formatPrice(b.manualRefundCents!)} refunded by hand on ${marinaDate(b.manualRefundedAt)}`}
                  />
                ) : (
                  <Row
                    label="Owed back"
                    value={
                      <span className="text-[var(--color-coral-dark)]">
                        {formatPrice(b.manualRefundCents!)} to refund by hand in Stripe (paid on the old website)
                      </span>
                    }
                  />
                ))}
            </dl>
            {owedByHand && !b.manualRefundedAt && (
              <button
                type="button"
                onClick={doManualRefund}
                disabled={busyMark !== null}
                className={clsx(buttonClass('secondary', 'sm'), 'mt-4')}
              >
                {busyMark === 'refund-by-hand' ? 'Saving…' : 'Refunded by hand'}
              </button>
            )}
          </Card>
        )}

        {legacy && b.legacy && (
          <Card title="From the old website" className="lg:col-span-2">
            <dl className="divide-y divide-[var(--color-line)] text-sm">
              <Row label="Booking #" value={String(b.legacy.bookingId)} />
              <Row label="Tour name" value={b.legacy.tourName} />
              {b.legacy.bookedOn && <Row label="Booked on" value={b.legacy.bookedOn} />}
              <Row label="Old status" value={b.legacy.oldStatus} />
              {b.legacy.orderIds && <Row label="Order #" value={b.legacy.orderIds} />}
              {b.legacy.couponCodes && <Row label="Coupon" value={b.legacy.couponCodes} />}
              {b.legacy.paymentMethod && <Row label="Paid by" value={b.legacy.paymentMethod} />}
            </dl>
          </Card>
        )}
      </div>

      {/* Actions — only the ones that make sense for this booking right now. */}
      <section className={clsx(panelClass, 'overflow-hidden divide-y divide-[var(--color-line)]')}>
        {changeable && (
          <ActionGroup title="Change this booking">
            {stillPaying(b) ? (
              // Their checkout charges what it was opened for, so the server
              // refuses edits and moves until it's paid.
              <p className="text-sm text-[var(--color-ink-soft)] sm:basis-full">
                They’re still paying online. You can change the booking once the payment has gone through.
              </p>
            ) : (
              <>
                <ActionBtn onClick={() => setDialog('edit')}>Edit guests or contact details</ActionBtn>
                <ActionBtn onClick={() => setDialog('reschedule')}>Move to another day or tour</ActionBtn>
              </>
            )}
            {canRefundHere(b) && b.amountPaidCents > b.amountRefundedCents && (
              <ActionBtn onClick={() => setDialog('partial-refund')}>Refund part of the payment</ActionBtn>
            )}
            <ActionBtn onClick={() => setDialog('cancel')} tone="danger">
              Cancel booking
            </ActionBtn>
          </ActionGroup>
        )}

        {(pastConfirmed || markable) && (
          <ActionGroup title="After the tour">
            {pastConfirmed && <ActionBtn onClick={() => setDialog('edit')}>Edit guests or contact details</ActionBtn>}
            {pastConfirmed && canRefundHere(b) && b.amountPaidCents > b.amountRefundedCents && (
              <ActionBtn onClick={() => setDialog('partial-refund')}>Refund part of the payment</ActionBtn>
            )}
            {markable && (
              <>
                {completable && (
                  <ActionBtn onClick={() => doMark('completed')} disabled={busyMark !== null}>
                    {busyMark === 'completed' ? 'Saving…' : 'Mark as completed'}
                  </ActionBtn>
                )}
                <ActionBtn onClick={() => doMark('no-show')} disabled={busyMark !== null}>
                  {busyMark === 'no-show' ? 'Saving…' : 'They didn’t show up'}
                </ActionBtn>
                {!completable && (
                  // Marked completed while it's out, the boat would go back on sale.
                  <p className="text-sm text-[var(--color-ink-soft)] sm:basis-full">
                    The tour is still out. You can mark it completed once it’s back{backAt ? `, at ${backAt}` : ''}.
                  </p>
                )}
              </>
            )}
          </ActionGroup>
        )}

        {ranAnyway && (
          <ActionGroup title="It went out after all">
            <p className="text-sm text-[var(--color-ink-soft)] sm:basis-full">
              Only if this trip ran though you closed it. Any other trips you closed that day stay closed.
              {!ranAnywayBack && ` You can mark it completed once it’s back${backAt ? `, at ${backAt}` : ''}.`}
            </p>
            {ranAnywayBack && (
              <ActionBtn onClick={() => doMark('completed', true)} disabled={busyMark !== null}>
                {busyMark === 'completed' ? 'Saving…' : 'Mark as completed'}
              </ActionBtn>
            )}
            <ActionBtn onClick={() => doMark('no-show', true)} disabled={busyMark !== null}>
              {busyMark === 'no-show' ? 'Saving…' : 'They didn’t show up'}
            </ActionBtn>
          </ActionGroup>
        )}

        <ActionGroup title="Emails and printing">
          {resendable && (
            <ActionBtn onClick={doResend} disabled={busyMark !== null}>
              {busyMark === 'resend' ? 'Sending…' : 'Email the confirmation again'}
            </ActionBtn>
          )}
          {followupAllowed(b) && (
            <ActionBtn onClick={doFollowup} disabled={busyMark !== null}>
              {busyMark === 'followup' ? 'Sending…' : 'Send “thanks for coming” email'}
            </ActionBtn>
          )}
          <a
            href={`/admin/bookings/${b.id}/manifest`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('secondary')}
          >
            Print passenger list
          </a>
        </ActionGroup>

        {erasable && (
          <ActionGroup title="If they ask to be deleted">
            <ActionBtn onClick={() => setDialog('erase')} tone="danger">
              Erase personal details
            </ActionBtn>
          </ActionGroup>
        )}
        {b.erasedAt && (
          <p className="px-5 py-4 text-sm text-[var(--color-ink-soft)]">
            Their personal details were erased on {marinaDate(b.erasedAt)}
            {b.erasedBy ? ` by ${b.erasedBy}` : ''}. What they paid, the date and their signed waivers are kept.
          </p>
        )}

        {!active && (
          <p className="px-5 py-4 text-sm text-[var(--color-ink-soft)]">
            {b.status === 'cancelled'
              ? 'This booking is cancelled, so it can’t be changed.'
              : 'This tour is finished, so the booking can’t be changed.'}
          </p>
        )}
        {oldUnpaid && (
          <p className="px-5 py-4 text-sm text-[var(--color-ink-soft)]">
            {legacy
              ? b.amountPaidCents > 0
                ? 'This date has passed. On the old website this booking had a deposit or part payment but was never marked as fully paid, so there’s nothing to do here.'
                : 'This date has passed. On the old website this booking was reserved but never paid, so there’s nothing to do here.'
              : 'This date has passed and the customer never paid, so there’s nothing to do here.'}
          </p>
        )}
      </section>

      {dialog === 'cancel' && (
        <CancelAdminDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={(message, kind) => {
            focusHeading.current = true;
            setDialog(null);
            setFlash({ kind, message });
          }}
        />
      )}
      {dialog === 'partial-refund' && (
        <PartialRefundDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={(amt) => {
            setDialog(null);
            setFlash({ kind: 'ok', message: `Refunded ${formatPrice(amt)} to ${firstName}.` });
          }}
        />
      )}
      {dialog === 'edit' && (
        <EditBookingDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Booking updated.' });
          }}
        />
      )}
      {dialog === 'reschedule' && (
        <RescheduleAdminDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={(message, kind) => {
            setDialog(null);
            setFlash({ kind, message });
          }}
        />
      )}
      {dialog === 'fix-email' && (
        <FixEmailDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setFlash({ kind: 'ok', message });
          }}
        />
      )}
      {dialog === 'erase' && (
        <EraseBookingDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            focusHeading.current = true;
            setDialog(null);
            setFlash({ kind: 'ok', message });
          }}
        />
      )}
      {dialog === 'note' && (
        <NoteDialog
          booking={b}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Note saved.' });
          }}
        />
      )}
    </div>
  );
}

/**
 * Pinned to the bottom of the screen so it's seen wherever Travis has
 * scrolled. The status region is always there, so good news put in it is
 * read out (one inserted already filled often isn't); a problem is an
 * alert, which is read out as it appears.
 */
function Toast({ flash, onClose }: { flash: Flash | null; onClose: () => void }) {
  const box = flash && (
    <div
      className={clsx(
        'rounded-2xl px-4 py-3 text-sm shadow-2xl border flex items-start gap-3',
        flash.kind === 'ok'
          ? 'bg-[var(--color-spring-deep)] text-white border-transparent'
          : 'bg-white text-[var(--color-ink)] border-[var(--color-coral)]',
      )}
    >
      <p className="flex-1 pt-0.5">{flash.message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="-m-1 w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-full hover:bg-black/10"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
  return (
    <div className="fixed z-40 inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:w-96">
      <div role="status">{flash?.kind === 'ok' && box}</div>
      {flash?.kind === 'err' && <div role="alert">{box}</div>}
    </div>
  );
}

/** "Oct 21, 2026", marina time. */
function marinaDate(ts: { seconds: number }): string {
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx(panelClass, 'overflow-hidden', className)}>
      <PanelHeader as="h3" title={title} />
      <PanelBody>{children}</PanelBody>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function ContactBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={clsx(buttonClass('contact'), 'h-12')}>
      {children}
    </a>
  );
}

function ActionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <h3 className="font-display text-base mb-3">{title}</h3>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        tone === 'danger'
          ? 'inline-flex items-center justify-center min-h-11 px-5 rounded-[10px] text-[0.9375rem] font-semibold transition-colors ' +
            'border border-[var(--color-coral)]/40 bg-[var(--color-coral)]/[0.06] text-[var(--color-coral-dark)] ' +
            'hover:bg-[var(--color-coral)] hover:text-white hover:border-[var(--color-coral)] ' +
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-coral)] ' +
            'disabled:opacity-60 disabled:cursor-not-allowed'
          : buttonClass('secondary')
      }
    >
      {children}
    </button>
  );
}
