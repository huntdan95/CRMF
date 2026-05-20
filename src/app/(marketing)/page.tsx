import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { PlaceholderImage } from '@/components/marketing/PlaceholderImage';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { TourCard } from '@/components/marketing/TourCard';
import { getFeaturedTours } from '@/lib/tours';
import { siteConfig } from '@/lib/site-config';

export const dynamic = 'force-static';

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

const whatToExpect = [
  {
    title: 'See manatees in the wild',
    body: 'The Crystal River is one of the only places in the world where you can legally swim with wild manatees in their natural spring habitat.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 14c2-4 5-6 9-6s7 2 9 6c-2 2-5 3-9 3s-7-1-9-3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="9" cy="12" r="0.8" fill="currentColor" />
        <path
          d="M6 14c-1 2-2 2-3 1m18-1c1 2 2 2 3 1"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: 'Small groups, real attention',
    body: 'Max six guests on the boat. You won\'t be a number in a 20-person crowd — Travis knows where the manatees are and shows you how to share their space.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="9" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M3 19c1-3 4-5 6-5s5 2 6 5m1-2c1-2 3-3 5-3s4 1 5 3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: 'Everything included',
    body: 'Snorkel gear, wetsuits, bottled water, towels — all on the boat. Just bring a swimsuit, a sense of wonder, and (if you have it) a waterproof camera.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 11h14l-1.4 7.6a2 2 0 0 1-2 1.4H8.4a2 2 0 0 1-2-1.4L5 11Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 11V7a3 3 0 0 1 6 0v4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: 'A real local, not a chain',
    body: 'Travis was born and raised in Crystal River. He runs the boat, picks up your call, and remembers your kids\' names next year.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 21s-8-5-8-12a8 8 0 1 1 16 0c0 7-8 12-8 12Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
];

export default function HomePage() {
  const featured = getFeaturedTours();
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />

      {/* Hero ----------------------------------------------------------- */}
      <section className="relative isolate overflow-hidden bg-[var(--color-brand-blue)] text-white">
        <div className="absolute inset-0 -z-10">
          <PlaceholderImage
            label="Hero — captain & guests snorkeling with a manatee in the springs"
            aspect="auto"
            rounded="none"
            className="h-full"
            tone="bg-[var(--color-brand-blue)]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-brand-blue)]/85 via-[var(--color-brand-blue)]/70 to-[var(--color-brand-blue)]/95" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="max-w-2xl">
            <p className="text-sm sm:text-base uppercase tracking-widest text-[var(--color-cream)]/90 font-medium">
              Crystal River · Florida
            </p>
            <h1 className="mt-3 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
              Swim with wild manatees — at their pace, not the crowd&rsquo;s.
            </h1>
            <p className="mt-5 text-lg sm:text-xl text-white/90 leading-relaxed">
              Small-group, family-friendly tours from Pete&rsquo;s Pier Marina,
              led by Capt. Travis Urbin. Six guests max, all gear included,
              the morning all to ourselves.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 items-center">
              <Button href="/book" size="lg">
                Book a tour
              </Button>
              <a
                href={siteConfig.contact.phoneHref}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-white font-medium transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 2.08 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.12.86.32 1.7.6 2.5a2 2 0 0 1-.45 2.11L8.09 9.41a16 16 0 0 0 6.5 6.5l1.08-1.14a2 2 0 0 1 2.11-.45c.8.28 1.64.48 2.5.6A2 2 0 0 1 22 16.92Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                </svg>
                Call {siteConfig.contact.phone}
              </a>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/85">
              <span>USCG-licensed captain</span>
              <span aria-hidden>·</span>
              <span>Up to 6 guests per boat</span>
              <span aria-hidden>·</span>
              <span>Gear included</span>
            </div>
          </div>
        </div>
      </section>

      {/* What to expect ------------------------------------------------- */}
      <Section tone="cream" size="lg">
        <SectionTitle
          eyebrow="What to expect"
          title="A morning on the water that doesn't feel like a tour"
          description="Just a small boat, a captain who grew up on these springs, and a few hours with the gentlest mammals in Florida."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {whatToExpect.map((item) => (
            <div
              key={item.title}
              className="bg-white rounded-2xl p-6 border border-[var(--color-ink)]/8 shadow-[var(--shadow-card)]"
            >
              <div className="w-11 h-11 rounded-full bg-[var(--color-brand-blue)]/10 text-[var(--color-brand-blue)] flex items-center justify-center mb-4">
                <span className="w-6 h-6">{item.icon}</span>
              </div>
              <h3 className="font-display text-xl leading-snug">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Featured tours ------------------------------------------------- */}
      <Section tone="white" size="lg">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end justify-between">
          <SectionTitle
            eyebrow="Pick your morning"
            title="Three of our most-booked tours"
            description="The morning shared tour is the photographer's pick. Early afternoon is everyone's-up-and-fed sweet spot. The whole-day private is the trip people fly in for."
            align="left"
          />
          <Link
            href="/tours"
            className="text-sm font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-dark)] underline-offset-4 hover:underline shrink-0"
          >
            See all tours →
          </Link>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {featured.map((tour) => (
            <TourCard key={tour.slug} tour={tour} />
          ))}
        </div>
      </Section>

      {/* Testimonial ---------------------------------------------------- */}
      <Section tone="manatee" size="md">
        <figure className="max-w-3xl mx-auto text-center">
          <svg
            className="mx-auto w-10 h-10 text-[var(--color-coral)] opacity-70"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M7 8h3v3a4 4 0 0 1-4 4v-3a3 3 0 0 0 3-3H7V8Zm7 0h3v3a4 4 0 0 1-4 4v-3a3 3 0 0 0 3-3h-2V8Z" />
          </svg>
          <blockquote className="mt-4 font-display text-2xl sm:text-3xl leading-snug">
            &ldquo;Travis put us right next to a mother and calf for the entire
            tour. The kids haven&rsquo;t stopped talking about it. This is the
            real Florida, not a theme park.&rdquo;
          </blockquote>
          <figcaption className="mt-5 text-sm text-[var(--color-ink-soft)]">
            — The Hutcheson family, Atlanta GA
            <br />
            <span className="opacity-70">[TODO: replace with a real guest review]</span>
          </figcaption>
        </figure>
      </Section>

      {/* Manners callout ----------------------------------------------- */}
      <Section tone="cream" size="md">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center max-w-5xl mx-auto">
          <PlaceholderImage
            label="USFWS-approved manatee viewing — quiet, calm, no chasing"
            aspect="video"
          />
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
              Manatee manners
            </p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl leading-tight">
              The rules every guest watches before we leave the dock.
            </h2>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
              Manatees are a federally protected species. There&rsquo;s a right
              way to share their water with them — and a wrong way that hurts
              the animals and ruins it for everyone. Take three minutes to
              watch the USFWS video before you arrive.
            </p>
            <div className="mt-6">
              <Button href="/about#manners" variant="secondary">
                Watch the rules
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* Final CTA ----------------------------------------------------- */}
      <Section tone="blue" size="lg">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl text-white leading-tight">
            Ready to meet the manatees?
          </h2>
          <p className="mt-4 text-lg text-white/85">
            Pick a date, pick a slot, pay online in under two minutes. You&rsquo;ll
            get a confirmation email with a self-service link, the marina
            address, and what to bring.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Button href="/book" size="lg">
              Book a tour
            </Button>
            <a
              href={siteConfig.contact.phoneHref}
              className="inline-flex items-center px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
            >
              Or call {siteConfig.contact.phone}
            </a>
          </div>
        </div>
      </Section>
    </>
  );
}
