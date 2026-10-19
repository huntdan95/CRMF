import type { Metadata } from 'next';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { ContactForm } from './ContactForm';
import { ArrowUpRight, Facebook, Instagram, Mail, MapPin, Phone } from '@/components/ui/icons';
import { publicContactEmail, siteConfig } from '@/lib/site-config';
import { localBusinessJsonLd, pageSeo } from '@/lib/seo';
import { marinaNow } from '@/lib/availability';
import { kindPriceRanges } from '@/lib/pricing';
import { fetchTourCatalog } from '@/lib/tours-server';

const title = `Contact ${siteConfig.name} | ${siteConfig.contact.phone}`;
const description =
  "Call Capt. Travis Urbin at 352-586-7792, send a message, or stop by Pete's Pier Marina in Crystal River, Florida.";

export const metadata: Metadata = {
  // Absolute: the business name is already in it.
  title: { absolute: title },
  description,
  ...pageSeo('/contact', { title, description }),
};

export default async function ContactPage() {
  const catalog = await fetchTourCatalog();
  const prices = kindPriceRanges(catalog.tours, marinaNow().date, catalog.seasons);
  // Hidden until the owner replaces the placeholder in site-config.
  const email = publicContactEmail();
  const mapEmbedSrc = `https://maps.google.com/maps?q=${encodeURIComponent(
    `${siteConfig.marina.name} ${siteConfig.marina.streetAddress} ${siteConfig.marina.city} ${siteConfig.marina.region}`,
  )}&output=embed`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd(prices.all)) }}
      />

      <Section tone="paper" size="md" className="!pb-10">
        <SectionTitle
          as="h1"
          size="lg"
          title="Talk to Travis"
          description="A phone call is quickest; he picks up when he isn’t on the water. Or send a note below and it goes straight to his inbox."
        />
      </Section>

      <Section tone="paper" size="sm" className="!pt-0 pb-20 sm:pb-28">
        <div className="grid items-start gap-6 lg:grid-cols-[7fr_5fr] lg:gap-8">
          <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-6 sm:p-9">
            <h2 className="text-2xl font-bold">Send a message</h2>
            <p className="mt-1 text-[var(--color-ink-soft)]">
              Usually answered within a day, often within the hour.
            </p>
            <div className="mt-7">
              <ContactForm />
            </div>
          </div>

          <div className="space-y-6">
            <a
              href={siteConfig.contact.phoneHref}
              className="group block rounded-2xl bg-[var(--color-spring-deep)] p-7 text-white transition-colors hover:bg-[var(--color-ink)]"
            >
              <Phone size={22} className="text-[var(--color-spring-bright)]" />
              <p className="mt-5 text-sm text-white/70">Call or text</p>
              <p className="mt-1 text-display text-[2rem] tabular-nums">{siteConfig.contact.phone}</p>
            </a>

            <div className="overflow-hidden rounded-2xl border border-[var(--color-sand)] bg-white">
              <iframe
                src={mapEmbedSrc}
                title={`Map of ${siteConfig.marina.name}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block h-64 w-full"
              />
              <div className="p-6">
                <p className="flex items-start gap-3">
                  <MapPin size={20} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
                  <span>
                    <span className="block font-semibold">{siteConfig.marina.name}</span>
                    <span className="block text-[var(--color-ink-soft)]">
                      {siteConfig.marina.streetAddress}, {siteConfig.marina.city},{' '}
                      {siteConfig.marina.region} {siteConfig.marina.postalCode}
                    </span>
                  </span>
                </p>
                <a
                  href={siteConfig.marina.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-spring)] hover:text-[var(--color-ink)]"
                >
                  Get directions
                  <ArrowUpRight size={16} />
                </a>
              </div>
            </div>

            <ul className="space-y-2 rounded-2xl border border-[var(--color-sand)] bg-white p-3">
              {email && (
                <li>
                  <a href={`mailto:${email}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-paper)]">
                    <Mail size={18} className="text-[var(--color-spring)]" />
                    {email}
                  </a>
                </li>
              )}
              <li>
                <a
                  href={siteConfig.captain.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-paper)]"
                >
                  <Instagram size={18} className="text-[var(--color-spring)]" />
                  @capt.travisurbin on Instagram
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.captain.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-paper)]"
                >
                  <Facebook size={18} className="text-[var(--color-spring)]" />
                  Crystal River Manatee Fun on Facebook
                </a>
              </li>
            </ul>
          </div>
        </div>
      </Section>
    </>
  );
}
