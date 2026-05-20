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

interface GuestEntry {
  name: string;
  age: string;
}

export function EditBookingDialog({ booking, onClose, onDone }: Props) {
  const [guestCount, setGuestCount] = useState(booking.guestCount);
  const [guests, setGuests] = useState<GuestEntry[]>(
    booking.guests.map((g) => ({ name: g.name, age: g.age != null ? String(g.age) : '' })),
  );
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
        return [...prev, ...Array.from({ length: clamped - prev.length }, () => ({ name: '', age: '' }))];
      }
      return prev.slice(0, clamped);
    });
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await admin.editBooking(booking.id, {
        guestCount,
        guests: guests.map((g) => ({
          name: g.name.trim(),
          age: g.age.trim() === '' ? null : Number(g.age),
        })),
        customerName: customer.name.trim(),
        customerEmail: customer.email.trim(),
        customerPhone: customer.phone.trim(),
        emergencyContactName: emergency.name.trim(),
        emergencyContactPhone: emergency.phone.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof FunctionError ? err.message : 'Edit failed.');
      setBusy(false);
    }
  }

  return (
    <AdminModal title="Edit booking" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1">Guest count</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount - 1)}
              disabled={guestCount <= 1}
              className="w-9 h-9 rounded-full border border-[var(--color-ink)]/15 disabled:opacity-30"
            >
              −
            </button>
            <span className="font-display text-xl w-8 text-center">{guestCount}</span>
            <button
              type="button"
              onClick={() => updateGuestCount(guestCount + 1)}
              disabled={guestCount >= 6}
              className="w-9 h-9 rounded-full border border-[var(--color-ink)]/15 disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Guests</legend>
          {guests.map((g, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={g.name}
                onChange={(e) =>
                  setGuests((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder={`Guest ${i + 1} name`}
                className={adminInputClass}
              />
              <input
                value={g.age}
                onChange={(e) =>
                  setGuests((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, age: e.target.value } : x)),
                  )
                }
                placeholder="Age"
                inputMode="numeric"
                className={`${adminInputClass} w-20`}
              />
            </div>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Lead guest</legend>
          <input
            value={customer.name}
            onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
            placeholder="Name"
            className={adminInputClass}
          />
          <input
            value={customer.email}
            onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
            placeholder="Email"
            type="email"
            className={adminInputClass}
          />
          <input
            value={customer.phone}
            onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
            placeholder="Phone"
            type="tel"
            className={adminInputClass}
          />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Emergency contact</legend>
          <input
            value={emergency.name}
            onChange={(e) => setEmergency({ ...emergency, name: e.target.value })}
            placeholder="Name"
            className={adminInputClass}
          />
          <input
            value={emergency.phone}
            onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })}
            placeholder="Phone"
            type="tel"
            className={adminInputClass}
          />
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
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </AdminModal>
  );
}
