import type { Metadata } from 'next';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Manatee Manners — How to Share the Water Without Harming the Animals',
  description:
    'Every guest watches the USFWS manatee manners video before our tours. The rules are simple: passive observation, no chasing, no touching, no diving — federal law protects these animals.',
  alternates: { canonical: `${siteConfig.url}/manatee-manners` },
};

const rules = [
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
    body: 'Hands at your sides. If a curious manatee comes up and rubs against you, that\'s allowed — you didn\'t initiate. Don\'t reach for them.',
  },
  {
    title: 'No diving down',
    body: 'Stay at the surface. Diving down at a resting manatee is harassment under federal law.',
  },
  {
    title: 'Keep your group together',
    body: 'Manatees relax when humans behave predictably. Stick with your guide, don\'t split off across the spring.',
  },
  {
    title: 'No flash photography',
    body: 'Cameras are welcome — flash isn\'t. The springs have great natural light, and flash stresses the animals.',
  },
];

export default function MannersPage() {
  return (
    <>
      <Section tone="cream" size="md">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-widest text-[var(--color-coral-dark)]">
            Required watch
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl leading-tight">
            Manatee manners.
          </h1>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-[var(--color-ink-soft)]">
            Manatees are a federally protected species. The U.S. Fish &
            Wildlife Service produced this three-minute video that every guest
            watches before our tour. It&rsquo;s simple, kid-friendly, and
            covers everything you need to know about being a respectful guest
            in their water.
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
      </Section>

      <Section tone="white" size="md">
        <SectionTitle
          eyebrow="The rules"
          title="Six things every guest agrees to before the boat leaves the dock"
          align="left"
        />
        <ol className="mt-10 grid gap-6 sm:grid-cols-2">
          {rules.map((r, i) => (
            <li
              key={r.title}
              className="rounded-2xl bg-[var(--color-cream)] p-6 border border-[var(--color-ink)]/8 relative"
            >
              <span className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-[var(--color-coral)] text-white font-display text-base flex items-center justify-center shadow-[var(--shadow-card)]">
                {i + 1}
              </span>
              <h3 className="font-display text-lg">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {r.body}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tone="blue" size="md">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Ready when you are.
          </h2>
          <p className="mt-4 text-white/85">
            Watched the video, read the rules — book your slot and meet us at
            the marina.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <Button href="/book" size="lg">
              Book a tour
            </Button>
            <Button href="/faq" size="lg" variant="ghost" className="!text-white hover:!bg-white/10">
              Got more questions?
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
