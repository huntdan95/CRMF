import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { SiteImage } from '@/components/marketing/SiteImage';
import { Section } from '@/components/marketing/Section';
import { TourCard } from '@/components/marketing/TourCard';
import { getFeaturedTours } from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';

export const revalidate = 60;

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TouristAttraction',
  name: siteConfig.name,
  description:
    'Small-group, family-friendly snorkel-with-manatee tours on the Crystal River with USCG-licensed Captain Travis Urbin.',
  url: siteConfig.url,
  telephone: siteConfig.contact.phone,
  image: `${siteConfig.url}/images/og.jpg`,
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
  sameAs: [siteConfig.captain.instagram, siteConfig.captain.facebook],
};

const stats = [
  { figure: '6', label: 'guests, max', sub: 'never twenty in the water' },
  { figure: '1', label: 'captain, always', sub: 'Travis runs every trip himself' },
  { figure: '100%', label: 'USFWS rules', sub: 'every guest, every tour' },
  { figure: '11', label: 'years on the river', sub: 'Crystal River, every season' },
];

export default async function HomePage() {
  const featured = getFeaturedTours();

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />

      {/* =================================================================== */}
      {/* Hero                                                                  */}
      {/* =================================================================== */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] text-white">
        <div className="absolute inset-0 -z-10">
          <SiteImage
            slot="hero"
            aspect="auto"
            rounded="none"
            className="h-full"
            priority
            sizes="100vw"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-[var(--color-ink)]/40 via-[var(--color-ink)]/20 to-[var(--color-ink)]/85"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-[var(--color-ink)]/55 via-transparent to-transparent"
          />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 sm:pt-32 sm:pb-28 lg:pt-44 lg:pb-40">
          <div className="max-w-3xl">
            <p className="text-xs sm:text-sm uppercase tracking-[0.3em] text-[var(--color-cream)]/90 font-medium">
              Crystal River · Florida
            </p>
            <h1 className="mt-5 font-display text-[2.75rem] sm:text-7xl lg:text-[6.5rem] leading-[0.95] tracking-tight">
              Swim with{' '}
              <span className="text-[var(--color-cream)]">wild manatees.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg sm:text-xl text-white/85 leading-relaxed">
              Six guests at a time. One captain who&rsquo;s been working
              this river for over a decade. Every spring at its best
              light — the same as it&rsquo;s been for ten thousand years.
            </p>
            <div className="mt-10 flex flex-wrap gap-3 items-center">
              <Button href="/book" size="lg">
                Book a tour
              </Button>
              <a
                href={siteConfig.contact.phoneHref}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white font-medium transition-colors text-lg"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 2.08 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.86.32 1.7.6 2.5a2 2 0 0 1-.45 2.11L8.09 9.41a16 16 0 0 0 6.5 6.5l1.08-1.14a2 2 0 0 1 2.11-.45c.8.28 1.64.48 2.5.6A2 2 0 0 1 22 16.92Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
                {siteConfig.contact.phone}
              </a>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 inset-x-0 flex justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <span className="text-[10px] uppercase tracking-[0.3em]">Scroll</span>
            <svg width="16" height="20" viewBox="0 0 24 30" fill="none" aria-hidden className="animate-pulse">
              <rect x="3" y="2" width="18" height="26" rx="9" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="10" r="1.5" fill="currentColor" />
            </svg>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* By the numbers — replaces the 4-icon "what to expect" cards           */}
      {/* =================================================================== */}
      <section className="bg-[var(--color-cream)] border-y border-[var(--color-ink)]/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-10 gap-x-6">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col items-start">
                <p className="font-display text-5xl sm:text-6xl lg:text-7xl leading-none text-[var(--color-brand-blue)] tracking-tight">
                  {s.figure}
                </p>
                <p className="mt-3 font-medium uppercase tracking-[0.14em] text-xs sm:text-sm text-[var(--color-ink)]">
                  {s.label}
                </p>
                <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                  {s.sub}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* Included with every tour — under-advertised value props                */}
      {/* =================================================================== */}
      <section className="bg-white border-b border-[var(--color-ink)]/8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
          <div className="grid lg:grid-cols-[1fr_2fr] gap-8 lg:gap-14 items-start">
            <div>
              <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
                Included with every tour
              </p>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.05]">
                Free.<br />
                <span className="text-[var(--color-ink-soft)]">Every booking.</span>
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-6 sm:gap-8">
              <Perk
                title="GoPro photos from your tour"
                badge="Free"
                body="We bring an underwater GoPro, shoot the highlights, and send you the footage. No upsell, no $200 photo package — just your trip, in your inbox."
              />
              <Perk
                title="Dedicated in-water swim guide"
                badge="Always"
                body="Travis isn't just driving the boat. He's in the water with your group the whole time — pointing out manatees, helping anyone who's nervous, and keeping everyone close."
              />
              <Perk
                title="Wetsuit, mask, snorkel, fins"
                badge="Free"
                body="All sized to fit. The springs are a steady 72°F year-round — the wetsuit makes a longer swim a lot more pleasant."
              />
              <Perk
                title="Water, towels, dry bag"
                badge="Free"
                body="Bottled water, fresh towels, and a dry bag for your phone and keys. Just show up with a swimsuit."
              />
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* Featured tours                                                        */}
      {/* =================================================================== */}
      <Section tone="white" size="lg">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end justify-between mb-12">
          <div>
            <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-coral-dark)]">
              The tours
            </p>
            <h2 className="mt-3 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
              Three of nine.<br />
              <span className="text-[var(--color-ink-soft)]">Pick a morning.</span>
            </h2>
          </div>
          <Link
            href="/tours"
            className="text-sm font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline shrink-0"
          >
            See all nine →
          </Link>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {featured.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>

      {/* =================================================================== */}
      {/* Testimonial — oversized magazine quote                                */}
      {/* =================================================================== */}
      <section className="bg-[var(--color-cream)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <p className="font-display text-[2.75rem] sm:text-6xl lg:text-7xl leading-[1.05] tracking-tight text-[var(--color-ink)]">
            <span className="text-[var(--color-coral)]" aria-hidden>&ldquo;</span>
            The kids haven&rsquo;t stopped talking about it.
            <span className="text-[var(--color-coral)]" aria-hidden>&rdquo;</span>
          </p>
          <p className="mt-8 text-sm uppercase tracking-[0.25em] text-[var(--color-ink-soft)]">
            — Recent guest, posted to Instagram
          </p>
        </div>
      </section>

      {/* =================================================================== */}
      {/* Manners callout — photo-led                                           */}
      {/* =================================================================== */}
      <section className="bg-[var(--color-ink)] text-white overflow-hidden">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 items-stretch">
          <div className="relative min-h-[320px] sm:min-h-[440px] lg:min-h-[600px]">
            <SiteImage
              slot="manners-callout"
              fallbackSlot="pair"
              aspect="auto"
              rounded="none"
              className="absolute inset-0"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>
          <div className="px-6 sm:px-10 lg:px-16 py-16 lg:py-24 flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--color-coral)]">
              Manatee manners
            </p>
            <h2 className="mt-5 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
              The water is theirs.<br />
              We&rsquo;re visitors.
            </h2>
            <p className="mt-6 text-base sm:text-lg text-white/80 leading-relaxed max-w-md">
              Manatees are federally protected. Passive observation, no
              touching, no chasing. We watch a three-minute USFWS video
              before every tour — and every guest agrees in the booking
              form. That&rsquo;s the deal.
            </p>
            <div className="mt-8">
              <Link
                href="/about#manners"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white font-medium transition-colors"
              >
                Watch the rules
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* Final CTA                                                             */}
      {/* =================================================================== */}
      <section className="bg-[var(--color-brand-blue)] text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.3em] text-[var(--color-cream)]/90">
            Booking now
          </p>
          <h2 className="mt-5 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
            See you on the river.
          </h2>
          <p className="mt-6 text-lg text-white/85 max-w-xl mx-auto">
            Pick a date, pay online in under two minutes. Confirmation
            email arrives instantly with the marina address and a
            self-service link.
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Button href="/book" size="lg">
              Book a tour
            </Button>
            <a
              href={siteConfig.contact.phoneHref}
              className="inline-flex items-center px-7 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium text-lg transition-colors"
            >
              Or call {siteConfig.contact.phone}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function Perk({
  title,
  badge,
  body,
}: {
  title: string;
  badge: 'Free' | 'Always';
  body: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={
            badge === 'Free'
              ? 'inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-coral)] text-white text-[10px] font-semibold uppercase tracking-[0.14em]'
              : 'inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--color-brand-blue)] text-white text-[10px] font-semibold uppercase tracking-[0.14em]'
          }
        >
          {badge}
        </span>
        <h3 className="font-display text-lg leading-tight">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {body}
      </p>
    </div>
  );
}
