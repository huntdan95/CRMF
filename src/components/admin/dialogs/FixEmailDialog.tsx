'use client';

import { useState } from 'react';
import { AdminModal } from './AdminModal';
import { buttonClass, hintClass, inputClass, labelClass } from '../ui';
import { emailBounces } from '../booking-labels';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  /** Called with a plain sentence for the toast once everything went. */
  onDone: (message: string) => void;
}

type Results = Awaited<ReturnType<typeof admin.fixBouncedEmail>>['results'];

/**
 * "Fix email and resend": Travis types in the right address and every
 * email that bounced goes out again where it can. If any can't, the dialog
 * stays open and says which, so he knows to call.
 */
export function FixEmailDialog({ booking, onClose, onDone }: Props) {
  const bounces = emailBounces(booking);
  const firstName = booking.customerName.split(' ')[0] || 'the customer';
  const [email, setEmail] = useState(booking.customerEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);

  async function submit() {
    setError(null);
    const next = email.trim();
    if (!next) {
      setError('Type in their email address.');
      return;
    }
    setBusy(true);
    try {
      const r = await admin.fixBouncedEmail(booking.id, next);
      if (r.results.every((x) => x.outcome === 'resent')) {
        onDone(`Saved ${r.customerEmail} and sent ${firstName} the ${joinLabels(r.results)} again.`);
        return;
      }
      setResults(r.results);
      setBusy(false);
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'That didn’t go through. Nothing was changed. Try again in a minute.');
      setBusy(false);
    }
  }

  if (results) {
    const callThem = results.some((r) => r.outcome !== 'resent');
    return (
      <AdminModal title="Email fixed" onClose={onClose}>
        <p className="text-sm">Saved {email.trim()}.</p>
        <ul className="mt-3 divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] text-sm">
          {results.map((r) => (
            <li key={r.kind} className="px-3 py-2.5">
              <p className="font-semibold first-letter:uppercase">{r.label}</p>
              <p
                className={clsx(
                  'mt-0.5',
                  r.outcome === 'resent' ? 'text-[var(--color-spring)]' : 'text-[var(--color-error)] font-medium',
                )}
              >
                {r.outcome === 'resent'
                  ? 'Sent again.'
                  : r.outcome === 'failed'
                    ? `Didn’t send. ${r.reason ?? ''} Try again, or call them.`
                    : `Not resent: call them. ${r.reason ?? ''}`}
              </p>
            </li>
          ))}
        </ul>
        {callThem && booking.customerPhone && (
          <a
            href={`tel:${booking.customerPhone.replace(/[^\d+]/g, '')}`}
            className={clsx(buttonClass('primary'), 'mt-4 w-full')}
          >
            Call {firstName}: {booking.customerPhone}
          </a>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass('secondary')}>
            Done
          </button>
        </div>
      </AdminModal>
    );
  }

  return (
    <AdminModal title="Fix email and resend" onClose={onClose} busy={busy}>
      <p className="text-sm">These emails to {firstName} bounced:</p>
      <ul className="mt-2 space-y-2 text-sm">
        {bounces.map((x) => (
          <li key={x.kind} className="rounded-xl bg-[var(--color-error)]/[0.07] border border-[var(--color-error)]/25 px-3 py-2">
            <span className="font-semibold first-letter:uppercase inline-block">{x.label}</span>
            <span className="block break-all text-[var(--color-ink-soft)]">
              to {x.to}
              {!x.permanent && ' (their mail server turned it away for now)'}
            </span>
          </li>
        ))}
      </ul>

      <label className={clsx(labelClass, 'mt-4')} htmlFor="fix-email">
        Their right email address
      </label>
      <input
        id="fix-email"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputClass}
      />
      <span className={hintClass}>
        Saved on the booking, then each email above goes out again to it where it can. Copies go to you as usual.
      </span>

      {error && (
        <div role="alert" className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button type="button" onClick={onClose} disabled={busy} className={buttonClass('secondary')}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={busy} className={buttonClass('primary')}>
          {busy ? 'Sending…' : 'Save and resend'}
        </button>
      </div>
    </AdminModal>
  );
}

/** "booking confirmation and day-before reminder". */
function joinLabels(results: Results): string {
  const labels = results.map((r) => r.label);
  if (labels.length <= 1) return labels[0] ?? 'email';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
