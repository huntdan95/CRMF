'use client';

import { useState } from 'react';
import { AdminModal } from './AdminModal';
import { inputClass } from '../ui';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { formatPrice } from '@/lib/tours';
import { formatFriendlyDate } from '@/lib/date';
import type { BookingDoc } from '@/lib/admin-firestore';
import { canRefundHere, isLegacy } from '../booking-labels';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  /** Called with a plain sentence saying what happened. */
  onDone: (message: string) => void;
}

/** Stripe turned down the refund an earlier Cancel here sent (functions/src/lib/admin-cancel.ts). */
type WithRefusedCancel = BookingDoc & { cancelRefundRefused?: { refundCents: number; stripeMessage: string } | null };

export function CancelAdminDialog({ booking, onClose, onDone }: Props) {
  const legacy = isLegacy(booking);
  const owed = Math.max(0, booking.amountPaidCents - booking.amountRefundedCents);
  const autoRefund = canRefundHere(booking) ? owed : 0;
  const manualRefund = owed - autoRefund;
  const firstName = booking.customerName.split(' ')[0] || 'the customer';

  const [reason, setReason] = useState('');
  // Old-site customers may need a call about their money first, so they
  // aren't emailed unless Travis asks for it.
  const [notify, setNotify] = useState(!legacy && !!booking.customerEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stripe has turned this booking's refund down: at its closure's deadline,
  // or a Cancel here (an earlier one, or this one just now). Trying again
  // gets the same answer, so once the money has gone back in Stripe (a
  // dispute, or a refund Travis made there) it's cancelled without one.
  const [refusedNow, setRefusedNow] = useState<string | null>(null);
  const refusal =
    refusedNow ??
    booking.closure?.refundRefused?.stripeMessage ??
    (booking as WithRefusedCancel).cancelRefundRefused?.stripeMessage ??
    null;
  const canHandleInStripe = autoRefund > 0 && refusal !== null;
  const [handled, setHandled] = useState(false);
  const inStripe = canHandleInStripe && handled;

  function chooseHandled(on: boolean) {
    setHandled(on);
    // They know how their money came back: no email unless Travis ticks it.
    setNotify(on ? false : !legacy && !!booking.customerEmail);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await admin.cancelBooking(booking.id, reason.trim() || undefined, notify, inStripe);
      if (r.alreadyCancelled) {
        onDone(
          r.refundCents
            ? `It was cancelled another way at the same moment, but ${formatPrice(r.refundCents)} still went back to ${firstName}’s card. There’s a note on the booking.`
            : 'This booking was already cancelled.',
        );
        return;
      }
      const parts = ['Booking cancelled.'];
      if (r.handledInStripeCents) parts.push(`${formatPrice(r.handledInStripeCents)} recorded as refunded in Stripe.`);
      if (r.refundCents) parts.push(`${formatPrice(r.refundCents)} refunded to ${firstName}’s card.`);
      if (r.manualRefundCents) parts.push(`Remember to refund ${formatPrice(r.manualRefundCents)} yourself.`);
      if (r.emailed) parts.push(`${firstName} has been emailed.`);
      else if (notify && r.emailFailed) parts.push(`The email to ${firstName} didn’t send, so call or text them.`);
      else parts.push(`${firstName} was not emailed.`);
      onDone(parts.join(' '));
    } catch (err) {
      const body =
        err instanceof FunctionError && err.body && typeof err.body === 'object'
          ? (err.body as { code?: string; stripeMessage?: string })
          : null;
      if (err instanceof FunctionError && body?.code === 'refund-refused') {
        setRefusedNow(body.stripeMessage ?? err.message);
        setError(
          `${err.message} If the money has gone back to ${firstName} in Stripe (a dispute, or a refund you made there), tick “Cancel: refund handled in Stripe” below to cancel it without one.`,
        );
        setBusy(false);
        return;
      }
      setError(
        err instanceof FunctionError
          ? err.message
          : 'That didn’t go through. The booking hasn’t changed. Try again in a minute.',
      );
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Cancel this booking?" onClose={onClose} busy={busy}>
      <p className="text-sm">
        <strong>{booking.customerName}</strong> · {formatFriendlyDate(booking.date)}
        <br />
        <span className="text-[var(--color-ink-soft)]">{booking.tourName}</span>
      </p>

      <div className="mt-4 rounded-2xl bg-[var(--color-cream)] p-4 text-sm">
        {autoRefund > 0 && (
          <>
            <p className="text-xs text-[var(--color-ink-soft)] uppercase tracking-widest">
              {inStripe ? 'Refund handled in Stripe' : 'Refund'}
            </p>
            <p className="mt-1 font-display text-2xl text-[var(--color-brand-blue)]">{formatPrice(autoRefund)}</p>
            <p className="mt-1">
              {inStripe
                ? 'No money goes back from here. It’s recorded as refunded by hand, so Reports count it as given back.'
                : 'All of it goes back to their card automatically.'}
            </p>
          </>
        )}
        {manualRefund > 0 && (
          <p className="text-[var(--color-coral-dark)] font-medium">
            This was paid on the old website, so no money is refunded
            automatically. You’ll need to refund {formatPrice(manualRefund)}{' '}
            yourself. A reminder is added to this booking’s notes.
          </p>
        )}
        {owed === 0 && (
          <p>
            {booking.amountPaidCents === 0
              ? 'They haven’t paid anything, so there’s nothing to refund.'
              : 'Their payment has already been refunded.'}
          </p>
        )}
      </div>

      {canHandleInStripe && (
        <div className="mt-4 rounded-2xl border border-[var(--color-coral)]/30 bg-[var(--color-coral)]/5 p-4 text-sm">
          <p>
            Stripe turned down the refund for this booking (&ldquo;{refusal}&rdquo;), so cancelling it the usual way
            fails again.
          </p>
          <label className="flex items-start gap-3 mt-3 min-h-11">
            <input
              type="checkbox"
              checked={handled}
              onChange={(e) => chooseHandled(e.target.checked)}
              className="w-5 h-5 mt-0.5 shrink-0"
            />
            <span>
              Cancel: refund handled in Stripe (a dispute or a refund there)
              <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                Only once the money has gone back to {firstName} in Stripe: through their bank&rsquo;s dispute, or a
                refund you made in Stripe&rsquo;s dashboard. A note goes on the booking.
              </span>
            </span>
          </label>
        </div>
      )}

      {booking.customerEmail && (
        <label className="flex items-start gap-3 mt-4 text-sm min-h-11">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="w-5 h-5 mt-0.5 shrink-0"
          />
          <span>
            Email {firstName} ({booking.customerEmail}) to say it’s cancelled
            {inStripe && notify && (
              <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                The email will say their payment has already been refunded.
              </span>
            )}
            {manualRefund > 0 && notify && (
              <span className="block text-xs text-[var(--color-ink-soft)] mt-1">
                The email will say you’ll be in touch about their {formatPrice(manualRefund)}.
              </span>
            )}
          </span>
        </label>
      )}

      <label className="block mt-4">
        <span className="block text-sm font-medium text-[var(--color-ink)] mb-1">
          Reason{' '}
          <span className="text-[var(--color-ink-soft)] font-normal">
            {notify ? '(optional, included in the email)' : '(optional, only you see this)'}
          </span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Weather, boat trouble, etc."
          className={inputClass}
        />
      </label>

      {error && (
        <div role="alert" className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-3 sm:py-2 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5 disabled:opacity-60"
        >
          Keep the booking
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-3 sm:py-2 rounded-[10px] bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy
            ? 'Cancelling…'
            : inStripe
              ? 'Cancel: refund handled in Stripe'
              : autoRefund > 0
                ? `Cancel and refund ${formatPrice(autoRefund)}`
                : 'Yes, cancel it'}
        </button>
      </div>
    </AdminModal>
  );
}
