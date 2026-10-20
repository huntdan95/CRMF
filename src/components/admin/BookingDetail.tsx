'use client';

import { useEffect, useState } from 'react';
import {
  adminAuthReady,
  subscribeBooking,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import { departureTimes, formatPrice, tours } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { marinaNow } from '@/lib/availability';
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
  emailBounces,
  followupAllowed,
  isLegacy,
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
import { Badge, DateTile, PanelBody, PanelHeader, buttonClass, panelClass } from './ui';
import { BookingWaivers } from './BookingWaivers';

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
  | 'fix-email';

type Flash = { kind: 'ok' | 'err'; message: string };

const FOLLOWUP_SKIPPED: Record<string, string> = {
  'not-yet': 'Not sent: the tour hasn’t happened yet.',
  'too-old': 'Not sent: the tour was too long ago.',
  'not-confirmed': 'Not sent: this booking isn’t confirmed or completed.',
  'already-sent': 'Not sent: they’ve already had one.',
  'not-found': 'Not sent: booking not found.',
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

  // Good news fades on its own; problems stay until Travis closes them.
  useEffect(() => {
    if (flash?.kind !== 'ok') return;
    const t = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

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
  // departure Travis closed while the customer is still choosing: they have
  // until after the closed date, and moving or cancelling it settles it.
  const changeable = active && (b.date >= marinaNow().date || awaitingMove(b));
  // No-show once the departure has left, completed once it's back, as the
  // server checks.
  const markable = canMarkAfterTour(b);
  const completable = canMarkCompleted(b);
  const backAt = tour ? departureTimes(tour, b.date).end : null;
  const pastConfirmed = b.status === 'confirmed' && !changeable;
  const oldUnpaid = b.status === 'pending-payment' && !changeable && !markable;
  const owedByHand = b.status === 'cancelled' && (b.manualRefundCents ?? 0) > 0;
  // Whether resetting the links emails them the new ones, as the server
  // decides it: the confirmation, or the "pick a new date" email while
  // they can still choose.
  const resetEmailsThem =
    canResendConfirmation(b) || (awaitingMove(b) && !!b.closure && b.closure.decideBy >= marinaNow().date);

  async function doMark(status: 'completed' | 'no-show') {
    const ok = confirm(
      status === 'completed'
        ? `Mark ${b.customerName}’s tour as completed?\n\nThis can’t be undone.`
        : `Mark ${b.customerName} as a no-show?\n\nUse this when they didn’t turn up. No money is refunded and nobody is emailed. This can’t be undone.`,
    );
    if (!ok) return;
    setBusyMark(status);
    setFlash(null);
    try {
      await admin.markBooking(b.id, status);
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
        'the calendar download, and the waiver links, including any they forwarded to their group. Waivers already ' +
        'signed stay signed.\n\n' +
        (!b.customerEmail
          ? 'Nothing is emailed: there’s no email address on the booking.'
          : resetEmailsThem
            ? `We email the new links to ${b.customerEmail}.`
            : 'Nothing is emailed: there’s no confirmation or “pick a new date” email to send for this booking now.'),
    );
    if (!ok) return;
    setBusyMark('reset-links');
    setFlash(null);
    try {
      const { email } = await admin.resetBookingLinks(b.id);
      const what = (kind: 'confirmation' | 'closureOffer') =>
        kind === 'confirmation' ? 'their confirmation' : 'the “pick a new date” email';
      if (email.outcome === 'sent') {
        setFlash({ kind: 'ok', message: `Links reset. The old ones no longer work, and ${what(email.kind)} with the new ones went to ${email.to}.` });
      } else if (email.outcome === 'skipped') {
        setFlash({ kind: 'ok', message: `Links reset. The old ones no longer work. Nothing was emailed. ${email.reason}` });
      } else {
        setFlash({
          kind: 'err',
          message:
            `Links reset, so the old ones no longer work, but ${what(email.kind)} with the new ones didn’t go to ${email.to}. ${email.reason} ` +
            (email.kind === 'confirmation' ? 'Try “Email the confirmation again”, or call them.' : 'Call or text them.'),
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
      {flash && <Toast flash={flash} onClose={() => setFlash(null)} />}

      <header className={clsx(panelClass, 'overflow-hidden')}>
        <div className="flex flex-wrap items-start gap-4 p-5">
          <DateTile iso={b.date} size="md" />
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-xs text-[var(--color-ink-soft)]">
              {legacy && b.legacy
                ? `Old website booking #${b.legacy.bookingId}`
                : `Booking ref ${b.id}`}
            </p>
            <h1 className="text-display text-[1.75rem] sm:text-[2.25rem] leading-tight break-words">
              {b.customerName || 'No name given'}
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
            {b.customerName || 'The customer'} was emailed to pick a new date or take a full refund on their booking
            page. If they haven&rsquo;t by {formatFriendlyDate(b.closure.decideBy)}, it&rsquo;s cancelled and refunded
            automatically{isLegacy(b) ? ' (paid on the old website, so you’ll refund it yourself)' : ''}. Moving it with
            Reschedule settles it too.
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

        <BookingWaivers booking={b} />

        <Card title="Private notes" className="lg:col-span-2">
          {b.adminNotes ? (
            <p className="text-sm whitespace-pre-wrap">{b.adminNotes}</p>
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">
              Nothing yet. Customers never see these notes.
            </p>
          )}
          <button
            type="button"
            onClick={() => setDialog('note')}
            className={clsx(buttonClass('secondary', 'sm'), 'mt-4')}
          >
            {b.adminNotes ? 'Edit notes' : 'Add a note'}
          </button>
        </Card>

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

        <ActionGroup title="Emails and printing">
          {canResendConfirmation(b) && (
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
          onDone={(message) => {
            setDialog(null);
            setFlash({ kind: 'ok', message });
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
          onDone={(message) => {
            setDialog(null);
            setFlash({ kind: 'ok', message });
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

/** Pinned to the bottom of the screen so it's seen wherever Travis has scrolled. */
function Toast({ flash, onClose }: { flash: Flash; onClose: () => void }) {
  return (
    <div
      role={flash.kind === 'err' ? 'alert' : 'status'}
      className={clsx(
        'fixed z-40 inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:w-96 rounded-2xl px-4 py-3 text-sm shadow-2xl border flex items-start gap-3',
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
