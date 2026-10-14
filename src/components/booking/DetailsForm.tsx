'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { MarketingTour } from '@/lib/tours';
import {
  createCheckoutSession,
  FunctionError,
  type CheckoutHold,
  type CreateCheckoutInput,
} from '@/lib/functions-client';
import { Info, Play } from '@/components/ui/icons';
import { departureClosed, marinaNow, type MarinaClock } from '@/lib/availability';
import { siteConfig } from '@/lib/site-config';
import { TERMS_VERSION } from '@/lib/legal';
import { clsx } from '@/lib/clsx';

interface Props {
  tour: MarketingTour;
  date: string;
  guests: number;
  /** `id` of the <form>, so a button elsewhere (the summary) can submit it. */
  formId: string;
  onSubmittingChange: (submitting: boolean) => void;
  /** Checkout says the departure is no longer available. */
  onUnavailable: (message: string) => void;
  /** Marina clock (re-checked right before paying). */
  now: MarinaClock;
}

interface GuestState {
  name: string;
  age: string;
}

interface Draft {
  customer: { name: string; email: string; phone: string };
  emergency: { name: string; phone: string };
  guests: GuestState[];
  leadIsGuest: boolean;
  /** Group size when the draft was saved. */
  count?: number;
}

/** Survives the round trip to Stripe and back (or an accidental refresh). */
export const DRAFT_KEY = 'crmf:booking-draft:v1';

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

/** How many guests the saved draft was for (used when a URL lacks ?guests). */
export function draftGuestCount(): number | null {
  const d = readDraft();
  return d?.count ?? null;
}

function writeDraft(d: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Private mode / storage full: the form still works, it just won't remember.
  }
}

/**
 * The unpaid checkout this tab last opened. If the guest comes back from
 * Stripe without paying, it's released (BookingFlow) or replaced by the
 * next checkout, so it doesn't hold their seats for 30 minutes.
 */
const HOLD_KEY = 'crmf:checkout-hold:v1';

export function readHold(): CheckoutHold | null {
  try {
    const raw = sessionStorage.getItem(HOLD_KEY);
    const h = raw ? (JSON.parse(raw) as Partial<CheckoutHold>) : null;
    return typeof h?.bookingId === 'string' && typeof h.accessToken === 'string'
      ? { bookingId: h.bookingId, accessToken: h.accessToken }
      : null;
  } catch {
    return null;
  }
}

function saveHold(h: CheckoutHold) {
  try {
    sessionStorage.setItem(HOLD_KEY, JSON.stringify(h));
  } catch {
    // Storage unavailable: the hold just expires on its own.
  }
}

/** Forget a hold, unless a newer checkout has already replaced it. */
export function forgetHold(bookingId: string) {
  try {
    if (readHold()?.bookingId === bookingId) sessionStorage.removeItem(HOLD_KEY);
  } catch {
    // Storage unavailable; nothing to forget.
  }
}

type Errors = Record<string, string>;

// Exactly the email check createCheckoutSession runs (zod 3's .email(),
// after trimming and lowercasing), so nothing passes here and fails there.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

// Length limits from the same server schema.
const MAX = { name: 120, email: 160, phone: 40 } as const;
const digits = (s: string) => s.replace(/\D/g, '');

function resize(list: GuestState[], n: number): GuestState[] {
  if (list.length === n) return list;
  if (list.length > n) return list.slice(0, n);
  return [...list, ...Array.from({ length: n - list.length }, () => ({ name: '', age: '' }))];
}

/** Where createCheckoutSession's zod errors point, in this form's field keys. */
function serverFieldErrors(details: unknown, guestCount: number): Errors {
  const out: Errors = {};
  const msg = (node: unknown) => {
    const errs = (node as { _errors?: string[] } | undefined)?._errors;
    return errs && errs.length ? errs[0] : null;
  };
  const d = details as Record<string, Record<string, unknown>> | undefined;
  if (!d || typeof d !== 'object') return out;
  const pairs: Array<[unknown, string, string]> = [
    [d.customer?.name, 'customer.name', 'Check your name.'],
    [d.customer?.email, 'customer.email', 'Check this email address.'],
    [d.customer?.phone, 'customer.phone', 'Check this phone number.'],
    [d.emergencyContact?.name, 'emergency.name', 'Check this name.'],
    [d.emergencyContact?.phone, 'emergency.phone', 'Check this phone number.'],
  ];
  for (const [node, key, text] of pairs) if (msg(node)) out[key] = text;
  for (let i = 0; i < guestCount; i++) {
    const g = (d.guests as Record<string, Record<string, unknown>> | undefined)?.[String(i)];
    if (msg(g?.name)) out[`guest.${i}.name`] = 'Check this name.';
    if (msg(g?.age)) out[`guest.${i}.age`] = 'Use a whole number.';
  }
  return out;
}

