import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { SiteImage } from '@/components/marketing/SiteImage';
import { Section } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'About — Capt. Travis, Manatee Manners, and Crystal River',
  description:
    "Meet Capt. Travis Urbin, learn how we share the water with manatees responsibly, and get the local's guide to Crystal River — all in one place.",
  alternates: { canonical: `${siteConfig.url}/about` },
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
    body: "Float on the surface, hands at your sides. Let the manatees come to you. If one chooses to swim away, let it.",
  },
  {
    title: 'No chasing, no cornering',
    body: 'Never swim after a manatee. Never block its exit from a spring. They need to be able to leave whenever they want.',
  },
  {
    title: 'No touching',
    body: "Hands at your sides. If a curious manatee swims up and rubs against you, that's allowed — you didn't initiate. Don't reach for them.",
  },
  {
    title: 'No diving down',
    body: 'Stay at the surface. Diving down at a resting manatee is harassment under federal law.',
  },
  {
    title: 'Keep your group together',
    body: "Manatees relax when humans behave predictably. Stick with your guide, don't split off across the spring.",
  },
  {
    title: 'No flash photography',
    body: "Cameras are welcome — flash isn't. The springs have great natural light, and flash stresses the animals.",
  },
];

const stays = [
  { name: 'Plantation on Crystal River', note: 'Big resort right on Kings Bay, walking distance to the marina. Pool, restaurant, easy if you have kids.' },
  { name: 'Days Inn Crystal River', note: 'No-frills, clean, walking distance to everything. The best value in town.' },
  { name: 'Best Western Plus', note: 'A few minutes from the marina, free breakfast, good for short trips.' },
  { name: 'Airbnb on Hunter Spring', note: 'A couple of waterfront houses on the Hunter Spring run sleep 4-8 and have their own docks.' },
];

const eats = [
  { name: 'The Cracker House', note: 'Fish sandwich and key lime pie. Locals eat lunch here.' },
  { name: 'Cattle Dog Coffee Roasters', note: 'Pre-tour coffee and a breakfast burrito if you have an early slot.' },
  { name: "Vito's Italian Restaurant", note: 'After-tour dinner. Family-style, big portions, kids welcome.' },
  { name: 'Crystal River Wine & Cheese', note: 'Charcuterie board to take back to the rental, or a glass after the tour.' },
];

const dos = [
  { name: 'Three Sisters Springs', note: 'The big draw beyond manatee tours. Walking boardwalks, gorgeous spring water.' },
  { name: 'Homosassa Springs Wildlife State Park', note: 'About 25 min south. Manatees you can see without getting wet, plus Florida panthers and gators.' },
  { name: 'Hunter Spring Park', note: 'Free, in town. Locals swim here on hot afternoons.' },
  { name: 'Citrus County Speedway', note: 'Saturday-night dirt-track races. Florida at its most Florida.' },
];

