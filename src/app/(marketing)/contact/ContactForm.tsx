'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { submitContactForm, type ContactFormState } from './actions';
import { buttonClasses } from '@/components/ui/Button';
import { ArrowRight, Check, Info, Spinner } from '@/components/ui/icons';
import { clsx } from '@/lib/clsx';

const initialState: ContactFormState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClasses({ size: 'lg', className: 'w-full sm:w-auto' })}>
      {pending ? (
        <>
          <Spinner size={18} />
          Sending…
        </>
      ) : (
        <>
          Send message
          <ArrowRight size={18} />
        </>
      )}
    </button>
  );
}

function inputClass(error?: string) {
  return clsx(
    'w-full rounded-lg border bg-white px-3.5 text-base text-[var(--color-ink)] transition-colors',
    'placeholder:text-[var(--color-ink-soft)]/60 focus:outline-none focus:ring-2',
    // Half-strength ink is the lightest border that still shows where the
    // box is (3:1 on white).
    error
      ? 'border-[var(--color-error)] focus:ring-[var(--color-error)]/20'
      : 'border-[var(--color-ink)]/50 focus:border-[var(--color-ink)] focus:ring-[var(--color-spring)]/20',
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {optional && <span className="font-normal text-[var(--color-ink-soft)]"> (optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}

export function ContactForm() {
  const [state, formAction] = useActionState(submitContactForm, initialState);
  const errors = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);

  // After a send, the form focus was in is gone: swapped for the thank-you,
  // or remounted to refill it. Take focus to the answer, so screen readers
  // hear it: the thank-you, else the first field to fix, else the message
  // saying what went wrong.
  useEffect(() => {
    if (state.status === 'success') sentRef.current?.focus();
    if (state.status === 'error') {
      (formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? alertRef.current)?.focus();
    }
  }, [state]);

  if (state.status === 'success') {
    return (
      <div
        ref={sentRef}
        tabIndex={-1}
        className="rounded-2xl border border-[var(--color-spring)]/25 bg-[var(--color-mist)] p-7 outline-none"
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-spring)] text-white">
          <Check size={22} />
        </span>
        <h3 className="mt-4 text-2xl font-bold">Message sent</h3>
        <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{state.message}</p>
      </div>
    );
  }

  return (
    // Keyed on the returned values so the fields refill after a failed send.
    <form ref={formRef} key={JSON.stringify(v)} action={formAction} className="space-y-5" noValidate>
      <div aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
        <label>
          Leave blank
          <input type="text" name="_hp" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Your name" error={errors.name}>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            defaultValue={v.name}
            className={clsx(inputClass(errors.name), 'h-12')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'name-error' : undefined}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={v.email}
            className={clsx(inputClass(errors.email), 'h-12')}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
        </Field>
        <Field id="phone" label="Phone" optional error={errors.phone}>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={v.phone}
            className={clsx(inputClass(errors.phone), 'h-12')}
            aria-invalid={!!errors.phone}
          />
        </Field>
        <Field id="subject" label="Subject" optional error={errors.subject}>
          <input
            id="subject"
            name="subject"
            type="text"
            defaultValue={v.subject}
            className={clsx(inputClass(errors.subject), 'h-12')}
            placeholder="A private tour, a big group…"
            aria-invalid={!!errors.subject}
          />
        </Field>
      </div>

      <Field id="message" label="Message" error={errors.message}>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          minLength={10}
          maxLength={4000}
          defaultValue={v.message}
          className={clsx(inputClass(errors.message), 'py-3')}
          placeholder="Your dates, how many of you, and anything Travis should know."
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'message-error' : undefined}
        />
      </Field>

      {state.status === 'error' && state.message && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex gap-3 rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-4 py-3 text-sm"
        >
          <Info size={18} className="mt-0.5 shrink-0 text-[var(--color-error)]" />
          {state.message}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