export function DetailsForm({ tour, date, guests: guestCount, formId, onSubmittingChange, onUnavailable, now }: Props) {
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [emergency, setEmergency] = useState({ name: '', phone: '' });
  const [guests, setGuests] = useState<GuestState[]>([]);
  const [leadIsGuest, setLeadIsGuest] = useState(true);
  const [acks, setAcks] = useState({ manners: false, waiver: false, cancellation: false, terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Becomes true on the render *after* the draft is restored, so the save
  // effect below never writes the empty initial state over a real draft.
  const [restored, setRestored] = useState(false);

  // Restore a saved draft once, on mount. sessionStorage only exists in the
  // browser, so this can't be initial state without a hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from storage */
  useEffect(() => {
    const d = readDraft();
    if (d) {
      setCustomer(d.customer);
      setEmergency(d.emergency);
      setLeadIsGuest(d.leadIsGuest);
      setGuests(d.guests);
    }
    setRestored(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!restored) return;
    writeDraft({ customer, emergency, guests, leadIsGuest, count: guestCount });
  }, [restored, customer, emergency, guests, leadIsGuest, guestCount]);

  useEffect(() => {
    onSubmittingChange(submitting);
  }, [submitting, onSubmittingChange]);

  // Back button from Stripe: browsers may restore this page from the
  // back-forward cache with the button still saying "Opening checkout…".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setSubmitting(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // `guests` keeps every name ever typed, so dropping the count to 2 and
  // back to 3 doesn't lose the third name. The roster is what's shown.
  // Guest 1 is the lead guest unless they say otherwise.
  const roster = resize(guests, guestCount).map((g, i) =>
    i === 0 && leadIsGuest ? { ...g, name: customer.name } : g,
  );

  function updateGuest(i: number, patch: Partial<GuestState>) {
    setGuests((list) => resize(list, Math.max(list.length, i + 1)).map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  function clearError(key: string) {
    if (!errors[key]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validate(): Errors {
    const e: Errors = {};
    const email = customer.email.trim().toLowerCase();
    if (!customer.name.trim()) e['customer.name'] = 'Enter your name.';
    if (!EMAIL.test(email) || email.length > MAX.email) {
      e['customer.email'] = 'Check this email address. We send your confirmation here.';
    }
    if (digits(customer.phone).length < 7) e['customer.phone'] = 'Enter a phone number we can reach you on.';
    roster.forEach((g, i) => {
      if (!g.name.trim()) {
        e[`guest.${i}.name`] = i === 0 && leadIsGuest ? 'Enter your name above.' : `Enter a name for guest ${i + 1}.`;
      } else if (g.name.trim().length > MAX.name) {
        e[`guest.${i}.name`] = `Keep it under ${MAX.name} characters.`;
      }
      if (g.age.trim() !== '') {
        const n = Number(g.age);
        if (!Number.isInteger(n) || n < 0 || n > 120) e[`guest.${i}.age`] = 'Use a whole number.';
      }
    });
    if (!emergency.name.trim()) e['emergency.name'] = 'Add someone we can call if we need to.';
    if (digits(emergency.phone).length < 7) e['emergency.phone'] = 'Add their phone number.';
    else if (digits(emergency.phone) === digits(customer.phone)) {
      e['emergency.phone'] = 'Use someone who won’t be on the boat with you.';
    }
    if (!acks.manners) e['ack.manners'] = 'Please confirm you’ve watched the video and will follow the rules.';
    if (!acks.waiver) e['ack.waiver'] = 'The waiver is required for everyone on board.';
    if (!acks.cancellation) e['ack.cancellation'] = 'Please confirm you’ve read the cancellation policy.';
    if (!acks.terms) e['ack.terms'] = 'Please confirm you’re 18 or older and agree to the terms.';
    return e;
  }

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (submitting) return;
    setFormError(null);
    const found = validate();
    setErrors(found);
    const firstKey = Object.keys(found)[0];
    if (firstKey) {
      const el = document.getElementById(fieldId(firstKey));
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
      return;
    }

    // createCheckoutSession refuses this too; checking here saves the
    // round trip.
    const departed = `Online booking for the ${tour.startTimeDisplay} departure has closed. For same-day seats, call ${siteConfig.contact.phone}, or pick another departure.`;
    const clock = marinaNow();
    if (departureClosed(date, tour.timeSlot, clock) || departureClosed(date, tour.timeSlot, now)) {
      setFormError(departed);
      return;
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
      emergencyContact: { name: emergency.name.trim(), phone: emergency.phone.trim() },
      guests: roster.map((g) => ({
        name: g.name.trim(),
        age: g.age.trim() === '' ? null : Number(g.age),
      })),
      acknowledgements: { manateeManners: true, liabilityWaiver: true, termsOfService: true },
      termsVersion: TERMS_VERSION,
      // Back from Stripe and trying again: free the first checkout's seats.
      previousBooking: readHold() ?? undefined,
    };

    try {
      const { bookingId, accessToken, checkoutUrl } = await createCheckoutSession(input);
      saveHold({ bookingId, accessToken });
      window.location.assign(checkoutUrl);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof FunctionError && err.status === 409) {
        // This device's clock is behind the marina's.
        if (err.reason === 'departed') setFormError(departed);
        else onUnavailable(err.message);
        return;
      }
      if (err instanceof FunctionError && err.status === 400) {
        const mapped = serverFieldErrors((err.body as { details?: unknown } | null)?.details, guestCount);
        if (Object.keys(mapped).length > 0) {
          setErrors(mapped);
          const el = document.getElementById(fieldId(Object.keys(mapped)[0]!));
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el?.focus({ preventScroll: true });
          return;
        }
      }
      setFormError(
        err instanceof Error && err.message
          ? `We couldn’t start checkout: ${err.message}`
          : 'We couldn’t start checkout. Please try again, or call us to book.',
      );
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="space-y-5">
      <FormCard title="Lead guest" hint="Your confirmation, and any weather call on the day, goes here.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="customer.name" label="Full name" error={errors['customer.name']} className="sm:col-span-2">
            <input
              id={fieldId('customer.name')}
              type="text"
              autoComplete="name"
              maxLength={MAX.name}
              value={customer.name}
              onChange={(e) => {
                setCustomer({ ...customer, name: e.target.value });
                clearError('customer.name');
                clearError('guest.0.name');
              }}
              className={inputClass(errors['customer.name'])}
              aria-invalid={!!errors['customer.name']}
              aria-describedby={errors['customer.name'] ? `${fieldId('customer.name')}-error` : undefined}
            />
          </Field>
          <Field id="customer.email" label="Email" error={errors['customer.email']}>
            <input
              id={fieldId('customer.email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={MAX.email}
              value={customer.email}
              onChange={(e) => {
                setCustomer({ ...customer, email: e.target.value });
                clearError('customer.email');
              }}
              className={inputClass(errors['customer.email'])}
              aria-invalid={!!errors['customer.email']}
              aria-describedby={errors['customer.email'] ? `${fieldId('customer.email')}-error` : undefined}
            />
          </Field>
          <Field id="customer.phone" label="Mobile phone" error={errors['customer.phone']}>
            <input
              id={fieldId('customer.phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={MAX.phone}
              value={customer.phone}
              onChange={(e) => {
                setCustomer({ ...customer, phone: e.target.value });
                clearError('customer.phone');
              }}
              className={inputClass(errors['customer.phone'])}
              aria-invalid={!!errors['customer.phone']}
              aria-describedby={errors['customer.phone'] ? `${fieldId('customer.phone')}-error` : undefined}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard
        title={`Who’s coming (${guestCount})`}
        hint="Names go on the boarding list. Ages help Travis bring the right wetsuit sizes."
      >
        <label className="mb-4 flex cursor-pointer items-center gap-3 text-[0.9375rem]">
          <input
            type="checkbox"
            checked={leadIsGuest}
            onChange={(e) => {
              setLeadIsGuest(e.target.checked);
              clearError('guest.0.name');
            }}
            className="h-5 w-5 rounded border-[var(--color-ink)]/30 accent-[var(--color-spring)]"
          />
          I&rsquo;m one of the {guestCount === 1 ? 'guest' : `${guestCount} guests`}
        </label>
        <ol className="space-y-3">
          {roster.map((g, i) => {
            const locked = i === 0 && leadIsGuest;
            return (
              <li key={i} className="grid grid-cols-[1.5rem_1fr_6.5rem] items-start gap-3">
                <span className="mt-[2.1rem] text-sm font-semibold tabular-nums text-[var(--color-ink-soft)]">
                  {i + 1}
                </span>
                <Field
                  id={`guest.${i}.name`}
                  label={<><span className="sr-only">Guest {i + 1} </span>Name</>}
                  error={errors[`guest.${i}.name`]}
                >
                  <input
                    id={fieldId(`guest.${i}.name`)}
                    type="text"
                    autoComplete="off"
                    maxLength={MAX.name}
                    value={g.name}
                    readOnly={locked}
                    placeholder={locked ? 'Same as lead guest' : undefined}
                    onChange={(e) => {
                      updateGuest(i, { name: e.target.value });
                      clearError(`guest.${i}.name`);
                    }}
                    className={clsx(inputClass(errors[`guest.${i}.name`]), locked && 'bg-[var(--color-paper)] text-[var(--color-ink-soft)]')}
                    aria-invalid={!!errors[`guest.${i}.name`]}
                    aria-describedby={errors[`guest.${i}.name`] ? `${fieldId(`guest.${i}.name`)}-error` : undefined}
                  />
                </Field>
                <Field
                  id={`guest.${i}.age`}
                  label={<><span className="sr-only">Guest {i + 1} </span>Age</>}
                  error={errors[`guest.${i}.age`]}
                >
                  <input
                    id={fieldId(`guest.${i}.age`)}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={3}
                    autoComplete="off"
                    placeholder="Optional"
                    value={g.age}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      updateGuest(i, { age: v });
                      clearError(`guest.${i}.age`);
                    }}
                    className={inputClass(errors[`guest.${i}.age`])}
                    aria-invalid={!!errors[`guest.${i}.age`]}
                    aria-describedby={errors[`guest.${i}.age`] ? `${fieldId(`guest.${i}.age`)}-error` : undefined}
                  />
                </Field>
              </li>
            );
          })}
        </ol>
      </FormCard>

      <FormCard title="Emergency contact" hint="Someone who won’t be on the boat. We hope never to need it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="emergency.name" label="Name" error={errors['emergency.name']}>
            <input
              id={fieldId('emergency.name')}
              type="text"
              autoComplete="off"
              maxLength={MAX.name}
              value={emergency.name}
              onChange={(e) => {
                setEmergency({ ...emergency, name: e.target.value });
                clearError('emergency.name');
              }}
              className={inputClass(errors['emergency.name'])}
              aria-invalid={!!errors['emergency.name']}
              aria-describedby={errors['emergency.name'] ? `${fieldId('emergency.name')}-error` : undefined}
            />
          </Field>
          <Field id="emergency.phone" label="Phone" error={errors['emergency.phone']}>
            <input
              id={fieldId('emergency.phone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={MAX.phone}
              value={emergency.phone}
              onChange={(e) => {
                setEmergency({ ...emergency, phone: e.target.value });
                clearError('emergency.phone');
              }}
              className={inputClass(errors['emergency.phone'])}
              aria-invalid={!!errors['emergency.phone']}
              aria-describedby={errors['emergency.phone'] ? `${fieldId('emergency.phone')}-error` : undefined}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard
        title="Before you get in the water"
        hint="Manatees are federally protected, so these are required for everyone on board."
      >
        <details className="group mb-5 overflow-hidden rounded-xl border border-[var(--color-sand)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-[var(--color-paper)]">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-white">
              <Play size={14} />
            </span>
            <span className="flex-1">
              <span className="block font-semibold">Watch the manatee manners video</span>
              <span className="block text-sm text-[var(--color-ink-soft)]">
                Three minutes, from the U.S. Fish &amp; Wildlife Service. Kid-friendly.
              </span>
            </span>
            <span className="text-sm font-medium text-[var(--color-spring)] group-open:hidden">Play</span>
            <span className="hidden text-sm font-medium text-[var(--color-spring)] group-open:inline">Hide</span>
          </summary>
          <div className="relative aspect-video bg-[var(--color-ink)]">
            <iframe
              src="https://www.youtube-nocookie.com/embed/YP3Erf3Kc2Y"
              title="USFWS manatee manners video"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
        </details>

        <div className="space-y-3">
          <Ack
            id="ack.manners"
            checked={acks.manners}
            error={errors['ack.manners']}
            onChange={(v) => {
              setAcks({ ...acks, manners: v });
              clearError('ack.manners');
            }}
          >
            I&rsquo;ve watched the USFWS manatee manners video and agree to
            follow the rules: passive observation, no touching, no chasing, no
            diving.
          </Ack>
          <Ack
            id="ack.waiver"
            checked={acks.waiver}
            error={errors['ack.waiver']}
            onChange={(v) => {
              setAcks({ ...acks, waiver: v });
              clearError('ack.waiver');
            }}
          >
            I&rsquo;m signing the standard liability waiver on behalf of
            everyone in my party. Snorkeling carries inherent risks; we follow
            our captain&rsquo;s instructions at all times.{' '}
            <Link href="/terms#liability" target="_blank" className="underline underline-offset-2">
              Liability terms
            </Link>
          </Ack>
          <Ack
            id="ack.cancellation"
            checked={acks.cancellation}
            error={errors['ack.cancellation']}
            onChange={(v) => {
              setAcks({ ...acks, cancellation: v });
              clearError('ack.cancellation');
            }}
          >
            I&rsquo;ve read the{' '}
            <Link href="/cancellation-policy" target="_blank" className="underline underline-offset-2">
              cancellation policy
            </Link>
            : 72+ hours before, full refund; 24 to 72 hours, 50%; under 24 hours,
            no refund. If Travis cancels for weather, you&rsquo;re always
            refunded in full.
          </Ack>
          <Ack
            id="ack.terms"
            checked={acks.terms}
            error={errors['ack.terms']}
            onChange={(v) => {
              setAcks({ ...acks, terms: v });
              clearError('ack.terms');
            }}
          >
            I&rsquo;m 18 or older and agree to the{' '}
            <Link href="/terms" target="_blank" className="underline underline-offset-2">
              Terms of Service
            </Link>
            , and I&rsquo;ve read the{' '}
            <Link href="/privacy" target="_blank" className="underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </Ack>
        </div>
      </FormCard>

      {formError && (
        <div role="alert" className="flex gap-3 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-4 py-3 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-[var(--color-error)]" />
          {formError}
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm font-medium text-[var(--color-error)]">
          {Object.keys(errors).length === 1
            ? 'One thing to fix above before you can pay.'
            : `${Object.keys(errors).length} things to fix above before you can pay.`}
        </p>
      )}
    </form>
  );
}

function fieldId(key: string) {
  return `f-${key.replace(/\./g, '-')}`;
}

function inputClass(error?: string) {
  return clsx(
    'h-12 w-full rounded-lg border bg-white px-3.5 text-base text-[var(--color-ink)] transition-colors',
    'placeholder:text-[var(--color-ink-soft)]/60 focus:outline-none focus:ring-2',
    error
      ? 'border-[var(--color-error)] focus:ring-[var(--color-error)]/20'
      : 'border-[var(--color-ink)]/20 focus:border-[var(--color-ink)] focus:ring-[var(--color-spring)]/20',
  );
}

function FormCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-sand)] bg-white p-5 sm:p-7">
      <h2 className="text-[1.2rem] font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  optional,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  optional?: boolean;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={fieldId(id)} className="mb-1.5 block text-sm font-medium">
        {label}
        {optional && <span className="font-normal text-[var(--color-ink-soft)]"> (optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${fieldId(id)}-error`} className="mt-1.5 text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}

function Ack({
  id,
  checked,
  onChange,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        className={clsx(
          'flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors',
          checked
            ? 'border-[var(--color-spring)]/40 bg-[var(--color-mist)]/60'
            : error
              ? 'border-[var(--color-error)]/50'
              : 'border-[var(--color-sand)] hover:border-[var(--color-ink)]/30',
        )}
      >
        <input
          id={fieldId(id)}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId(id)}-error` : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 rounded accent-[var(--color-spring)]"
        />
        <span className="text-[0.9375rem] leading-relaxed">{children}</span>
      </label>
      {error && (
        <p id={`${fieldId(id)}-error`} className="mt-1.5 text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}
