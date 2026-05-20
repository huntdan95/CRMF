'use client';

import { useEffect, useState } from 'react';
import {
  adminAuthReady,
  subscribeBooking,
  type BookingDoc,
} from '@/lib/admin-firestore';
import { admin } from '@/lib/admin-client';
import { formatPrice, slotLabels, tours } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import { CancelAdminDialog } from './dialogs/CancelAdminDialog';
import { PartialRefundDialog } from './dialogs/PartialRefundDialog';
import { EditBookingDialog } from './dialogs/EditBookingDialog';
import { RescheduleAdminDialog } from './dialogs/RescheduleAdminDialog';
import { NoteDialog } from './dialogs/NoteDialog';

interface Props {
  bookingId: string;
}

const STATUS_LABEL: Record<BookingDoc['status'], string> = {
  'pending-payment': 'Pending payment',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  'no-show': 'No-show',
};

const STATUS_CLASS: Record<BookingDoc['status'], string> = {
  'pending-payment': 'bg-[var(--color-coral)]/15 text-[var(--color-coral-dark)]',
  confirmed: 'bg-[var(--color-brand-blue)]/15 text-[var(--color-brand-blue-dark)]',
  cancelled: 'bg-[var(--color-ink)]/10 text-[var(--color-ink-soft)]',
  completed: 'bg-[var(--color-manatee)]/20 text-[var(--color-ink)]',
  'no-show': 'bg-[var(--color-coral)]/10 text-[var(--color-ink-soft)]',
};

type DialogKind =
  | null
  | 'cancel'
  | 'partial-refund'
  | 'edit'
  | 'reschedule'
  | 'note';