export default async function AboutPage() {
  return (
    <>
      {/* ----------------------------------------------------------------- */}
      {/* Intro                                                              */}
      {/* ----------------------------------------------------------------- */}
      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
            About
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
            Who you&rsquo;re going out with, how we share the water, and where to spend the rest of your trip.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-[var(--color-ink-soft)]">
            Three things tend to matter when guests pick a manatee tour: <em>who&rsquo;s
            running the boat</em>, <em>how the operator treats the animals</em>, and{' '}
            <em>what to do with the rest of the day</em>. So we put all three here.
          </p>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-sm">
            <a href="#captain" className="inline-flex items-center px-3 py-1.5 rounded-full bg-white border border-[var(--color-ink)]/10 hover:border-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue)] transition-colors">
              Meet Capt. Travis
            </a>
            <a href="#manners" className="inline-flex items-center px-3 py-1.5 rounded-full bg-white border border-[var(--color-ink)]/10 hover:border-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue)] transition-colors">
              Manatee manners
            </a>
            <a href="#area" className="inline-flex items-center px-3 py-1.5 rounded-full bg-white border border-[var(--color-ink)]/10 hover:border-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue)] transition-colors">
              Crystal River
            </a>
          </nav>
        </div>
      </Section>

      {/* ----------------------------------------------------------------- */}
      {/* Section 1: Captain                                                 */}
      {/* ----------------------------------------------------------------- */}
      <Section tone="white" size="lg" id="captain">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <SiteImage slot="about-captain" fallbackSlot="greeting" aspect="portrait" />
          </div>
          <div className="lg:col-span-7">
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
              Meet your captain
            </p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl lg:text-5xl leading-tight">
              Travis Urbin, eleven years on the river — and counting.
            </h2>
            <div className="mt-6 space-y-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
              <p>
                Travis moved to Crystal River over a decade ago and never
                left. Eleven seasons of fishing the flats, snorkeling the
                springs, and learning where the manatees gather make for a
                pretty thorough mental map of the river — the kind you
                only build by being out on it constantly.
              </p>
              <p>
                He started running manatee tours because he kept watching
                rushed, twenty-person operators motor past the calm places
                he&rsquo;d come to know. So he bought a small boat, capped
                guests at six, and runs every trip himself — same captain
                in the morning, same captain at sunset.
              </p>
              <p>
                When he&rsquo;s not on the water, you&rsquo;ll find him
                coaching his kids&rsquo; ball games, fixing something on
                the boat, or eating a grouper sandwich somewhere within
                ten minutes of the marina.
              </p>
            </div>

            <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm">
              {credentials.map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-2 bg-[var(--color-cream)] rounded-2xl px-4 py-3 border border-[var(--color-ink)]/8"
                >
                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-[var(--color-brand-blue)] text-white shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 lg:mt-20 grid gap-8 lg:grid-cols-2 max-w-5xl mx-auto">
          <div>
            <h3 className="font-display text-2xl leading-snug">Why one captain, one boat?</h3>
            <p className="mt-3 text-base leading-relaxed text-[var(--color-ink-soft)]">
              Most Crystal River tour companies own four or five boats
              and hire college kids to drive them. There&rsquo;s nothing
              wrong with that, but they can&rsquo;t read the river the
              way Travis can. Manatees move with the temperature, the
              tide, and the time of day. Reading those patterns takes
              years of being out there every season — not a weekend
              orientation.
            </p>
          </div>
          <div>
            <h3 className="font-display text-2xl leading-snug">What it means for you</h3>
            <p className="mt-3 text-base leading-relaxed text-[var(--color-ink-soft)]">
              One boat means one person on the phone with you, one person at
              the dock, one person in the water with your kids. The downside
              is we&rsquo;re smaller, so morning slots book out fast —
              especially from December through March when manatees fill the
              warm springs.
            </p>
          </div>
        </div>
      </Section>

      {/* Captain → Manners transition */}
      <Section tone="cream" size="sm">
        <div className="max-w-3xl mx-auto text-center">
          <p className="font-display text-2xl sm:text-3xl leading-snug text-[var(--color-ink)]">
            Travis runs every tour by the same simple rule:{' '}
            <span className="text-[var(--color-brand-blue)]">
              the manatees decide how close we get.
            </span>
          </p>
          <p className="mt-4 text-base sm:text-lg text-[var(--color-ink-soft)]">
            Here&rsquo;s exactly what that looks like in the water.
          </p>
        </div>
      </Section>

      {/* ----------------------------------------------------------------- */}
      {/* Section 2: Manatee manners                                         */}
      {/* ----------------------------------------------------------------- */}
      <Section tone="white" size="lg" id="manners">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
            Manatee manners
          </p>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl lg:text-5xl leading-tight">
            Federal law, plus common sense.
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
            Manatees are a federally protected species. The U.S. Fish &
            Wildlife Service produced this three-minute video that every guest
            watches before our tour. It&rsquo;s kid-friendly and covers everything
            you need to know about being a respectful guest in their water.
          </p>
        </div>

        <div className="mt-8 max-w-3xl">
          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-[var(--shadow-soft)] bg-[var(--color-ink)]">
            <iframe
              src="https://www.youtube-nocookie.com/embed/YP3Erf3Kc2Y"
              title="USFWS — Manatee Manners"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>

        <div className="mt-12">
          <h3 className="font-display text-2xl sm:text-3xl leading-tight">
            The six rules
          </h3>
          <p className="mt-2 text-[var(--color-ink-soft)] text-sm sm:text-base">
            Every guest checks these off when they book — they&rsquo;re part
            of the booking form, not surprise rules at the dock.
          </p>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2">
            {mannersRules.map((r, i) => (
              <li
                key={r.title}
                className="rounded-2xl bg-[var(--color-cream)] p-6 border border-[var(--color-ink)]/8 relative"
              >
                <span className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-[var(--color-coral)] text-white font-display text-base flex items-center justify-center shadow-[var(--shadow-card)]">
                  {i + 1}
                </span>
                <h4 className="font-display text-lg">{r.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {r.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Manners → Area transition */}
      <Section tone="cream" size="sm">
        <div className="max-w-3xl mx-auto text-center">
          <p className="font-display text-2xl sm:text-3xl leading-snug">
            Crystal River is the only place in North America where you can
            legally swim with wild manatees.
          </p>
          <p className="mt-4 text-base sm:text-lg text-[var(--color-ink-soft)]">
            Below — what to do with the rest of your weekend, from
            someone who chose to make this town home.
          </p>
        </div>
      </Section>

      {/* ----------------------------------------------------------------- */}
      {/* Section 3: Crystal River area guide                                */}
      {/* ----------------------------------------------------------------- */}
      <Section tone="white" size="lg" id="area">
        <div className="grid gap-10 lg:grid-cols-12 items-center">
          <div className="lg:col-span-7">
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
              The area
            </p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl lg:text-5xl leading-tight">
              Crystal River, Florida.
            </h2>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
              An hour north of Tampa, an hour west of Orlando — and an
              entirely different Florida. No theme parks, no skyline, no
              rush. Just a spring-fed bay where manatees come to keep warm,
              and a small town that&rsquo;s been quietly hosting them for
              thousands of years.
            </p>
            <p className="mt-3 text-base text-[var(--color-ink-soft)]">
              This is the cheat-sheet we give friends visiting for the
              first time. Hopefully it makes your trip easier.
            </p>
          </div>
          <div className="lg:col-span-5">
            <SiteImage slot="about-area" fallbackSlot="group" aspect="square" />
          </div>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          <AreaCol heading="Where to stay" sub="Walking distance to Pete's Pier." items={stays} />
          <AreaCol heading="Where to eat" sub="Locals' picks for breakfast, lunch, and after-the-tour dinner." items={eats} />
          <AreaCol heading="What else to do" sub="Build a long weekend around your tour." items={dos} />
        </div>
      </Section>

      {/* ----------------------------------------------------------------- */}
      {/* Final CTA                                                          */}
      {/* ----------------------------------------------------------------- */}
      <Section tone="blue" size="md">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Ready to plan the trip?
          </h2>
          <p className="mt-4 text-white/85">
            Lock in a tour slot first — those go faster than hotel rooms. We
            can usually find a tour to match whatever travel dates you&rsquo;ve
            already got.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button href="/book" size="lg">
              See available dates
            </Button>
            <Link
              href={siteConfig.contact.phoneHref}
              className="inline-flex items-center px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors"
            >
              Or call {siteConfig.contact.phone}
            </Link>
          </div>
        </div>
      </Section>
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
    <div>
      <h3 className="font-display text-xl">{heading}</h3>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{sub}</p>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li
            key={item.name}
            className="rounded-2xl bg-[var(--color-cream)] p-4 border border-[var(--color-ink)]/8"
          >
            <p className="font-medium text-sm">{item.name}</p>
            <p className="mt-1 text-xs text-[var(--color-ink-soft)] leading-relaxed">
              {item.note}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
