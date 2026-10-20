/**
 * The FAQ answers written from what Travis sets in Admin → Tours and
 * Settings (liveFaqSections in src/lib/faq.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { faqSections, liveFaqSections } from '../src/lib/faq';
import { kindPriceRanges } from '../src/lib/pricing';
import { DEFAULT_WETSUIT_SIZES, type WetsuitSizes } from '../src/lib/site-settings';
import { tours, type MarketingTour } from '../src/lib/tours';

const TIMES = 'What times are the tours?';
const SIZES = 'What sizes are your wetsuits?';

function answer(sections: typeof faqSections, q: string): string {
  const f = sections.flatMap((s) => s.faqs).find((x) => x.q === q);
  assert.ok(f, q);
  return f.a;
}

function live(list: MarketingTour[] = tours, wetsuitSizes: WetsuitSizes = DEFAULT_WETSUIT_SIZES) {
  return liveFaqSections({ prices: kindPriceRanges(list, '2026-10-20', []), tours: list, wetsuitSizes });
}

const switchedOff = (slugs: string[]) => tours.map((t) => (slugs.includes(t.slug) ? { ...t, active: false } : t));

describe('liveFaqSections', () => {
  test('with the built-in tours and sizes, the answers read as written', () => {
    const sections = live();
    assert.equal(answer(sections, TIMES), answer(faqSections, TIMES));
    assert.equal(answer(sections, SIZES), answer(faqSections, SIZES));
  });

  test('a departure switched off in Admin → Tours is not offered', () => {
    const a = answer(live(switchedOff(['late-afternoon-shared', 'late-afternoon-private'])), TIMES);
    assert.ok(a.startsWith('Two-hour tours leave at 8:00 AM, 10:30 AM, and 1:00 PM, and each time runs'), a);
    assert.ok(!a.includes('3:30'), a);
  });

  test("a time running as one kind only doesn't claim to run as either", () => {
    const a = answer(live(switchedOff(['late-afternoon-shared'])), TIMES);
    assert.ok(a.includes('3:30 PM.'), a);
    assert.ok(!a.includes('either'), a);
  });

  test('the whole-day sentence goes when the whole day is off', () => {
    assert.ok(!answer(live(switchedOff(['whole-day-private'])), TIMES).includes('whole-day'));
  });

  test('sizes come from Settings: a range while unbroken, otherwise each one', () => {
    const fewer = answer(live(tours, { adult: ['S', 'M', 'L', 'XL', '2XL', '3XL'], kids: ['4', '6', '8'] }), SIZES);
    assert.ok(fewer.startsWith("Adult sizes S through 3XL, and kids' sizes 4 to 8."), fewer);
    const gap = answer(live(tours, { adult: ['S', 'M', 'XL'], kids: ['8'] }), SIZES);
    assert.ok(gap.startsWith("Adult sizes S, M, and XL, and kids' size 8."), gap);
  });
});
