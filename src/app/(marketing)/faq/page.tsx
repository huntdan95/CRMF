import type { Metadata } from 'next';
import { Section, SectionTitle } from '@/components/marketing/Section';
import { Button } from '@/components/ui/Button';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'FAQ — Manatee Tour Questions Answered',
  description:
    "Answers to the most common Crystal River Manatee Fun questions: what to wear, weather, cancellations, age limits, water clarity, and what's included.",
  alternates: { canonical: `${siteConfig.url}/faq` },
};

interface Faq {
  q: string;
  a: string;
}

const sections: { heading: string; faqs: Faq[] }[] = [
  {
    heading: 'Before the tour',
    faqs: [
      {
        q: 'When is the best time of year to see manatees?',
        a: "Mid-November through March is peak season. Manatees gather in the warmer spring water when the Gulf cools down. April-October you'll still see them, just in smaller numbers — and the water is warmer, which most kids prefer.",
      },
      {
        q: 'What should I bring?',
        a: "A swimsuit, a towel, reef-safe sunscreen, and cash for a tip if you're so inclined. Snorkel gear, wetsuit, bottled water, and hot chocolate are all on the boat.",
      },
      {
        q: "What's included with the tour?",
        a: "Every tour includes (1) free GoPro photos — we shoot the highlights underwater and email you the files, no $200 photo package upsell, (2) a dedicated in-water swim guide who stays with your group the whole time, (3) wetsuit, mask, snorkel, and fins sized to fit, and (4) bottled water plus hot chocolate on the boat. Just bring a swimsuit and your own towel.",
      },
      {
        q: 'Is there an age limit?',
        a: "No minimum, but kids under 8 may struggle with the snorkel mask. We've taken babies on the boat (mom and dad take turns in the water). If you're unsure, call Travis — he'll tell you honestly whether the trip will be fun for your family.",
      },
      {
        q: 'Do I need to know how to swim?',
        a: "Confident swimmers do better, but every guest wears a wetsuit, which floats. If you're nervous in the water, mention it when booking — we'll make sure you stay where you can touch.",
      },
      {
        q: 'Where do we meet?',
        a: `Pete's Pier Marina, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region} ${siteConfig.marina.postalCode}. We meet at the dock 15 minutes before your tour time.`,
      },
    ],
  },
  {
    heading: 'On the tour',
    faqs: [
      {
        q: 'How clear is the water?',
        a: "Most days the springs are bath-clear (60-100 feet of visibility). Some days, especially after heavy rain, the run-off makes the river slightly tinted — but the springs themselves stay clear.",
      },
      {
        q: 'How cold is the water?',
        a: "The springs are a constant 72°F (22°C) year-round. That feels cold in winter and refreshing in summer. Wetsuits make it comfortable either way.",
      },
      {
        q: 'Will we definitely see manatees?',
        a: "In winter, almost always — they're literally clustered in the springs to keep warm. In summer it's less certain. We've had 99% sighting rates in the last three winter seasons. If we go out and see nothing (very rare), we'll re-book you free.",
      },
      {
        q: 'Can I touch the manatees?',
        a: "No, and yes. You can't approach them or reach out. But sometimes a curious manatee swims right up to you — that's allowed because they're the ones who initiated. Travis covers all of this on the boat before we get in the water.",
      },
    ],
  },
  {
    heading: 'Booking, weather, and cancellations',
    faqs: [
      {
        q: 'What if the weather is bad?',
        a: "If Travis cancels the tour for weather, you get a full refund — no questions asked, and we try to re-book you on a better day if you're still in town.",
      },
      {
        q: "What if I need to cancel?",
        a: "Cancel 72+ hours before your tour: full refund. 24-72 hours before: 50% refund. Less than 24 hours: no refund (but you can call Travis — he'll work with you if you're sick or had a family emergency).",
      },
      {
        q: 'Can I reschedule?',
        a: "Yes. Use the self-service link in your confirmation email to request a reschedule, or call. We'll move you to the next available slot at no charge if there's space.",
      },
      {
        q: 'Do you take groups bigger than six?',
        a: "Not on one boat — six is the hard cap. For larger groups (bachelor/bachelorette, multi-family, corporate), call Travis. He has a network of trusted captains and can sometimes arrange two or three boats to run together.",
      },
    ],
  },
];

// JSON-LD for FAQ rich result
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: sections.flatMap((s) =>
    s.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  ),
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <Section tone="cream" size="md">
        <SectionTitle
          eyebrow="Frequently asked"
          title="The questions we hear before every tour."
          description="If you don't see your answer here, call Travis directly. He always picks up if he isn't on the water."
        />
      </Section>

      {sections.map((section) => (
        <Section
          key={section.heading}
          tone={section === sections[0] ? 'white' : section === sections[1] ? 'cream' : 'white'}
          size="md"
        >
          <h2 className="font-display text-2xl sm:text-3xl mb-6">
            {section.heading}
          </h2>
          <div className="space-y-3 max-w-3xl">
            {section.faqs.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl bg-white border border-[var(--color-ink)]/10 px-5 py-4 open:shadow-[var(--shadow-card)] transition-shadow"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
                  <h3 className="font-display text-base sm:text-lg leading-snug">
                    {f.q}
                  </h3>
                  <span
                    aria-hidden
                    className="shrink-0 w-7 h-7 rounded-full bg-[var(--color-brand-blue)]/10 text-[var(--color-brand-blue)] inline-flex items-center justify-center group-open:rotate-45 transition-transform"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-sm sm:text-base leading-relaxed text-[var(--color-ink-soft)]">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </Section>
      ))}

      <Section tone="blue" size="md">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl text-white leading-tight">
            Still have questions?
          </h2>
          <p className="mt-4 text-white/85">
            Call, text, or fill out the contact form — Travis usually replies
            same day.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <a
              href={siteConfig.contact.phoneHref}
              className="inline-flex items-center px-6 py-3.5 rounded-full bg-white text-[var(--color-brand-blue)] font-medium"
            >
              Call {siteConfig.contact.phone}
            </a>
            <Button href="/contact" variant="ghost" className="!text-white hover:!bg-white/10">
              Send a message
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
