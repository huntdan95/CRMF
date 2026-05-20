'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { MarketingTour } from '@/lib/tours';
import { calculateTotalCents, formatPrice } from '@/lib/tours';
import {
  createCheckoutSession,
  FunctionError,
  type CreateCheckoutInput,
} from '@/lib/functions-client';
import { clsx } from '@/lib/clsx';

interface Props {
  tour: MarketingTour;
  date: string;
}

interface GuestState {
  name: string;
  age: string; // raw input
}

const inputClass =
  'w-full rounded-2xl border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function DetailsForm({ tour, date }: Props) {
  const isPrivate = tour.type === 'private';

  const [guestCount, setGuestCount] = useState(1);
  const [guests, setGuests] = useState<GuestState[]>([{ name: '', age: '' }]);
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [emergency, setEmergency] = useState({ name: '', phone: '' });
  const [acks, setAcks] = useState({
    manners: false,
    waiver: false,
    cancellation: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateGuestCount(n: number) {
    const clamped = Math.max(1, Math.min(n, tour.maxGuests));
    setGuestCount(clamped);
    setGuests((prev) => {
      if (clamped === prev.length) return prev;
      if (clamped > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: clamped - prev.length }, () => ({
            name: '',
            age: '',
          })),
        ];
      }
      return prev.slice(0, clamped);
    });
  }

  function updateGuest(i: number, patch: Partial<GuestState>) {
    setGuests((prev) =>
      prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)),
    );
  }

  const total = useMemo(
    () => calculateTotalCents(tour, guestCount),
    [tour, guestCount],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!customer.name.trim()) return setError('Please enter your name.');
    if (!customer.email.trim()) return setError('Please enter your email.');
    if (!customer.phone.trim()) return setError('Please enter a phone number.');
    if (!emergency.name.trim() || !emergency.phone.trim()) {
      return setError('Please add an emergency contact.');
    }
    for (let i = 0; i < guests.length; i++) {
      if (!guests[i]!.name.trim()) {
        return setError(`Please enter a name for guest ${i + 1}.`);
      }
    }
    if (!acks.manners) {
      return setError('Please confirm you\'ve read the manatee manners.');
    }
    if (!acks.waiver) {
      return setError('Please sign the liability waiver.');
    }
    if (!acks.cancellation) {
      return setError('Please acknowledge the cancellation policy.');
    }

    setSubmitting(true);

    const input: CreateCheckoutInput = {
      tourSlug: tour.slug,
      date,
      guestCount,
      customer: {
        name: customer.name.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
      },
      emergencyContact: {
        name: emergency.name.trim(),
        phone: emergency.phone.trim(),
      },
      guests: guests.map((g) => ({
        name: g.name.trim(),
        age: g.age.trim() === '' ? null : Number(g.age),
      })),
      acknowledgements: {
        manateeManners: true,
        liabilityWaiver: true,
      },
    };

    try {
      const { checkoutUrl } = await createCheckoutSession(input);
      window.location.href = checkoutUrl;
    } catch (err) {
      const message =
        err instanceof FunctionError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Something went wrong.';
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      {/* Guest count -------------------------------------------------- */}
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h2 className="font-display text-xl">How many guests?</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          {isPrivate
            ? `Private tours include the whole boat — up to ${tour.maxGuests} guests, flat $${(tour.flatPrice ?? 0) / 100}.`
            : `Shared tour — ${formatPrice(tour.pricePerPerson ?? 0)} per guest, up to ${tour.maxGuests} on the boat total.`}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateGuestCount(guestCount - 1)}
            disabled={guestCount <= 1}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-[var(--color-ink)]/15 text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10 disabled:opacity-30"
            aria-label="One fewer guest"
          >
            −
          </button>
          <span
            className="font-display text-2xl w-12 text-center"
            aria-live="polite"
          >
            {guestCount}
          </span>
          <button
            type="button"
            onClick={() => updateGuestCount(guestCount + 1)}
            disabled={guestCount >= tour.maxGuests}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-[var(--color-ink)]/15 text-[var(--color-brand-blue)] hover:bg-[var(--color-brand-blue)]/10 disabled:opacity-30"
            aria-label="One more guest"
          >
            +
          </button>
          <span className="ml-auto font-display text-xl text-[var(--color-brand-blue)]">
            {formatPrice(total)}
          </span>
        </div>
      </section>

      {/* Lead guest --------------------------------------------------- */}
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h2 className="font-display text-xl">Lead guest</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          We&rsquo;ll send the confirmation and any weather updates here.
        </p>

        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <Field label="Full name" required>
            <input
              type="text"
              autoComplete="name"
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              autoComplete="email"
              value={customer.email}
              onChange={(e) =>
                setCustomer({ ...customer, email: e.target.value })
              }
              required
              className={inputClass}
            />
          </Field>
          <Field label="Phone" required>
            <input
              type="tel"
              autoComplete="tel"
              value={customer.phone}
              onChange={(e) =>
                setCustomer({ ...customer, phone: e.target.value })
              }
              required
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* All guests --------------------------------------------------- */}
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h2 className="font-display text-xl">Everyone in your group</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Names go on the boarding manifest. Ages are optional but helpful — we
          choose wetsuit sizes ahead of time.
        </p>

        <div className="mt-4 space-y-4">
          {guests.map((g, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_auto] gap-4">
              <Field label={`Guest ${i + 1} name`} required hideLabel={false}>
                <input
                  type="text"
                  value={g.name}
                  onChange={(e) => updateGuest(i, { name: e.target.value })}
                  required
                  className={inputClass}
                  placeholder={i === 0 ? customer.name || 'Lead guest' : ''}
                />
              </Field>
              <Field label="Age (optional)">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  value={g.age}
                  onChange={(e) => updateGuest(i, { age: e.target.value })}
                  className={clsx(inputClass, 'sm:w-32')}
                />
              </Field>
            </div>
          ))}
        </div>
      </section>

      {/* Emergency contact ------------------------------------------- */}
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6">
        <h2 className="font-display text-xl">Emergency contact</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          Someone who isn&rsquo;t on the boat. We hope to never need this.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <Field label="Contact name" required>
            <input
              type="text"
              value={emergency.name}
              onChange={(e) =>
                setEmergency({ ...emergency, name: e.target.value })
              }
              required
              className={inputClass}
            />
          </Field>
          <Field label="Contact phone" required>
            <input
              type="tel"
              value={emergency.phone}
              onChange={(e) =>
                setEmergency({ ...emergency, phone: e.target.value })
              }
              required
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Acknowledgements -------------------------------------------- */}
      <section className="bg-white rounded-2xl border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-3">
        <h2 className="font-display text-xl">Before we leave the dock</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Three boxes to check — these are required by USFWS and our insurer.
        </p>

        <Checkbox
          checked={acks.manners}
          onChange={(v) => setAcks({ ...acks, manners: v })}
        >
          I&rsquo;ve watched the{' '}
          <Link href="/about#manners" target="_blank" className="underline underline-offset-2 text-[var(--color-brand-blue)]">
            USFWS manatee manners video
          </Link>{' '}
          and agree to follow the rules (passive observation, no touching, no
          chasing, no diving).
        </Checkbox>

        <Checkbox
          checked={acks.waiver}
          onChange={(v) => setAcks({ ...acks, waiver: v })}
        >
          I&rsquo;m signing the standard liability waiver on behalf of everyone
          in my party. Snorkeling carries inherent risks; we follow our
          captain&rsquo;s instructions at all times.
        </Checkbox>

        <Checkbox
          checked={acks.cancellation}
          onChange={(v) => setAcks({ ...acks, cancellation: v })}
        >
          I&rsquo;ve read the cancellation policy: 72+ hours = full refund,
          24-72 hours = 50%, less than 24 hours = no refund (Travis-cancelled
          weather always refunds in full).
        </Checkbox>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      <div className="sticky bottom-4 sm:bottom-6 z-10 bg-[var(--color-cream)]/95 backdrop-blur rounded-2xl shadow-[var(--shadow-soft)] border border-[var(--color-ink)]/8 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-[var(--color-ink-soft)] uppercase tracking-widest">
            Total
          </p>
          <p className="font-display text-2xl text-[var(--color-brand-blue)] leading-tight">
            {formatPrice(total)}
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium shadow-[var(--shadow-card)]"
        >
          {submitting ? (
            <>
              <Spinner />
              Redirecting to payment…
            </>
          ) : (
            <>
              Continue to payment
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hideLabel = false,
  children,
}: {
  label: string;
  required?: boolean;
  hideLabel?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className={clsx(
          'block text-sm font-medium text-[var(--color-ink)] mb-1',
          hideLabel && 'sr-only',
        )}
      >
        {label}{' '}
        {required && (
          <span className="text-[var(--color-coral-dark)]" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex gap-3 items-start cursor-pointer">
      <span className="mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <span
          aria-hidden
          className="inline-flex w-5 h-5 rounded border border-[var(--color-ink)]/30 bg-white peer-checked:bg-[var(--color-brand-blue)] peer-checked:border-[var(--color-brand-blue)] items-center justify-center transition-colors"
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12.5l4 4 10-10"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
      <span className="text-sm leading-relaxed text-[var(--color-ink)]">
        {children}
      </span>
    </label>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
