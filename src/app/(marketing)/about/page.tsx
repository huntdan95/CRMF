import type { Metadata } from 'next';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { SiteImage } from '@/components/marketing/SiteImage';
import { Container, Section, SectionTitle } from '@/components/marketing/Section';
import { ArrowRight, Check, Phone } from '@/components/ui/icons';
import { photos } from '@/lib/photos';
import { siteConfig } from '@/lib/site-config';
import { pageSeo } from '@/lib/seo';

export const revalidate = 60;

const title = 'About — Capt. Travis, Manatee Manners, and Crystal River';
const description =
  "Meet Capt. Travis Urbin, learn how we share the water with manatees responsibly, and get the local's guide to Crystal River — all in one place.";

export const metadata: Metadata = {
  title,
  description,
  ...pageSeo('/about', { title, description }),
};

const credentials = [
  'USCG-licensed Master Captain',
  'USFWS-trained manatee guide',
  'CPR & first-aid certified',
  '11+ years on Crystal River',
];

const mannersRules = [
  {
    title: 'Passive observation only',
    body: 'Float on the surface, hands at your sides. Let the manatees come to you. If one chooses to swim away, let it.',
  },
  {
    title: 'No chasing, no cornering',
    body: 'Never swim after a manatee. Never block its exit from a spring. They need to be able to leave whenever they want.',
  },
  {
    title: 'No touching',
    body: "If a curious manatee swims up and brushes against you, that's allowed — you didn't start it. Don't reach for them.",
  },
  {
    title: 'No diving down',
    body: 'Stay at the surface. Diving down at a resting manatee is harassment under federal law.',
  },
  {
    title: 'Keep your group together',
    body: "Manatees relax when people behave predictably. Stay with your guide; don't split off across the spring.",
  },
  {
    title: 'No flash photography',
    body: 'Cameras are welcome, flash isn’t. The springs have great natural light, and flash stresses the animals.',
  },
];

const stays = [
  { name: 'Plantation on Crystal River', note: 'Big resort right on Kings Bay, walking distance to the marina. Pool, restaurant, easy if you have kids.' },
  { name: 'Days Inn Crystal River', note: 'No-frills, clean, walking distance to everything. The best value in town.' },
  { name: 'Best Western Plus', note: 'A few minutes from the marina, free breakfast, good for short trips.' },
  { name: 'Airbnb on Hunter Spring', note: 'A couple of waterfront houses on the Hunter Spring run sleep 4–8 and have their own docks.' },
];

const eats = [
  { name: 'The Cracker House', note: 'Fish sandwich and key lime pie. Locals eat lunch here.' },
  { name: 'Cattle Dog Coffee Roasters', note: 'Pre-tour coffee and a breakfast burrito if you have an early slot.' },
  { name: "Vito's Italian Restaurant", note: 'After-tour dinner. Family-style, big portions, kids welcome.' },
  { name: 'Crystal River Wine & Cheese', note: 'Charcuterie board to take back to the rental, or a glass after the tour.' },
];

const dos = [
  { name: 'Three Sisters Springs', note: 'The big draw beyond manatee tours. Walking boardwalks, gorgeous spring water.' },
  { name: 'Homosassa Springs Wildlife State Park', note: 'About 25 minutes south. Manatees you can see without getting wet, plus Florida panthers and gators.' },
  { name: 'Hunter Spring Park', note: 'Free, in town. Locals swim here on hot afternoons.' },
  { name: 'Citrus County Speedway', note: 'Saturday-night dirt-track races. Florida at its most Florida.' },
];

const jump = [
  { href: '#captain', label: 'Capt. Travis' },
  { href: '#manners', label: 'Manatee manners' },
  { href: '#area', label: 'Crystal River guide' },
];

