'use client';

import { useState, type FormEvent } from 'react';
import { FunctionError, submitFeedback } from '@/lib/functions-client';
import { siteConfig } from '@/lib/site-config';
import { buttonClasses } from '@/components/ui/Button';

const MAX = 4000;

export function FeedbackForm({ bookingId, accessToken }: { bookingId: string; accessToken: string }) {
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      setError('Write a few words first.');
      return;
    }
    setState('sending');
    setError(null);
    try {
      await submitFeedback({ bookingId, accessToken, message: message.trim() });
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(
        err instanceof FunctionError && err.status < 500
          ? err.message
          : `That didn’t send. Try again, or call or text Travis at ${siteConfig.contact.phone}.`,
      );
    }
  }

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-2xl border border-[var(--color-spring)]/30 bg-[var(--color-mist)]/60 p-6">
        <p className="text-lg font-semibold">Thanks. Travis has it.</p>
        <p className="mt-2 text-[var(--color-ink-soft)]">
          He’ll get back to you at the email or phone number on your booking.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-[var(--color-sand)] bg-white p-5 sm:p-7 space-y-4">
      <label htmlFor="feedback-message" className="block text-sm font-medium">
        What happened?
      </label>
      <textarea
        id="feedback-message"
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          setError(null);
        }}
        rows={7}
        maxLength={MAX}
        className="w-full rounded-lg border border-[var(--color-ink)]/20 bg-white px-3.5 py-3 text-base focus:border-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-spring)]/20"
        aria-invalid={!!error}
        aria-describedby={error ? 'feedback-error' : undefined}
      />
      {error && (
        <p id="feedback-error" role="alert" className="text-sm text-[var(--color-error)]">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === 'sending'} className={buttonClasses({ variant: 'primary', size: 'lg' })}>
        {state === 'sending' ? 'Sending…' : 'Send to Travis'}
      </button>
    </form>
  );
}
