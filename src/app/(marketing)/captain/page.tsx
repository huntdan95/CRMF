import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import { PlaceholderImage } from '@/components/marketing/PlaceholderImage';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Capt. Travis Urbin — Born-and-Raised Crystal River Captain',
  description:
    'Capt. Travis Urbin grew up on the Crystal River and runs every tour himself — USCG-licensed, USFWS-trained, and never running more than six guests at a time.',
  alternates: { canonical: `${siteConfig.url}/captain` },
};

const credentials = [
  'USCG-licensed Master Captain',
  'USFWS-trained manatee guide',
  'CPR & first-aid certified',
  'Lifelong Crystal River local',
];

export default function CaptainPage() {
  return (
    <>
      <Section tone="cream" size="lg">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <PlaceholderImage
              label="Capt. Travis at the helm — portrait photo, replace with real headshot"
              aspect="portrait"
            />
          </div>
          <div className="lg:col-span-7">
            <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
              Meet your captain
            </p>
            <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">
              Travis Urbin, born and raised on these springs.
            </h1>
            <div className="mt-6 space-y-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
              <p>
                Travis has spent more time on the Crystal River than most
                people spend in their living room. He grew up fishing the
                flats, snorkeling the springs, and learning where the
                manatees gather long before the GPS pin existed.
              </p>
              <p>
                He started running manatee tours because he kept watching
                rushed, twenty-person operators motor past the calm places he
                grew up. So he bought a small boat, capped guests at six,
                and runs every trip himself — same captain in the morning,
                same captain at sunset.
              </p>
              <p>
                When he&rsquo;s not on the water, you&rsquo;ll find him
                coaching his kids&rsquo; ball games, fixing something on
                the boat, or eating a grouper sandwich somewhere within ten
                minutes of the marina.
              </p>
            </div>

            <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm">
              {credentials.map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-2 bg-white rounded-2xl px-4 py-3 border border-[var(--color-ink)]/8"
                >
                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-[var(--color-brand-blue)] text-white shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M5 12.5l4 4 10-10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {c}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/book" size="lg">
                Book a tour with Travis
              </Button>
              <a
                href={siteConfig.contact.phoneHref}
                className="inline-flex items-center px-6 py-3.5 rounded-full bg-white border border-[var(--color-brand-blue)]/30 text-[var(--color-brand-blue)] hover:border-[var(--color-brand-blue)] font-medium"
              >
                Call {siteConfig.contact.phone}
              </a>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="white" size="md">
        <SectionTitle
          eyebrow="Why a one-captain operation?"
          title="Because the river isn't a conveyor belt."
          align="left"
        />
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <p className="text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
            Most Crystal River tour companies own four or five boats and hire
            college kids to drive them. There&rsquo;s nothing wrong with that,
            but they can&rsquo;t read the river the way Travis can. Manatees
            move with the temperature, the tide, and the time of day, and
            knowing where they&rsquo;ll be tomorrow is a skill that takes
            decades to build.
          </p>
          <p className="text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
            One boat means one person on the phone with you, one person at the
            dock, one person in the water with your kids. The downside is
            we&rsquo;re smaller, so morning slots book out fast — especially
            from December through March when manatees fill the warm springs.
          </p>
        </div>
      </Section>
    </>
  );
}
