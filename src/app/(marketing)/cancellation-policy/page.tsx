import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';
import {
  fetchSiteSettings,
  DEFAULT_CANCELLATION_POLICY,
} from '@/lib/settings-server';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Cancellation Policy',
  description:
    'Refund and cancellation policy for Crystal River Manatee Fun tours. 72+ hours: full refund. 24-72 hours: 50%. Less than 24 hours: no refund. Travis-cancelled: always full.',
  alternates: { canonical: `${siteConfig.url}/cancellation-policy` },
};

const TIERS = [
  {
    when: '72+ hours before your tour',
    refund: 'Full refund',
    color:
      'bg-[var(--color-brand-blue)]/10 border-[var(--color-brand-blue)]/25 text-[var(--color-brand-blue-dark)]',
  },
  {
    when: '24 to 72 hours before',
    refund: '50% refund',
    color:
      'bg-[var(--color-coral)]/10 border-[var(--color-coral)]/25 text-[var(--color-coral-dark)]',
  },
  {
    when: 'Less than 24 hours',
    refund: 'No refund',
    color:
      'bg-[var(--color-ink)]/8 border-[var(--color-ink)]/15 text-[var(--color-ink-soft)]',
  },
  {
    when: 'Travis-cancelled (weather, etc.)',
    refund: 'Always full refund',
    color:
      'bg-[var(--color-manatee)]/15 border-[var(--color-manatee)]/30 text-[var(--color-ink)]',
  },
];

export default async function CancellationPolicyPage() {
  const settings = await fetchSiteSettings();
  const policyText =
    settings?.cancellationPolicyText?.trim() || DEFAULT_CANCELLATION_POLICY;

  return (
    <>
      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            Cancellation Policy
          </p>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl leading-[1.05]">
            Plans change.<br />
            <span className="text-[var(--color-ink-soft)]">Here&rsquo;s how that works.</span>
          </h1>
        </div>
      </Section>

      <Section tone="white" size="md">
        <div className="max-w-4xl grid gap-4 sm:grid-cols-2">
          {TIERS.map((t) => (
            <article
              key={t.when}
              className={`rounded-2xl border p-5 sm:p-6 ${t.color}`}
            >
              <p className="text-xs uppercase tracking-[0.15em] font-semibold opacity-80">
                {t.when}
              </p>
              <p className="mt-2 font-display text-2xl sm:text-3xl leading-tight">
                {t.refund}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <h2 className="font-display text-2xl sm:text-3xl mb-4">The full text</h2>
          <div className="rounded-2xl bg-white border border-[var(--color-ink)]/8 p-6 whitespace-pre-wrap text-base leading-relaxed text-[var(--color-ink)]">
            {policyText}
          </div>
          <p className="mt-4 text-xs text-[var(--color-ink-soft)]">
            Specific situations Travis is reasonable about — illness, family
            emergencies, the weather forecast quietly turning bad. Call{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              {siteConfig.contact.phone}
            </a>
            ; he picks up.
          </p>
        </div>
      </Section>

      <Section tone="white" size="md">
        <div className="max-w-3xl">
          <h2 className="font-display text-2xl sm:text-3xl mb-4">How to cancel</h2>
          <ol className="space-y-4 text-base leading-relaxed text-[var(--color-ink)]">
            <li>
              <strong>Use your booking link.</strong> The confirmation email
              we sent you includes a link to <code className="font-mono text-sm bg-[var(--color-cream)] px-1.5 py-0.5 rounded">/my-booking/[id]</code>.
              That page has &ldquo;Request cancellation&rdquo; — you&rsquo;ll
              see the refund amount before you confirm.
            </li>
            <li>
              <strong>Or call us.</strong> If you can&rsquo;t find the email,{' '}
              <a
                href={siteConfig.contact.phoneHref}
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                {siteConfig.contact.phone}
              </a>{' '}
              works any time of day. Travis can look up your booking.
            </li>
            <li>
              <strong>Or email.</strong> Reply to the booking confirmation
              email and Travis will see it.
            </li>
          </ol>
        </div>
      </Section>

      <Section tone="blue" size="md">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Still ready to book?
          </h2>
          <p className="mt-3 text-white/85">
            72-hour refund window means you can lock in dates with low risk.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <Button href="/book" size="lg">
              See available dates
            </Button>
            <Link
              href="/faq"
              className="inline-flex items-center px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
            >
              Other questions
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
