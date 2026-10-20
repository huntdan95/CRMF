import type { Metadata } from 'next';
import Link from 'next/link';
import { Section } from '@/components/marketing/Section';
import { siteConfig, publicContactEmail } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';
import { PRIVACY_VERSION, formatLegalDate } from '@/lib/legal';

const title = 'Privacy Policy';
const description =
  'How Crystal River Manatee Fun collects, uses, and protects your information when you book a tour or contact us.';

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/privacy', { title, description }),
};

const LAST_UPDATED = formatLegalDate(PRIVACY_VERSION);

const linkClass =
  'font-medium text-[var(--color-spring)] underline underline-offset-2 hover:text-[var(--color-ink)]';

export default function PrivacyPolicyPage() {
  const email = publicContactEmail();
  return (
    <>
      <Section tone="paper" size="md" container="prose" className="!pb-8">
        <h1 className="text-display text-[2.6rem] sm:text-6xl">Privacy Policy</h1>
        <p className="mt-5 text-[var(--color-ink-soft)]">Last updated: {LAST_UPDATED}</p>
      </Section>

      <Section tone="paper" size="sm" container="prose" className="!pt-0 pb-20 sm:pb-28">
        <article className=" prose-content">
          <Disclaimer />

          <P>
            This policy covers this website and the tours run by{' '}
            {siteConfig.legal.businessName} (&ldquo;we&rdquo;).
          </P>

          <H2 id="what-we-collect">What we collect</H2>
          <P>
            We only collect what we need to run the tour business:
          </P>
          <ul className="list-disc pl-6 space-y-1 text-[var(--color-ink-soft)]">
            <li>
              <strong>Booking information:</strong> name, email, phone, the
              names and ages of guests in your party, an emergency contact,
              the date / time slot you booked, and that you agreed to our
              terms and the manatee rules.
            </li>
            <li>
              <strong>Payment information:</strong> handled by Stripe, not
              by us. We never see or store your card number, expiration, or
              CVC. We do store a Stripe payment-intent id so we can issue
              refunds.
            </li>
            <li>
              <strong>Trip photos:</strong> the underwater photos and video
              our crew takes on your tour. They can show you and everyone in
              your party, including children.
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
              <strong>Analytics:</strong> Google Analytics (part of
              Firebase) records the pages you visit, your browser and device
              type, and your approximate location from your IP address. It
              links your visits with a random ID kept in a cookie, so it
              isn&rsquo;t anonymous, but it doesn&rsquo;t give us your name
              or email.
            </li>
          </ul>

          <H2 id="how-we-use-it">How we use it</H2>
          <ul className="list-disc pl-6 space-y-1 text-[var(--color-ink-soft)]">
            <li>To run your tour — confirmation, weather calls, the boarding list.</li>
            <li>To process refunds and reschedules.</li>
            <li>To send your trip photos, and one email afterward asking how the tour went.</li>
            <li>
              To respond to messages you send via the contact form.
            </li>
            <li>
              To improve the site based on aggregate analytics. We do not
              build customer profiles for advertising, and we don&rsquo;t
              put you on a mailing list.
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
              <A href="https://stripe.com/privacy">Stripe&rsquo;s privacy policy</A>
            </li>
            <li>
              <strong>Firebase / Google Cloud</strong> — hosts our database,
              sign-in, file storage, and Google Analytics.{' '}
              <A href="https://firebase.google.com/support/privacy">Firebase privacy</A>
            </li>
            <li>
              <strong>Google Drive</strong> — stores each trip&rsquo;s photos
              with that trip&rsquo;s guest list: names, email addresses, party
              size, and the names of everyone in each party.{' '}
              <A href="https://policies.google.com/privacy">Google&rsquo;s privacy policy</A>
            </li>
            <li>
              <strong>xAI (Grok)</strong> — an AI assistant built on xAI&rsquo;s
              Grok reads each trip&rsquo;s guest list and photos from that
              Drive folder and emails the photos to the guests. So xAI
              processes guest names, email addresses, and photos.{' '}
              <A href="https://x.ai/legal/privacy-policy">xAI&rsquo;s privacy policy</A>
            </li>
            <li>
              <strong>Resend</strong> — sends our email (confirmations,
              cancellations, etc.).{' '}
              <A href="https://resend.com/legal/privacy-policy">Resend privacy</A>
            </li>
            <li>
              <strong>Open-Meteo</strong> — the weather forecast on the
              booking page loads straight from Open-Meteo, which sees your IP
              address.{' '}
              <A href="https://open-meteo.com/en/terms">Open-Meteo terms and privacy</A>
            </li>
            <li>
              <strong>YouTube</strong> — if you play the manatee manners video
              while booking, it loads from YouTube&rsquo;s privacy-enhanced
              mode, and Google&rsquo;s privacy policy applies.
            </li>
            <li>
              <strong>Other guests on your tour</strong> — we email a
              trip&rsquo;s photos to every group on that boat, so photos from
              a shared tour can reach the other groups. If you&rsquo;d rather
              not be photographed, tell Travis at the dock.
            </li>
          </ul>
          <P>
            We may also share information when the law requires it, for
            example to answer a subpoena.
          </P>

          <H2 id="cookies">Cookies</H2>
          <P>
            The site sets a sign-in cookie only for Travis and his crew,
            and Google Analytics sets cookies that recognize a returning
            browser.
            Analytics cookies aren&rsquo;t needed for the site to work: block
            them in your browser, or install{' '}
            <A href="https://tools.google.com/dlpage/gaoptout">Google&rsquo;s Analytics opt-out add-on</A>,
            and booking still works. We don&rsquo;t use advertising cookies.
            While you fill in the booking form, your browser keeps a draft in
            session storage so a refresh doesn&rsquo;t lose it; it&rsquo;s
            cleared when you close the tab.
          </P>

          <H2 id="do-not-track">Do Not Track</H2>
          <P>
            Some browsers send a &ldquo;Do Not Track&rdquo; signal. There&rsquo;s
            no agreed standard for what it should mean, so the site
            doesn&rsquo;t change how it works when it gets one. Apart from
            Google Analytics, and YouTube if you play the video, no other
            company collects information about what you do on this site. To
            turn analytics off, use Google&rsquo;s opt-out add-on above.
          </P>

          <H2 id="retention">How long we keep your information</H2>
          <P>
            Bookings (including guest names and contact info) are kept
            indefinitely so we can look them up when you re-book years
            later. Trip photos and each trip&rsquo;s guest list stay in our
            Google Drive until we delete them. If you&rsquo;d like your
            records or photos permanently deleted, contact us as described
            below and we&rsquo;ll remove them. We can&rsquo;t delete
            payment records Stripe is legally required to keep, or call back
            photos already emailed to other guests.
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
            <a href={siteConfig.contact.phoneHref} className={linkClass}>
              {siteConfig.contact.phone}
            </a>
            {email && (
              <>
                , email{' '}
                <a href={`mailto:${email}`} className={linkClass}>
                  {email}
                </a>
                ,
              </>
            )}{' '}
            or use the contact form.
          </P>

          <H2 id="children">Children</H2>
          <P>
            The site isn&rsquo;t directed at children under 13 and we
            don&rsquo;t knowingly collect information from them. We do take
            bookings that include kids — those records list the kid&rsquo;s
            name and (optionally) age, supplied by a parent or the person
            booking. Trip photos can show children in your party, and are
            emailed to the groups on that tour as described above.
          </P>

          <H2 id="changes">Changes to this policy</H2>
          <P>
            We&rsquo;ll update this page if practices change. The
            &ldquo;Last updated&rdquo; date at the top changes when we do.
          </P>

          <H2 id="contact">Questions</H2>
          <P>
            Call{' '}
            <a href={siteConfig.contact.phoneHref} className={linkClass}>
              {siteConfig.contact.phone}
            </a>{' '}
            or use the{' '}
            <Link href="/contact" className={linkClass}>
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

/** An external link that opens in a new tab. */
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}
