'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitContactForm, type ContactFormState } from './actions';

const initialState: ContactFormState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center px-7 py-3.5 rounded-full bg-[var(--color-coral)] hover:bg-[var(--color-coral-dark)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-base transition-colors w-full sm:w-auto"
    >
      {pending ? 'Sending...' : 'Send message'}
    </button>
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-xs text-[var(--color-coral-dark)]">{children}</p>
  );
}

const inputClass =
  'w-full rounded-2xl border border-[var(--color-ink)]/15 bg-white px-4 py-3 text-base placeholder:text-[var(--color-ink-soft)]/60 focus:border-[var(--color-brand-blue)] focus:outline-2 focus:outline-[var(--color-brand-blue)]/20';

export function ContactForm() {
  const [state, formAction] = useActionState(submitContactForm, initialState);

  if (state.status === 'success') {
    return (
      <div className="rounded-2xl bg-[var(--color-brand-blue)]/8 border border-[var(--color-brand-blue)]/20 p-6">
        <h3 className="font-display text-2xl text-[var(--color-brand-blue)]">
          Message sent
        </h3>
        <p className="mt-2 text-[var(--color-ink)] leading-relaxed">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <div aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
        <label>
          Leave blank
          <input type="text" name="_hp" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-[var(--color-ink)] mb-1"
          >
            Your name <span className="text-[var(--color-coral-dark)]">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className={inputClass}
            aria-invalid={!!state.fieldErrors?.name}
          />
          <FieldError>{state.fieldErrors?.name}</FieldError>
        </div>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-[var(--color-ink)] mb-1"
          >
            Email <span className="text-[var(--color-coral-dark)]">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            aria-invalid={!!state.fieldErrors?.email}
          />
          <FieldError>{state.fieldErrors?.email}</FieldError>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-[var(--color-ink)] mb-1"
          >
            Phone <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
            aria-invalid={!!state.fieldErrors?.phone}
          />
          <FieldError>{state.fieldErrors?.phone}</FieldError>
        </div>
        <div>
          <label
            htmlFor="subject"
            className="block text-sm font-medium text-[var(--color-ink)] mb-1"
          >
            Subject <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            className={inputClass}
            placeholder="Booking a private tour, dates, etc."
            aria-invalid={!!state.fieldErrors?.subject}
          />
          <FieldError>{state.fieldErrors?.subject}</FieldError>
        </div>
      </div>

      <div>
        <label
          htmlFor="message"
          className="block text-sm font-medium text-[var(--color-ink)] mb-1"
        >
          Message <span className="text-[var(--color-coral-dark)]">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          minLength={10}
          maxLength={4000}
          className={inputClass}
          placeholder="Tell us about your trip — dates, group size, anything we should know."
          aria-invalid={!!state.fieldErrors?.message}
        />
        <FieldError>{state.fieldErrors?.message}</FieldError>
      </div>

      {state.status === 'error' && state.message && (
        <div
          role="alert"
          className="rounded-2xl bg-[var(--color-coral)]/10 border border-[var(--color-coral)]/30 px-4 py-3 text-sm text-[var(--color-ink)]"
        >
          {state.message}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
