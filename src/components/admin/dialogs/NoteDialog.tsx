'use client';

import { useState } from 'react';
import { AdminModal, adminInputClass } from './AdminModal';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import type { BookingDoc } from '@/lib/admin-firestore';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  onDone: () => void;
}

export function NoteDialog({ booking, onClose, onDone }: Props) {
  const [note, setNote] = useState(booking.adminNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await admin.addNote(booking.id, note.trim());
      onDone();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Failed.');
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Internal note" onClose={onClose}>
      <p className="text-sm text-[var(--color-ink-soft)]">
        Never shown to the customer. Use it for boat notes, allergy flags,
        repeat-guest reminders, etc.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={6}
        maxLength={2000}
        placeholder="e.g., First-time snorkelers, kid is nervous."
        className={`${adminInputClass} mt-3 font-mono text-sm`}
      />
      {error && (
        <div className="mt-3 rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </AdminModal>
  );
}