export function BookingDetail({ bookingId }: Props) {
  const [booking, setBooking] = useState<BookingDoc | null | undefined>(undefined);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [busyMark, setBusyMark] = useState<'completed' | 'no-show' | 'resend' | null>(null);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        await adminAuthReady();
        unsub = subscribeBooking(bookingId, (b) => setBooking(b));
      } catch {
        setBooking(null);
      }
    })();
    return () => unsub();
  }, [bookingId]);

  async function doMark(status: 'completed' | 'no-show') {
    setBusyMark(status);
    setFlash(null);
    try {
      await admin.markBooking(bookingId, status);
      setFlash({ kind: 'ok', message: `Marked as ${status}.` });
    } catch (err) {
      setFlash({
        kind: 'err',
        message: err instanceof FunctionError ? err.message : 'Failed.',
      });
    } finally {
      setBusyMark(null);
    }
  }

  async function doResend() {
    setBusyMark('resend');
    setFlash(null);
    try {
      await admin.resendConfirmation(bookingId);
      setFlash({ kind: 'ok', message: 'Confirmation email re-sent.' });
    } catch (err) {
      setFlash({
        kind: 'err',
        message: err instanceof FunctionError ? err.message : 'Failed.',
      });
    } finally {
      setBusyMark(null);
    }
  }

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
        <h2 className="font-display text-xl">Booking not found</h2>
        <p className="mt-2 text-sm">
          It may have been deleted, or your session is stale. Try refreshing or
          signing back in.
        </p>
      </div>
    );
  }

  const tour = tours.find((t) => t.slug === booking.tourId);
  const cancelled = booking.status === 'cancelled';
  const completed =
    booking.status === 'completed' || booking.status === 'no-show';
  const readonly = cancelled || completed;

  return (
    <div className="space-y-6">
      {flash && (
        <div
          role="status"
          className={clsx(
            'rounded-2xl px-4 py-3 text-sm border',
            flash.kind === 'ok'
              ? 'bg-[var(--color-brand-blue)]/10 border-[var(--color-brand-blue)]/20'
              : 'bg-[var(--color-coral)]/10 border-[var(--color-coral)]/30',
          )}
        >
          {flash.message}
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--color-ink-soft)] font-mono">
            ID {booking.id}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl leading-tight">
            {booking.tourName}
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-1">
            {formatFriendlyDate(booking.date)} ·{' '}
            {slotLabels[booking.timeSlot as keyof typeof slotLabels] ?? booking.timeSlot}
            {tour && ` · ${tour.startTimeDisplay} – ${tour.endTimeDisplay}`}
          </p>
        </div>
        <span
          className={clsx(
            'self-start inline-flex items-center px-3 py-1 rounded-full text-xs font-medium',
            STATUS_CLASS[booking.status],
          )}
        >
          {STATUS_LABEL[booking.status]}
        </span>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Customer */}
        <Card title="Customer">
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={booking.customerName} />
            <Row
              label="Email"
              value={
                <a
                  href={`mailto:${booking.customerEmail}`}
                  className="text-[var(--color-brand-blue)] hover:underline"
                >
                  {booking.customerEmail}
                </a>
              }
            />
            <Row
              label="Phone"
              value={
                <a
                  href={`tel:${booking.customerPhone}`}
                  className="text-[var(--color-brand-blue)] hover:underline"
                >
                  {booking.customerPhone}
                </a>
              }
            />
            <Row label="Emergency" value={`${booking.emergencyContactName} · ${booking.emergencyContactPhone}`} />
          </dl>
        </Card>

        {/* Payment */}
        <Card title="Payment">
          <dl className="space-y-2 text-sm">
            <Row label="Paid" value={formatPrice(booking.amountPaidCents)} />
            {booking.amountRefundedCents > 0 && (
              <Row
                label="Refunded"
                value={
                  <span className="text-[var(--color-coral-dark)]">
                    −{formatPrice(booking.amountRefundedCents)}
                  </span>
                }
              />
            )}
            <Row label="Status" value={booking.paymentStatus} />
            {booking.stripePaymentIntentId && (
              <Row
                label="Stripe PI"
                value={
                  <span className="font-mono text-xs break-all">
                    {booking.stripePaymentIntentId}
                  </span>
                }
              />
            )}
          </dl>
        </Card>

        {/* Party */}
        <Card title={`Party (${booking.guestCount})`} className="lg:col-span-2">
          <ol className="text-sm space-y-1 list-decimal list-inside">
            {booking.guests.map((g, i) => (
              <li key={i}>
                {g.name}
                {g.age != null && (
                  <span className="text-[var(--color-ink-soft)]"> (age {g.age})</span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        {/* Internal notes */}
        <Card title="Internal notes" className="lg:col-span-2">
          {booking.adminNotes ? (
            <p className="text-sm whitespace-pre-wrap">{booking.adminNotes}</p>
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)] italic">No notes yet.</p>
          )}
          <button
            type="button"
            onClick={() => setDialog('note')}
            className="mt-3 inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
          >
            {booking.adminNotes ? 'Edit note' : 'Add note'}
          </button>
        </Card>

        {/* Cancellation summary */}
        {cancelled && (
          <Card title="Cancellation" className="lg:col-span-2">
            <dl className="space-y-2 text-sm">
              <Row label="By" value={booking.cancelledBy ?? '—'} />
              {booking.cancellationReason && (
                <Row label="Reason" value={booking.cancellationReason} />
              )}
              <Row
                label="Refunded"
                value={
                  booking.amountRefundedCents === 0
                    ? 'None (per policy)'
                    : formatPrice(booking.amountRefundedCents)
                }
              />
            </dl>
          </Card>
        )}
      </div>

      {/* Action bar */}
      <div className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5">
        <h3 className="font-display text-lg mb-3">Actions</h3>
        <div className="flex flex-wrap gap-2">
          {!readonly && (
            <>
              <ActionBtn onClick={() => setDialog('edit')}>Edit booking</ActionBtn>
              <ActionBtn onClick={() => setDialog('reschedule')}>
                Reschedule
              </ActionBtn>
              <ActionBtn onClick={() => setDialog('partial-refund')}>
                Partial refund
              </ActionBtn>
              <ActionBtn
                onClick={() => setDialog('cancel')}
                tone="danger"
              >
                Cancel + full refund
              </ActionBtn>
              <ActionBtn
                onClick={() => doMark('completed')}
                disabled={busyMark === 'completed'}
              >
                {busyMark === 'completed' ? 'Marking…' : 'Mark completed'}
              </ActionBtn>
              <ActionBtn
                onClick={() => doMark('no-show')}
                disabled={busyMark === 'no-show'}
              >
                {busyMark === 'no-show' ? 'Marking…' : 'Mark no-show'}
              </ActionBtn>
            </>
          )}
          <ActionBtn
            onClick={doResend}
            disabled={busyMark === 'resend'}
          >
            {busyMark === 'resend' ? 'Sending…' : 'Re-send confirmation'}
          </ActionBtn>
          <a
            href={`/admin/bookings/${booking.id}/manifest`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 rounded-full text-sm font-medium border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
          >
            Print manifest
          </a>
        </div>
        {readonly && (
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            This booking is {STATUS_LABEL[booking.status].toLowerCase()} — most
            actions are disabled. Use refund tools at the Stripe dashboard if
            you need to issue additional funds.
          </p>
        )}
      </div>

      {dialog === 'cancel' && (
        <CancelAdminDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Booking cancelled.' });
          }}
        />
      )}
      {dialog === 'partial-refund' && (
        <PartialRefundDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onDone={(amt) => {
            setDialog(null);
            setFlash({
              kind: 'ok',
              message: `Refunded ${formatPrice(amt)}.`,
            });
          }}
        />
      )}
      {dialog === 'edit' && (
        <EditBookingDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Booking updated.' });
          }}
        />
      )}
      {dialog === 'reschedule' && (
        <RescheduleAdminDialog
          booking={booking}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setFlash({ kind: 'ok', message: 'Rescheduled.' });
          }}
        />
      )}
      {dialog === 'note' && (
        <NoteDialog
          booking={booking}
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
    <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
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
        'inline-flex items-center justify-center px-4 py-2 rounded-full text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed',
        tone === 'danger'
          ? 'bg-[var(--color-coral)]/10 text-[var(--color-coral-dark)] border border-[var(--color-coral)]/30 hover:bg-[var(--color-coral)] hover:text-white hover:border-[var(--color-coral)]'
          : 'border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5',
      )}
    >
      {children}
    </button>
  );
}
