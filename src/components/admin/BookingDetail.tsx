'use client';

import { useEffect, useState } from 'react';
import {
  adminAuthReady,
  subscribeBooking,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import { formatPrice, tours } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { marinaNow } from '@/lib/availability';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import {
  STATUS_CLASS,
  canRefundHere,
  followupAllowed,
  isLegacy,
  partySize,
  paymentLabel,
  slotLabel,
  statusLabel,
  tourDayReached,
  typeLabel,
} from './booking-labels';
import { CancelAdminDialog } from './dialogs/CancelAdminDialog';
import { PartialRefundDialog } from './dialogs/PartialRefundDialog';
import { EditBookingDialog } from './dialogs/EditBookingDialog';
import { RescheduleAdminDialog } from './dialogs/RescheduleAdminDialog';
import { NoteDialog } from './dialogs/NoteDialog';

interface Props {
  bookingId: string;
}

type DialogKind =
  | null
  | 'cancel'
  | 'partial-refund'
  | 'edit'
  | 'reschedule'
  | 'note';

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
    'completed' | 'no-show' | 'resend' | 'followup' | null
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
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 p-8 text-center text-sm text-[var(--color-ink-soft)] animate-pulse">
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
  const dayReached = tourDayReached(b);
  // Cancelling or moving only makes sense before the tour has gone.
  const upcoming = active && b.date >= marinaNow().date;
  const oldUnpaid = b.status === 'pending-payment' && !upcoming;

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

  return (
    <div className="space-y-5 pb-24">
      {flash && <Toast flash={flash} onClose={() => setFlash(null)} />}

      {/* Header */}
      <header className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-[var(--color-ink-soft)]">
            {legacy && b.legacy
              ? `Old website booking #${b.legacy.bookingId}`
              : `Booking ref ${b.id}`}
          </p>
          <h1 className="text-display text-[1.75rem] sm:text-[2.25rem] leading-tight">
            {b.customerName || 'No name given'}
          </h1>
          <p className="mt-1 font-medium">
            {formatFriendlyDate(b.date)}
            {' · '}
            {tour ? `${tour.startTimeDisplay} – ${tour.endTimeDisplay}` : slotLabel(b.timeSlot)}
          </p>
          <p className="text-sm text-[var(--color-ink-soft)]">
            {b.tourName} · {typeLabel(b.type)} · {partySize(b)}
          </p>
        </div>
        <span
          className={clsx(
            'self-start inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
            STATUS_CLASS[b.status],
          )}
        >
          {statusLabel(b)}
        </span>
      </header>

      {/* One-tap contact — the thing Travis does most from his phone. */}
      {(phoneDigits || b.customerEmail) && (
        <div className="grid grid-cols-3 gap-2">
          {phoneDigits && <ContactBtn href={`tel:${phoneDigits}`}>Call</ContactBtn>}
          {phoneDigits && <ContactBtn href={`sms:${phoneDigits}`}>Text</ContactBtn>}
          {b.customerEmail && <ContactBtn href={`mailto:${b.customerEmail}`}>Email</ContactBtn>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Customer">
          <dl className="space-y-2 text-sm">
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
        </Card>

        <Card title="Money">
          <dl className="space-y-2 text-sm">
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
                      Wetsuit {g.wetsuitSize}
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
            className="mt-3 inline-flex items-center px-4 py-2.5 rounded-[10px] text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
          >
            {b.adminNotes ? 'Edit notes' : 'Add a note'}
          </button>
        </Card>

        {b.status === 'cancelled' && (
          <Card title="Cancellation" className="lg:col-span-2">
            <dl className="space-y-2 text-sm">
              <Row label="Cancelled by" value={b.cancelledBy === 'admin' ? 'You' : b.cancelledBy === 'customer' ? 'The customer' : '—'} />
              {b.cancellationReason && <Row label="Reason" value={b.cancellationReason} />}
              <Row
                label="Refunded"
                value={b.amountRefundedCents === 0 ? 'Nothing' : formatPrice(b.amountRefundedCents)}
              />
            </dl>
          </Card>
        )}

        {legacy && b.legacy && (
          <Card title="From the old website" className="lg:col-span-2">
            <dl className="space-y-2 text-sm">
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
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 space-y-5">
        {upcoming && (
          <ActionGroup title="Change this booking">
            <ActionBtn onClick={() => setDialog('edit')}>Edit guests or contact details</ActionBtn>
            <ActionBtn onClick={() => setDialog('reschedule')}>Move to another day or tour</ActionBtn>
            {canRefundHere(b) && b.amountPaidCents > b.amountRefundedCents && (
              <ActionBtn onClick={() => setDialog('partial-refund')}>Refund part of the payment</ActionBtn>
            )}
            <ActionBtn onClick={() => setDialog('cancel')} tone="danger">
              Cancel booking
            </ActionBtn>
          </ActionGroup>
        )}

        {b.status === 'confirmed' && dayReached && (
          <ActionGroup title="After the tour">
            {!upcoming && <ActionBtn onClick={() => setDialog('edit')}>Edit guests or contact details</ActionBtn>}
            {!upcoming && canRefundHere(b) && b.amountPaidCents > b.amountRefundedCents && (
              <ActionBtn onClick={() => setDialog('partial-refund')}>Refund part of the payment</ActionBtn>
            )}
            <ActionBtn onClick={() => doMark('completed')} disabled={busyMark !== null}>
              {busyMark === 'completed' ? 'Saving…' : 'Mark as completed'}
            </ActionBtn>
            <ActionBtn onClick={() => doMark('no-show')} disabled={busyMark !== null}>
              {busyMark === 'no-show' ? 'Saving…' : 'They didn’t show up'}
            </ActionBtn>
          </ActionGroup>
        )}

        <ActionGroup title="Emails and printing">
          {b.status === 'confirmed' && (
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
            className="inline-flex items-center justify-center px-4 py-3 sm:py-2 rounded-[10px] text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
          >
            Print passenger list
          </a>
        </ActionGroup>

        {!active && (
          <p className="text-sm text-[var(--color-ink-soft)]">
            {b.status === 'cancelled'
              ? 'This booking is cancelled, so it can’t be changed.'
              : 'This tour is finished, so the booking can’t be changed.'}
          </p>
        )}
        {oldUnpaid && (
          <p className="text-sm text-[var(--color-ink-soft)]">
            {legacy
              ? 'This date has passed. On the old website this booking was reserved but never marked as fully paid, so there’s nothing to do here.'
              : 'This date has passed and the customer never paid, so there’s nothing to do here.'}
          </p>
        )}
      </div>

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
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Booking moved.' });
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
    <div
      className={clsx(
        'bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5',
        className,
      )}
    >
      <h3 className="font-display text-base mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function ContactBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center h-12 rounded-[10px] bg-white border border-[var(--color-ink)]/15 text-sm font-semibold text-[var(--color-brand-blue)] hover:border-[var(--color-brand-blue)]"
    >
      {children}
    </a>
  );
}

function ActionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-base mb-2">{title}</h3>
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
      className={clsx(
        'inline-flex items-center justify-center px-4 py-3 sm:py-2 rounded-[10px] text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed',
        tone === 'danger'
          ? 'bg-[var(--color-coral)]/10 text-[var(--color-coral-dark)] border border-[var(--color-coral)]/30 hover:bg-[var(--color-coral)] hover:text-white hover:border-[var(--color-coral)]'
          : 'border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
      )}
    >
      {children}
    </button>
  );
}
