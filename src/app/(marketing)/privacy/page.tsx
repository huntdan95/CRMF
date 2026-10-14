import type { Metadata } from 'next';
import Link from 'next/link';
import { Section } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';

const title = 'Privacy Policy';
const description =
  'How Crystal River Manatee Fun collects, uses, and protects your information when you book a tour or contact us.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/privacy', { title, description }),
};

const LAST_UPDATED = 'May 2026';

export default function PrivacyPolicyPage() {
  return (
    <>
      <Section tone="paper" size="md" container="prose" className="!pb-8">
        <h1 className="text-display text-[2.6rem] sm:text-6xl">Privacy Policy</h1>
        <p className="mt-5 text-[var(--color-ink-soft)]">Last updated: {LAST_UPDATED}</p>
      </Section>

      <Section tone="paper" size="sm" container="prose" className="!pt-0 pb-20 sm:pb-28">
        <article className=" prose-content">
          <Disclaimer />

          <H2 id="what-we-collect">What we collect</H2>
          <P>
            We only collect what we need to run the tour business:
          </P>
          <ul className="list-disc pl-6 space-y-1 text-[var(--color-ink-soft)]">
            <li>
              <strong>Booking information:</strong> name, email, phone, the
              names and ages of guests in your party, an emergency contact,
              and the date / time slot you booked.
            </li>
            <li>
              <strong>Payment information:</strong> handled by Stripe, not
              by us. We never see or store your card number, expiration, or
              CVC. We do store a Stripe payment-intent id so we can issue
              refunds.
            </li>
            <li>
              <strong>Contact-form submissions:</strong> the message body
              and the contact details you put in the form.
            </li>
            <li>
              <strong>Signed liability waivers:</strong> each signer&rsquo;s
              name, date of birth, email, phone, and home address; the names
              and dates of birth of children a parent or guardian signs for,
              and their relationship to them; the signature (drawn or
              typed), initials and the times they were given; and the IP
              address, browser and device used to sign, kept as a record of
              who signed and when.
            </li>
            <li>
              <strong>Analytics:</strong> via Firebase Analytics (a Google
              service), we collect anonymous usage data — pages visited,
              browser type, approximate location from IP. This is to
              understand which pages help people decide and which don&rsquo;t.
            </li>
          </ul>

          <H2 id="how-we-use-it">How we use it</H2>
          <ul className="list-disc pl-6 space-y-1 text-[var(--color-ink-soft)]">
            <li>To run your tour — confirmation, weather updates, etc.</li>
            <li>To process refunds and reschedules.</li>
            <li>To send the post-tour follow-up with photos when available.</li>
            <li>
              To respond to messages you send via the contact form.
            </li>
            <li>
              To improve the site based on aggregate analytics. We do not
              build customer profiles for advertising.
            </li>
          </ul>

          <H2 id="who-we-share-with">Who we share it with</H2>
          <P>
            We don&rsquo;t sell or rent your information. We use a small set
            of vendors to actually run the site, and each one only sees what
            they need:
          </P>
          <ul className="list-disc pl-6 space-y-1 text-[var(--color-ink-soft)]">
            <li>
              <strong>Stripe</strong> — processes payments and refunds.
              Sees your card details (we don&rsquo;t) and your contact info
              for fraud screening.{' '}
              <a
                href="https://stripe.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                Stripe&rsquo;s privacy policy
              </a>
            </li>
            <li>
              <strong>Firebase / Google Cloud</strong> — hosts our database,
              authentication, file storage, and analytics.{' '}
              <a
                href="https://firebase.google.com/support/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                Firebase privacy
              </a>
            </li>
            <li>
              <strong>Resend</strong> — sends transactional email
              (confirmations, cancellations, etc.).{' '}
              <a
                href="https://resend.com/legal/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
              >
                Resend privacy
              </a>
            </li>
          </ul>

          <H2 id="cookies">Cookies</H2>
          <P>
            We set a small number of essential cookies — primarily for the
            admin login session and Firebase Analytics. We don&rsquo;t use
            advertising or cross-site tracking cookies. You can disable
            cookies in your browser; the booking flow still works.
          </P>

          <H2 id="retention">How long we keep your information</H2>
          <P>
            Bookings (including guest names and contact info) are kept
            indefinitely so we can look them up when you re-book years
            later. If you&rsquo;d like your records permanently deleted,
            contact us as described below and we&rsquo;ll remove them
            (with the legal exception of payment records Stripe is required
            to retain).
          </P>
          <P>
            Signed waivers, their PDF copies and signature images are legal
            records: we keep them at least 7 years after the tour (for a
            child, until at least 7 years after they turn 18), and can&rsquo;t
            delete them on request before then.
          </P>

          <H2 id="your-rights">Your rights</H2>
          <P>
            You can ask us to: (1) tell you what we have on file about you,
            (2) correct anything that&rsquo;s wrong, (3) delete what
            isn&rsquo;t legally required. Call or text{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              {siteConfig.contact.phone}
            </a>{' '}
            or use the contact form.
          </P>

          <H2 id="children">Children</H2>
          <P>
            The site isn&rsquo;t directed at children under 13 and we
            don&rsquo;t knowingly collect information from them. We do take
            bookings that include kids — those records list the kid&rsquo;s
            name and (optionally) age, supplied by a parent.
          </P>

          <H2 id="changes">Changes to this policy</H2>
          <P>
            We&rsquo;ll update this page if practices change. The
            &ldquo;Last updated&rdquo; date at the top changes when we do.
          </P>

          <H2 id="contact">Questions</H2>
          <P>
            Call{' '}
            <a
              href={siteConfig.contact.phoneHref}
              className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]"
            >
              {siteConfig.contact.phone}
            </a>{' '}
            or use the{' '}
            <Link href="/contact" className="font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]">
              contact form
            </Link>
            .
          </P>
        </article>
      </Section>
    </>
  );
}

function Disclaimer() {
  return (
    <div className="rounded-xl border border-[var(--color-sand)] bg-white px-5 py-4 text-sm text-[var(--color-ink-soft)] mb-8">
      This page describes how the site actually works in plain English. It
      isn&rsquo;t a substitute for advice from your attorney — if you have
      a specific legal question, ask a lawyer.
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 mb-3 text-[1.4rem] font-bold sm:text-[1.6rem]"
    >
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-[1.0625rem] leading-relaxed text-[var(--color-ink-soft)]">
      {children}
    </p>
  );
}
