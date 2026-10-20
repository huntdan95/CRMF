'use client';

import { useState } from 'react';
import { AdminModal } from './AdminModal';
import { buttonClass, inputClass, labelClass } from '../ui';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  /** Called with a plain sentence for the toast once it's done. */
  onDone: (message: string) => void;
}

/**
 * "Erase personal details", for a customer who asks to be deleted: Travis
 * types ERASE, since there's no undo. Says what goes, what stays (the
 * money, and the signed waivers the privacy policy keeps for 7 years) and
 * what this can't reach (functions/src/lib/admin-erase.ts).
 */
export function EraseBookingDialog({ booking, onClose, onDone }: Props) {
  const who = booking.customerName || 'the customer';
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toLowerCase() === 'erase';

  async function submit() {
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      const r = await admin.eraseBooking(booking.id);
      const copies = r.copies ? Object.values(r.copies).reduce((sum, n) => sum + n, 0) : 0;
      onDone(
        r.alreadyErased
          ? 'Their details were already erased.'
          : `Erased. Their details are gone from this booking${copies ? ` and ${copies} other ${copies === 1 ? 'record' : 'records'}` : ''}.`,
      );
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t go through. Try again in a minute; anything already erased stays erased.');
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Erase personal details" onClose={onClose} busy={busy}>
      <div className="space-y-3 text-sm">
        <p>
          For a customer who has asked to be deleted. This blanks {who}’s name, email, phone, emergency contact, their
          guests’ names and ages, and your notes, on this booking and wherever the site copied them: Activity, the email
          log, closed-day results, date-change requests, private feedback, and contact messages from
          {booking.customerEmail ? ` ${booking.customerEmail}` : ' their address'}.
        </p>
        <p>
          <span className="font-semibold">Kept:</span> what they paid and were refunded, the Stripe payment, the date and
          the tour, so your books and reports still add up. Their signed waivers are kept too: the privacy policy keeps
          waivers for 7 years.
        </p>
        <p className="text-[var(--color-ink-soft)]">
          <span className="font-semibold text-[var(--color-ink)]">Not reached from here:</span> emails already in your
          inbox or theirs, Stripe’s and Resend’s own records, trip photos (delete those in Trip photos), and messages they
          sent from another address. Your own notices about them are found by their name as it’s on the booking, so one
          that spelled it differently can be missed.
        </p>
        <p className="font-semibold">This can’t be undone.</p>
      </div>

      <label className="mt-4 block">
        <span className={labelClass}>Type ERASE to confirm</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ERASE"
          className={inputClass}
        />
      </label>

      {error && (
        <div role="alert" className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button type="button" onClick={onClose} disabled={busy} className={buttonClass('secondary')}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={busy || !ready} className={buttonClass('destructive')}>
          {busy ? 'Erasing…' : 'Erase personal details'}
        </button>
      </div>
    </AdminModal>
  );
}