export default async function AboutPage() {
  return (
    <>
      <Section tone="paper" size="md" className="!pb-12">
        <SectionTitle
          as="h1"
          size="lg"
          title="Capt. Travis, the manatees, and Crystal River"
          description="Three things matter when you pick a manatee tour: who runs the boat, how they treat the animals, and what to do with the rest of your day. They're all here."
        />
        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2">
          {jump.map((j) => (
            <a
              key={j.href}
              href={j.href}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-ink)]/15 bg-white px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--color-ink)]"
            >
              {j.label}
              <ArrowRight size={15} className="rotate-90 text-[var(--color-ink-soft)]" />
            </a>
          ))}
        </nav>
      </Section>

      {/* Captain --------------------------------------------------------- */}
      <Section tone="white" size="lg" id="captain">
        <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
          <div>
            <SiteImage
              slot="about-captain"
              fallbackSlot="greeting"
              aspect="portrait"
              rounded="2xl"
              priority
              sizes="(min-width: 1024px) 480px, 100vw"
            />
            <ul className="mt-6 grid grid-cols-2 gap-2.5">
              {credentials.map((c) => (
                <li
                  key={c}
                  className="flex items-start gap-2 rounded-xl bg-[var(--color-paper)] px-3.5 py-3 text-sm font-medium"
                >
                  <Check size={17} className="mt-0.5 shrink-0 text-[var(--color-spring)]" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-label text-[var(--color-spring)]">Meet your captain</p>
            <h2 className="mt-4 text-display text-[2.4rem] sm:text-6xl">Travis Urbin</h2>
            <div className="mt-8 space-y-5 text-lg leading-relaxed text-[var(--color-ink-soft)]">
              <p>
                Travis moved to Crystal River over a decade ago and never left.
                Eleven seasons of fishing the flats, snorkeling the springs,
                and learning where the manatees gather make for a thorough
                mental map of the river, the kind you only build by being out
                on it constantly.
              </p>
              <p>
                He started running manatee tours after watching rushed,
                twenty-person operators motor past the calm places he&rsquo;d
                come to know. So he bought a small boat, capped guests at six,
                and runs every trip himself: same captain in the morning, same
                captain in the afternoon.
              </p>
              <p>
                When he&rsquo;s not on the water, you&rsquo;ll find him
                coaching his kids&rsquo; ball games, fixing something on the
                boat, or eating a grouper sandwich somewhere within ten minutes
                of the marina.
              </p>
            </div>

            <div className="mt-12 grid gap-8 border-t border-[var(--color-sand)] pt-10 sm:grid-cols-2">
              <div>
                <h3 className="text-lg font-bold">Why one captain, one boat?</h3>
                <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">
                  Plenty of Crystal River operators run four or five boats with
                  hired drivers. Manatees move with the temperature, the tide,
                  and the time of day, and reading those patterns takes years
                  on the water, not a weekend orientation.
                </p>
              </div>
              <div>
                <h3 className="text-lg font-bold">What it means for you</h3>
                <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">
                  One person on the phone, at the dock, and in the water with
                  your kids. The trade-off: morning slots fill fast, especially
                  December through March when manatees crowd the warm springs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Manners --------------------------------------------------------- */}
      <section id="manners" className="bg-[var(--color-ink)] text-white">
        <Container className="py-20 sm:py-32">
          <div className="grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
            <div>
              <p className="text-label text-[var(--color-spring-bright)]">Manatee manners</p>
              <h2 className="mt-4 text-display text-[2.4rem] sm:text-6xl">Federal law, plus common sense.</h2>
              <p className="mt-7 text-lg leading-relaxed text-white/75">
                Manatees are a federally protected species. Every guest watches
                this three-minute U.S. Fish &amp; Wildlife Service video before
                the tour. It&rsquo;s kid-friendly and covers everything you
                need to know about being a good guest in their water.
              </p>
              <p className="mt-5 text-white/60">
                Travis runs every tour by one rule: the manatees decide how
                close we get.
              </p>
            </div>
            <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
              <iframe
                src="https://www.youtube-nocookie.com/embed/YP3Erf3Kc2Y"
                title="USFWS — Manatee Manners"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          <h3 className="mt-20 text-2xl font-bold">The six rules</h3>
          <p className="mt-2 text-white/60">
            Every guest agrees to these when they book. No surprise rules at the dock.
          </p>
          <ol className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {mannersRules.map((r, i) => (
              <li key={r.title} className="border-t border-white/15 pt-6">
                <span className="text-display text-[2rem] tabular-nums text-[var(--color-spring-bright)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h4 className="mt-3 text-lg font-bold">{r.title}</h4>
                <p className="mt-2 leading-relaxed text-white/70">{r.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Area guide ------------------------------------------------------ */}
      <Section tone="paper" size="lg" id="area">
        <div className="grid items-center gap-12 lg:grid-cols-[7fr_5fr] lg:gap-20">
          <div>
            <p className="text-label text-[var(--color-spring)]">The area</p>
            <h2 className="mt-4 text-display text-[2.4rem] sm:text-6xl">Crystal River, Florida</h2>
            <p className="mt-7 text-lg leading-relaxed text-[var(--color-ink-soft)]">
              No theme parks, no skyline, no rush. Just a spring-fed bay where
              manatees come to keep warm, and a small town that&rsquo;s been
              quietly hosting them for a very long time. Citrus County is the
              only place in the U.S. where you can legally swim with them.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">
              This is the cheat sheet Travis gives friends visiting for the
              first time.
            </p>
          </div>
          <SiteImage
            slot="about-area"
            fallbackSlot="group"
            aspect="square"
            rounded="2xl"
            sizes="(min-width: 1024px) 460px, 100vw"
          />
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-3 lg:gap-8">
          <AreaCol heading="Where to stay" sub="Close to Pete's Pier." items={stays} />
          <AreaCol heading="Where to eat" sub="Breakfast, lunch, and after-tour dinner." items={eats} />
          <AreaCol heading="What else to do" sub="Build a long weekend around your tour." items={dos} />
        </div>
      </Section>

      <section className="relative isolate overflow-hidden bg-[var(--color-spring-deep)] text-white">
        <Image
          src={photos.motherAndCalf.src}
          alt=""
          fill
          sizes="100vw"
          className="-z-20 object-cover opacity-35"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[var(--color-spring-deep)] via-[var(--color-spring-deep)]/80 to-transparent" />
        <Container className="py-20 sm:py-28">
          <h2 className="max-w-2xl text-display text-[2.4rem] sm:text-6xl">Book the tour first. Then the hotel.</h2>
          <p className="mt-6 max-w-xl text-lg text-white/80">
            Tour slots go faster than rooms, especially in winter. Travis can
            usually find something that fits the dates you already have.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button href="/book" size="lg">
              See available dates
              <ArrowRight size={18} />
            </Button>
            <Button href={siteConfig.contact.phoneHref} size="lg" variant="glass">
              <Phone size={18} />
              {siteConfig.contact.phone}
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}

function AreaCol({
  heading,
  sub,
  items,
}: {
  heading: string;
  sub: string;
  items: { name: string; note: string }[];
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-sand)] bg-white p-7">
      <h3 className="text-xl font-bold">{heading}</h3>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{sub}</p>
      <ul className="mt-6 divide-y divide-[var(--color-sand)]">
        {items.map((item) => (
          <li key={item.name} className="py-4 first:pt-0 last:pb-0">
            <p className="font-semibold">{item.name}</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{item.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
