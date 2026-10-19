/**
 * Waiver coverage (who on a booking is covered) and the waiver text's
 * Florida guard rails. Run with `npm test` in functions/.
 *
 * Imports the Next app's copies from ../../src as well: the two coverage
 * copies must agree, and the agreement text lives only there.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

import { waiverCoverage, type WaiverForCoverage } from '../src/lib/waiver-coverage';
import { waiverCoverage as appCoverage } from '../../src/lib/waiver/people';
import { isPadSizedPng } from '../../src/lib/waiver/signature';
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
    assert.equal(c.complete, true);
  });

  test('a roster pick covers a child signed for under their legal name', () => {
    // The signing page keeps the tapped guest while the name is corrected.
    const c = both([{ name: 'Ann Lee', age: 40 }, { name: 'Katie Lee', age: 9 }], 2, [
      {
        id: '1',
        signer: { name: 'Ann Lee', participating: true, rosterName: 'Ann Lee' },
        minors: [{ name: 'Katherine Lee', rosterName: 'Katie Lee' }],
      },
    ]);
    assert.equal(c.roster[1]!.covered?.name, 'Katherine Lee');
    assert.equal(c.complete, true);
  });

  test('a guest left blank on the roster is an unnamed guest', () => {
    // Travis raised the party size and didn't know the new names yet.
    const c = both([{ name: 'Ann Lee', age: 40 }, { name: '', age: null }], 2, [
      adult('1', 'Ann Lee'),
      adult('2', 'Carl Smith'),
    ]);
    assert.deepEqual(c.roster.map((r) => r.name), ['Ann Lee']);
    assert.equal(c.signedCount, 2);
    assert.equal(c.complete, true);
  });

  test('with no party size on file, signers count but it is never complete', () => {
    assert.equal(both([], 0, []).complete, false);
    const c = both([], 0, [adult('1', 'Ann Lee'), adult('2', 'Carl Smith')]);
    assert.equal(c.signedCount, 2);
    assert.equal(c.needed, 0);
    assert.equal(c.complete, false);
  });
});

describe('isPadSizedPng', () => {
  // CRCs are left zero: neither this check nor the PDF renderer reads them.
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = (width: number, height: number) => {
    const data = Buffer.alloc(13);
    data.writeUInt32BE(width, 0);
    data.writeUInt32BE(height, 4);
    data[8] = 8; // bit depth
    data[9] = 6; // RGBA, as a canvas exports
    return chunk('IHDR', data);
  };
  const png = (width: number, height: number, raw: Buffer, extra: Buffer[] = []) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr(width, height),
      ...extra,
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  const blank = (width: number, height: number) => Buffer.alloc(height * (1 + width * 4));

  test('takes what the pad draws at 2× on the widest page', () => {
    assert.equal(isPadSizedPng(png(1124, 340, blank(1124, 340))), true);
  });

  test('refuses a huge image, however small the file', () => {
    assert.equal(isPadSizedPng(png(8000, 8000, Buffer.alloc(16))), false);
  });

  test('refuses a small image whose data unpacks to far more than its size', () => {
    assert.equal(isPadSizedPng(png(100, 100, Buffer.alloc(5_000_000))), false);
  });

  test('refuses a second IHDR, which the renderer would use instead', () => {
    assert.equal(isPadSizedPng(png(100, 100, blank(100, 100), [ihdr(8000, 8000)])), false);
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
