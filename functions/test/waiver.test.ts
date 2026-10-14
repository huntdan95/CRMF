/**
 * Waiver coverage (who on a booking is covered) and the waiver text's
 * Florida guard rails. Run with `npm test` in functions/.
 *
 * Imports the Next app's copies from ../../src as well: the two coverage
 * copies must agree, and the agreement text lives only there.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { waiverCoverage, type WaiverForCoverage } from '../src/lib/waiver-coverage';
import { waiverCoverage as appCoverage } from '../../src/lib/waiver/people';
import {
  MINOR_ADDENDUM_SECTIONS,
  RELEASED_PARTY,
  STATUTORY_MINOR_NOTICE,
  waiverDocument,
  waiverPlainText,
} from '../../src/lib/waiver/agreement';

function adult(id: string, name: string, rosterName: string | null = null): WaiverForCoverage {
  return { id, signer: { name, participating: true, rosterName }, minors: [] };
}

function both(
  guests: Array<{ name: string; age: number | null }>,
  guestCount: number,
  waivers: WaiverForCoverage[],
) {
  const fn = waiverCoverage(guests, guestCount, waivers);
  assert.deepEqual(appCoverage(guests, guestCount, waivers), fn, 'the two coverage copies disagree');
  return fn;
}

describe('waiverCoverage', () => {
  const roster = [
    { name: 'Ann Lee', age: 40 },
    { name: 'Bob Lee', age: 42 },
  ];

  test('a stranger signing does not stand in for a named guest', () => {
    const c = both(roster, 2, [adult('1', 'Ann Lee'), adult('2', 'Carl Smith')]);
    assert.equal(c.signedCount, 1);
    assert.equal(c.needed, 2);
    assert.equal(c.roster[1]!.covered, null);
    assert.equal(c.unmatched.length, 1);
  });

  test('an unmatched signer fills a guest the booking never named', () => {
    const c = both(roster, 3, [adult('1', 'Ann Lee'), adult('2', 'Bob Lee'), adult('3', 'Carl Smith')]);
    assert.equal(c.signedCount, 3);
    assert.equal(c.needed, 3);
  });

  test('one person signing twice counts once', () => {
    const c = both(roster, 2, [adult('1', 'Ann Lee'), adult('2', 'ann lee')]);
    assert.equal(c.signedCount, 1);
  });

  test('a parent who is not going covers only the child', () => {
    const c = both([{ name: 'Kid Lee', age: 9 }, { name: 'Ann Lee', age: 40 }], 2, [
      {
        id: '1',
        signer: { name: 'Dan Lee', participating: false, rosterName: null },
        minors: [{ name: 'Kid Lee', rosterName: 'Kid Lee' }],
      },
    ]);
    assert.equal(c.signedCount, 1);
    assert.equal(c.roster[0]!.covered?.minor, true);
    assert.equal(c.roster[1]!.covered, null);
  });

  test('a roster pick covers a renamed guest', () => {
    const c = both(roster, 2, [adult('1', 'Ann Lee'), adult('2', 'Robert Lee', 'Bob Lee')]);
    assert.equal(c.signedCount, 2);
  });
});

describe('waiver text', () => {
  const minor = waiverDocument({ withMinors: true });

  test('the § 744.301(3) notice is uppercase and names the released party', () => {
    assert.equal(STATUTORY_MINOR_NOTICE, STATUTORY_MINOR_NOTICE.toUpperCase());
    assert.equal(STATUTORY_MINOR_NOTICE.split(RELEASED_PARTY.toUpperCase()).length - 1, 3);
    assert.ok(!STATUTORY_MINOR_NOTICE.includes('('), 'a statutory blank was left unfilled');
  });

  test('the minor addendum releases only inherent risks', () => {
    const text = MINOR_ADDENDUM_SECTIONS.flatMap((s) => [...s.paragraphs, ...(s.items ?? [])]).join(' ');
    assert.match(text, /resulting from an inherent risk in the activity/);
    assert.doesNotMatch(text, /operator error|equipment failure|negligence of/i);
    const items = MINOR_ADDENDUM_SECTIONS.flatMap((s) => s.items ?? []).join(' ');
    assert.doesNotMatch(items, /negligen/i);
  });

  test('the adult release, indemnity and fees stay off minors’ claims', () => {
    const adultText = minor.sections.map((s) => s.paragraphs.join(' ')).join(' ');
    assert.match(adultText, /alone governs the release of claims on that child's behalf/);
    const indemnity = minor.sections.find((s) => s.id === 'indemnity')!;
    assert.match(indemnity.paragraphs.join(' '), /does not apply to any claim of a minor child/);
  });

  test('the signer is told they can refuse', () => {
    const text = waiverPlainText(waiverDocument({ withMinors: false }));
    assert.match(text, /You do not have to sign/);
    assert.match(text, /I do not have to sign it/);
  });

  test('the plain text covers the addendum only when signing for minors', () => {
    assert.ok(waiverPlainText(minor).includes(STATUTORY_MINOR_NOTICE));
    assert.ok(!waiverPlainText(waiverDocument({ withMinors: false })).includes(STATUTORY_MINOR_NOTICE));
  });
});
