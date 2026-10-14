import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { ArrowRight, Calendar, Shield } from '@/components/ui/icons';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import {
  fetchSiteSettings,
  DEFAULT_CANCELLATION_POLICY,
} from '@/lib/settings-server';

export const revalidate = 60;

const title = 'Cancellation Policy';
const description =
  'Refund and cancellation policy for Crystal River Manatee Fun tours. 72+ hours: full refund. 24-72 hours: 50%. Less than 24 hours: no refund. Travis-cancelled: always full.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/cancellation-policy', { title, description }),
};

const TIERS = [
  { when: '72+ hours before', refund: 'Full refund', tone: 'bg-[var(--color-spring)] text-white' },
  { when: '24 to 72 hours before', refund: '50% refund', tone: 'bg-[var(--color-mist)] text-[var(--color-ink)]' },
  { when: 'Less than 24 hours', refund: 'No refund', tone: 'bg-[var(--color-sand)] text-[var(--color-ink)]' },
];

export default async function CancellationPolicyPage() {
  const settings = await fetchSiteSettings();
  const policyText =
    settings?.cancellationPolicyText?.trim() || DEFAULT_CANCELLATION_POLICY;

  return (
    <>
      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="Cancellation policy"
          description="Plans change. Here’s exactly what happens to your money when they do."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0">
        <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
          <div className="grid sm:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t.when} className={`p-6 sm:p-8 ${t.tone}`}>
                <p className="text-sm font-medium opacity-80">{t.when}</p>
                <p className="mt-2 text-display text-[1.9rem] sm:text-[2.2rem]">{t.refund}</p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-3 border-t border-[var(--color-sand)] p-6 sm:px-8">
            <Shield size={22} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
            <p className="text-[1.0625rem]">
              <span className="font-semibold">If Travis cancels, you always get a full refund.</span>{' '}
              <span className="text-[var(--color-ink-soft)]">
                Weather, mechanical trouble, anything on our side.
              </span>
            </p>
          </div>
          <div className="flex items-start gap-3 border-t border-[var(--color-sand)] p-6 sm:px-8">
            <Calendar size={22} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
            <p className="text-[1.0625rem]">
              <span className="font-semibold">Free date changes, and a no-manatee guarantee.</span>{' '}
              <span className="text-[var(--color-ink-soft)]">
                Move your tour at no charge when the new departure has space.
                If we go out and don&rsquo;t see a manatee, we&rsquo;ll re-book
                you on another tour for free.
              </span>
            </p>
          </div>
        </div>
      </Section>

      <Section tone="paper" size="md">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-display text-[1.9rem] sm:text-[2.4rem]">How to cancel</h2>
            <ol className="mt-8 space-y-6">
              {[
                {
                  t: 'Use your booking link.',
                  b: 'Your confirmation email has a link to manage your booking. It shows the refund amount before you confirm anything.',
                },
                {
                  t: 'Or call.',
                  b: `${siteConfig.contact.phone} works any time of day. Travis can look up your booking.`,
                },
                {
                  t: 'Or reply to your confirmation email.',
                  b: 'It goes straight to Travis.',
                },
              ].map((step, i) => (
                <li key={step.t} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-mist)] text-display text-[var(--color-spring)]">
                    {i + 1}
                  </span>
                  <p className="pt-1.5 leading-relaxed">
                    <span className="font-semibold">{step.t}</span>{' '}
                    <span className="text-[var(--color-ink-soft)]">{step.b}</span>
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-8 rounded-xl bg-white p-5 text-[var(--color-ink-soft)]">
              Travis is reasonable about real life: illness, family emergencies,
              a forecast quietly turning bad. Call{' '}
              <a href={siteConfig.contact.phoneHref} className="font-medium text-[var(--color-ink)] underline underline-offset-2">
                {siteConfig.contact.phone}
              </a>
              ; he picks up.
            </p>
          </div>
          <div>
            <h2 className="text-display text-[1.9rem] sm:text-[2.4rem]">The full policy</h2>
            <div className="mt-8 whitespace-pre-wrap rounded-2xl border border-[var(--color-sand)] bg-white p-6 leading-relaxed sm:p-8">
              {policyText}
            </div>
          </div>
        </div>
      </Section>

      <section className="bg-[var(--color-spring-deep)] text-white">
        <Container className="flex flex-col gap-8 py-16 sm:py-20 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-display text-[2.1rem] sm:text-5xl">Still ready to book?</h2>
            <p className="mt-3 text-lg text-white/75">
              With a 72-hour full-refund window, you can lock in dates early.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href="/book" size="lg">
              See available dates
              <ArrowRight size={18} />
            </Button>
            <Button href="/faq" size="lg" variant="glass">
              Other questions
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
