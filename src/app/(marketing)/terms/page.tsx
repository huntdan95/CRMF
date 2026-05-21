import type { Metadata } from 'next';
import Link from 'next/link';
import { Section } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'Terms for booking and taking Crystal River Manatee Fun tours — payment, conduct, liability, weather, and applicable law.',
  alternates: { canonical: `${siteConfig.url}/terms` },
};

const LAST_UPDATED = 'May 2026';

export default function TermsPage() {
  return (
    <>
      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
            Terms
          </p>
          <h1 className="mt-4 font-display text-5xl sm:text-6xl leading-[1.05]">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </Section>

      <Section tone="white" size="md">
        <article className="max-w-3xl">
          <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 px-5 py-4 text-sm text-[var(--color-ink-soft)] mb-8">
            Plain-English terms. Not a substitute for legal advice — ask a
            lawyer if you have a specific question.
          </div>

          <H2 id="acceptance">Booking a tour</H2>
          <P>
            When you book a tour by paying through this site (or any other
            way), you agree to these terms. If you&rsquo;re booking on
            behalf of a group, you&rsquo;re agreeing on their behalf too —
            please share these terms with your party.
          </P>

          <H2 id="payment">Payment</H2>
          <P>
            Tours must be paid in full at booking. Payments are processed
            by Stripe; we don&rsquo;t see your card details. Prices are
            shown in U.S. dollars and include all fees.
          </P>

          <H2 id="cancellation">Cancellations & refunds</H2>
          <P>
            Cancellations and refunds are governed by our{' '}
            <Link
              href="/cancellation-policy"
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              cancellation policy
            </Link>
            . Travis-cancelled tours (weather, mechanical issues, etc.)
            always get a full refund.
          </P>

          <H2 id="weather">Weather</H2>
          <P>
            We tour rain or shine when conditions are safe. Travis is the
            final call on whether to launch. If he cancels for weather,
            you get a full refund and we try to re-book you on a better
            day if you&rsquo;re still in town.
          </P>

          <H2 id="conduct">In-water conduct</H2>
          <P>
            Manatees are a federally protected species. Every guest agrees
            during booking to follow USFWS{' '}
            <Link
              href="/about#manners"
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              manatee manners
            </Link>
            : passive observation only, no touching, no chasing, no diving,
            no flash photography. Travis will end the tour for any guest
            who repeatedly violates these rules; no refund is owed in that
            case.
          </P>

          <H2 id="liability">Liability & assumption of risk</H2>
          <P>
            Snorkeling involves inherent risks. You acknowledge these and
            agree to hold {siteConfig.legal.businessName}, Travis Urbin,
            our partners, and crew harmless from injury or loss arising
            from ordinary tour activities, except in cases of gross
            negligence. Guests under 18 are the responsibility of the
            accompanying adult.
          </P>
          <P>
            If you have a medical condition that could be affected by
            cold-water immersion or moderate exercise, please tell us
            before booking.
          </P>

          <H2 id="property">Personal property</H2>
          <P>
            We&rsquo;re not responsible for personal items lost on the
            boat or in the water. We provide a dry bag on the boat for
            phones and keys; use it.
          </P>

          <H2 id="photography">Photography & media</H2>
          <P>
            We sometimes take photos and video on tours — including the
            free GoPro shots we send you afterward. By taking a tour you
            give us permission to use those images on the website and on
            social media (Instagram, Facebook). If you&rsquo;d rather not
            appear in published photos, just tell Travis at the dock.
          </P>

          <H2 id="contracts">No third-party contracts</H2>
          <P>
            We don&rsquo;t sell through Viator, FareHarbor, or any other
            third-party platform. If you booked through one and were sent
            here, your contract is with them — not us. Reach out directly
            and we&rsquo;ll help sort it out.
          </P>

          <H2 id="changes">Changes to these terms</H2>
          <P>
            We update this page from time to time. The version in effect at
            the moment you booked governs your tour.
          </P>

          <H2 id="law">Governing law</H2>
          <P>
            These terms are governed by the laws of the State of Florida.
            Any disputes will be resolved in Citrus County, Florida.
          </P>

          <H2 id="contact">Questions</H2>
          <P>
            Call{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              {siteConfig.contact.phone}
            </a>{' '}
            or use the{' '}
            <Link
              href="/contact"
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              contact form
            </Link>
            .
          </P>
        </article>
      </Section>
    </>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display text-2xl sm:text-3xl mt-10 mb-3 scroll-mt-24"
    >
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base leading-relaxed text-[var(--color-ink-soft)] mb-4">
      {children}
    </p>
  );
}
