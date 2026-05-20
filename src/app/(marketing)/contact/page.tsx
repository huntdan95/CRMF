import type { Metadata } from 'next';
import { Section } from '@/components/marketing/Section';
import { ContactForm } from './ContactForm';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Contact — Call, Text, or Send a Note',
  description:
    "Call Capt. Travis Urbin at 352-586-7792, send a message, or stop by Pete's Pier Marina in Crystal River, Florida.",
  alternates: { canonical: `${siteConfig.url}/contact` },
};

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TouristAttraction',
  name: siteConfig.name,
  telephone: siteConfig.contact.phone,
  url: siteConfig.url,
  address: {
    '@type': 'PostalAddress',
    streetAddress: siteConfig.marina.streetAddress,
    addressLocality: siteConfig.marina.city,
    addressRegion: siteConfig.marina.region,
    postalCode: siteConfig.marina.postalCode,
    addressCountry: siteConfig.marina.country,
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: siteConfig.marina.latitude,
    longitude: siteConfig.marina.longitude,
  },
};

export default function ContactPage() {
  const mapEmbedSrc = `https://maps.google.com/maps?q=${encodeURIComponent(
    `${siteConfig.marina.name} ${siteConfig.marina.streetAddress} ${siteConfig.marina.city} ${siteConfig.marina.region}`,
  )}&output=embed`;

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />

      <Section tone="cream" size="md">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
            Contact
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">
            Let&rsquo;s plan your morning on the river.
          </h1>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
            Easiest way to reach Travis is a phone call — he picks up if he
            isn&rsquo;t on the water. If you&rsquo;d rather send a note,
            the form below goes straight to his inbox.
          </p>
        </div>
      </Section>

      <Section tone="white" size="md">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="font-display text-2xl sm:text-3xl mb-6">Send a message</h2>
            <ContactForm />
          </div>
          <div className="lg:col-span-5 space-y-8">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl">Call or visit</h2>
              <dl className="mt-6 space-y-5 text-sm">
                <div>
                  <dt className="text-[var(--color-ink-soft)] uppercase tracking-widest text-xs font-medium">
                    Phone
                  </dt>
                  <dd className="mt-1">
                    <a
                      href={siteConfig.contact.phoneHref}
                      className="font-display text-2xl text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
                    >
                      {siteConfig.contact.phone}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-ink-soft)] uppercase tracking-widest text-xs font-medium">
                    Marina
                  </dt>
                  <dd className="mt-1 font-medium">{siteConfig.marina.name}</dd>
                  <dd className="text-[var(--color-ink-soft)]">
                    {siteConfig.marina.streetAddress}
                    <br />
                    {siteConfig.marina.city}, {siteConfig.marina.region}{' '}
                    {siteConfig.marina.postalCode}
                  </dd>
                  <dd className="mt-2">
                    <a
                      href={siteConfig.marina.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline"
                    >
                      Directions →
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-ink-soft)] uppercase tracking-widest text-xs font-medium">
                    Social
                  </dt>
                  <dd className="mt-1 flex flex-col gap-1 text-sm">
                    <a
                      href={siteConfig.captain.instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
                    >
                      @capt.travisurbin on Instagram
                    </a>
                    <a
                      href={siteConfig.captain.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)]"
                    >
                      Travis Urbin on Facebook
                    </a>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl overflow-hidden border border-[var(--color-ink)]/10 shadow-[var(--shadow-card)]">
              <iframe
                src={mapEmbedSrc}
                title={`Map of ${siteConfig.marina.name}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-72 block"
              />
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
