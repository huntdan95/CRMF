'use client';

import { useEffect, useState } from 'react';
import { AdminModal } from './AdminModal';
import { inputClass } from '../ui';
import { admin } from '@/lib/admin-client';
import { FunctionError } from '@/lib/functions-client';
import { getSiteSettings, type BookingDoc } from '@/lib/admin-firestore';
import { wetsuitSizesFrom, type WetsuitSizes } from '@/lib/site-settings';
import { WetsuitSelect } from '@/components/booking/WetsuitSelect';

interface Props {
  booking: BookingDoc;
  onClose: () => void;
  onDone: () => void;
}

/** A field's name inside a named group ("Lead guest"): quieter than the group's. */
const fieldLabel = 'block text-xs font-medium text-[var(--color-ink-soft)] mb-1';

interface GuestEntry {
  name: string;
  age: string;
  wetsuitSize: string;
}

export function EditBookingDialog({ booking, onClose, onDone }: Props) {
  // The booking as it was when the dialog opened. `booking` follows the
  // live doc, so diffing against it would send back, as changes, the old
  // values of fields someone else changed meanwhile (MCP, the customer).
  const [opened] = useState(booking);
  const [guestCount, setGuestCount] = useState(booking.guestCount);
  const [guests, setGuests] = useState<GuestEntry[]>(
    booking.guests.map((g) => ({
      name: g.name,
      age: g.age != null ? String(g.age) : '',
      wetsuitSize: g.wetsuitSize ?? '',
    })),
  );
  // The stocked sizes; the defaults until Travis's own load.
  const [sizes, setSizes] = useState<WetsuitSizes>(() => wetsuitSizesFrom(null));
  useEffect(() => {
    getSiteSettings().then((s) => setSizes(wetsuitSizesFrom(s)), () => undefined);
  }, []);
  const [customer, setCustomer] = useState({
    name: booking.customerName,
    email: booking.customerEmail,
    phone: booking.customerPhone,
  });
  const [emergency, setEmergency] = useState({
    name: booking.emergencyContactName,
    phone: booking.emergencyContactPhone,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateGuestCount(n: number) {
    const clamped = Math.max(1, Math.min(n, 6));
    setGuestCount(clamped);
    setGuests((prev) => {
      if (clamped === prev.length) return prev;
      if (clamped > prev.length) {
        return [...prev, ...Array.from({ length: clamped - prev.length }, () => ({ name: '', age: '', wetsuitSize: '' }))];
      }
      return prev.slice(0, clamped);
    });
  }

  async function submit() {
    setError(null);
    // Send only what changed: an imported booking can have no party size or
    // an old email that wouldn't pass today's checks, and that mustn't
    // stop Travis fixing a phone number.
    const changes: Parameters<typeof admin.editBooking>[1] = {};
    if (guestCount !== opened.guestCount) changes.guestCount = guestCount;
    const nextGuests = guests.map((g) => ({
      name: g.name.trim(),
      age: g.age.trim() === '' ? null : Number(g.age),
      wetsuitSize: g.wetsuitSize || null,
    }));
    const prevGuests = opened.guests.map((g) => ({
      name: g.name,
      age: g.age ?? null,
      wetsuitSize: g.wetsuitSize ?? null,
    }));
    if (JSON.stringify(nextGuests) !== JSON.stringify(prevGuests)) changes.guests = nextGuests;
    const text = (next: string, prev: string | undefined) => (next.trim() !== (prev ?? '').trim() ? next.trim() : undefined);
    changes.customerName = text(customer.name, opened.customerName);
    changes.customerEmail = text(customer.email, opened.customerEmail);
    changes.customerPhone = text(customer.phone, opened.customerPhone);
    changes.emergencyContactName = text(emergency.name, opened.emergencyContactName);
    changes.emergencyContactPhone = text(emergency.phone, opened.emergencyContactPhone);
    for (const k of Object.keys(changes) as Array<keyof typeof changes>) {
      if (changes[k] === undefined) delete changes[k];
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    if (changes.customerEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.customerEmail)) {
      setError('That email address doesn’t look right.');
      return;
    }
    if (nextGuests.some((g) => g.age !== null && !Number.isFinite(g.age))) {
      setError('Ages have to be numbers. Leave the box empty if you don’t know.');
      return;
    }

    setBusy(true);
    try {
      await admin.editBooking(booking.id, changes);
      onDone();
    } catch (err) {
      setError(
        err instanceof FunctionError && err.message !== 'Invalid input'
          ? err.message
          : 'That didn’t save. Check the details and try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Edit booking" onClose={onClose} busy={busy}>
      <div className="space-y-4">
        <div>
          {/* A stepper, not a field: name the group, and announce the count as it changes. */}
          <p id="edit-guest-count" className="text-sm font-medium block mb-1">How many guests</p>
          <div role="group" aria-labelledby="edit-guest-count" className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount - 1)}
              disabled={guestCount <= 1}
              aria-label="One fewer guest"
              className="w-11 h-11 rounded-full border border-[var(--color-ink)]/15 disabled:opacity-30 text-lg"
            >
              −
            </button>
            <span aria-live="polite" className="font-display text-xl min-w-8 text-center">
              {guestCount > 0 ? guestCount : <span className="text-sm font-sans text-[var(--color-ink-soft)]">Not recorded</span>}
            </span>
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount + 1)}
              disabled={guestCount >= 6}
              aria-label="One more guest"
              className="w-11 h-11 rounded-full border border-[var(--color-ink)]/15 disabled:opacity-30 text-lg"
            >
              +
            </button>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">
            Guests{' '}
            <span className="font-normal text-[var(--color-ink-soft)]">(leave blank if you don’t know them yet)</span>
          </legend>
          {/* The placeholder goes once a box is filled, so each also has a name of its own. */}
          {guests.map((g, i) => (
            <div key={i} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem]">
              <input
                value={g.name}
                onChange={(e) =>
                  setGuests((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder={`Guest ${i + 1} name`}
                aria-label={`Guest ${i + 1} name`}
                className={`${inputClass} col-span-2 sm:col-span-1`}
              />
              <input
                value={g.age}
                onChange={(e) =>
                  setGuests((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, age: e.target.value } : x)),
                  )
                }
                placeholder="Age"
                aria-label={`Guest ${i + 1} age`}
                inputMode="numeric"
                className={inputClass}
              />
              <WetsuitSelect
                sizes={sizes}
                value={g.wetsuitSize}
                onChange={(v) =>
                  setGuests((prev) => prev.map((x, j) => (j === i ? { ...x, wetsuitSize: v } : x)))
                }
                placeholder="Wetsuit"
                aria-label={`Guest ${i + 1} wetsuit size`}
                className={inputClass}
              />
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Lead guest</legend>
          {/* Labels, not placeholders: a filled box would say only what's in it. */}
          <label className="block">
            <span className={fieldLabel}>Name</span>
            <input
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Email</span>
            <input
              value={customer.email}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              type="email"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Phone</span>
            <input
              value={customer.phone}
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              type="tel"
              className={inputClass}
            />
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Emergency contact</legend>
          <label className="block">
            <span className={fieldLabel}>Name</span>
            <input
              value={emergency.name}
              onChange={(e) => setEmergency({ ...emergency, name: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Phone</span>
            <input
              value={emergency.phone}
              onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })}
              type="tel"
              className={inputClass}
            />
          </label>
        </fieldset>
      </div>

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
          className="px-4 py-2 rounded-[10px] border border-[var(--color-ink)]/15 hover:bg-[var(--color-ink)]/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue-dark)] text-white font-medium disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </AdminModal>
  );
}
