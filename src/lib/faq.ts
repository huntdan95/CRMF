/**
 * Every FAQ answer on the site. The /faq page renders all of it (and the
 * FAQPage structured data); the home and tour pages pull a few by question.
 */
import { siteConfig } from './site-config';

export interface Faq {
  q: string;
  a: string;
}

export const faqSections: { id: string; heading: string; faqs: Faq[] }[] = [
  {
    id: 'before',
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
        a: "Confident swimmers do better, but every guest wears a wetsuit, which floats. If you're nervous in the water, mention it when booking — the water is usually 6 to 8 feet deep, so your guide will stay right beside you and you can hold a float the whole time.",
      },
      {
        q: 'Where do we meet?',
        a: `Pete's Pier Marina, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region} ${siteConfig.marina.postalCode}. We meet at the dock 15 minutes before your tour time.`,
      },
      {
        q: 'Do I have to wear a wetsuit?',
        a: 'Yes, every guest wears one. It keeps you warm in the 72°F spring water and floats you at the surface, which is the best way to watch manatees without disturbing them.',
      },
      {
        q: 'What sizes are your wetsuits?',
        a: "Adult sizes S through 4XL, and kids' sizes 2 to 16. Pick a size for each guest when you book and we'll have them ready before you arrive. If anyone needs something specific, mention it when booking or call Travis.",
      },
      {
        q: "What if I've never snorkeled before?",
        a: "Most people are comfortable within a few minutes. Travis walks everyone through it on the boat, and he's in the water with your group the whole time if you need a hand.",
      },
      {
        q: 'Where can we change clothes?',
        a: "There's a restroom at Pete's Pier you can change in.",
      },
    ],
  },
  {
    id: 'prices',
    heading: 'Prices and tour times',
    faqs: [
      {
        q: "What's the difference between a shared and a private tour?",
        a: "On a shared tour you book seats and share the boat with other guests, six people at most. It's the most affordable way to go and a good fit for couples, solo travelers, and small families. On a private tour the whole boat is yours, for you and up to five guests, so you set the pace and choose your light.",
      },
      {
        q: 'How much does a manatee tour cost?',
        a: 'Shared tours are $84 per person. Private two-hour tours are $500 for the whole boat (up to six guests), and the whole-day private tour is $895. Snorkel gear, wetsuits, GoPro photos, water, and hot chocolate are included on every tour.',
      },
      {
        q: 'Do children cost the same as adults?',
        a: 'On shared tours, yes. The Coast Guard counts every person on the boat toward the passenger limit, whatever their age, so every guest takes a seat at the same price. Private tours are a flat price for the boat, however old your group is.',
      },
      {
        q: "Is it cheaper if I don't get in the water?",
        a: 'No. Each tour has a limited number of seats and you take one whether or not you swim, so the price is the same.',
      },
      {
        q: 'What times are the tours?',
        a: "Two-hour tours leave at 8:00 AM, 10:30 AM, 1:00 PM, and 3:30 PM, and each time runs as either a shared or a private tour. The whole-day private tour runs from 7:00 AM to 3:00 PM. You'll see what's open on each date when you book.",
      },
    ],
  },
  {
    id: 'on-the-tour',
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
      {
        q: 'How long is the tour, and how long are we in the water?',
        a: "Most tours are two hours; the whole-day private runs from 7:00 AM to 3:00 PM. Time in the water depends on the weather, the tides, and the manatees. Some days they're curious and stay with us; other days we move on to look for more. The calmer and more respectful the group, the longer they tend to stick around.",
      },
      {
        q: 'How deep is the water?',
        a: "Usually shallow. Where we find the manatees it's normally no more than 6 to 8 feet deep, and your wetsuit keeps you floating at the surface the whole time.",
      },
      {
        q: 'Is there shade on the boat?',
        a: 'Yes. The boat has a Bimini top that we raise or lower depending on the weather.',
      },
      {
        q: 'Can I take photos and videos?',
        a: 'Yes. Bring your camera and film as much as you like, just without flash around the manatees. We also shoot the highlights on our underwater GoPro and send you the photos free. Tag us on Instagram!',
      },
    ],
  },
  {
    id: 'rules',
    heading: 'Manatees and the rules',
    faqs: [
      {
        q: 'Is it legal to swim with manatees?',
        a: 'Yes, here. Citrus County, Florida, home to Crystal River and Kings Bay, is the only place in the United States where you can legally swim with manatees. There are strict federal rules, and we follow them on every tour.',
      },
      {
        q: 'What are the rules for swimming with manatees?',
        a: 'Manatees are a federally protected species. Every guest agrees to the USFWS manatee manners when booking: passive observation only, no touching, no chasing, no diving, and no flash photography. We watch the short USFWS video before every tour, and Travis goes over the rules on the boat before anyone gets in.',
      },
      {
        q: 'Does swimming with manatees hurt them?',
        a: "Not when it's done right. A guided swim that follows the rules has little or no effect on how manatees behave. That's why we stick to passive observation and give them space. If they're curious, they come to us.",
      },
    ],
  },
  {
    id: 'booking',
    heading: 'Booking, weather, and cancellations',
    faqs: [
      {
        q: 'How do I book a tour?',
        a: "Book online: pick a date, choose a tour, add everyone's name and wetsuit size, and pay. During checkout you'll confirm you've watched the USFWS manatee manners video and sign the liability waiver. Your confirmation email arrives right away with the marina address and a link to manage your booking.",
      },
      {
        q: 'What if the weather is bad?',
        a: "If Travis cancels the tour for weather, you get a full refund — no questions asked, and we try to re-book you on a better day if you're still in town.",
      },
      {
        q: 'Do you cancel for rain or cold weather?',
        a: "No. We tour rain or shine when conditions are safe, and rain, fog, or a cold morning (common from November to March) won't stop you seeing manatees. Travis cancels for lightning or high winds, and if he does, you get a full refund.",
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

/** Look up answers by their exact question text. */
export function pickFaqs(questions: string[]): Faq[] {
  const all = faqSections.flatMap((s) => s.faqs);
  return questions
    .map((q) => all.find((f) => f.q === q))
    .filter((f): f is Faq => Boolean(f));
}
