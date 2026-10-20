/**
 * Names the signed waiver PDF can't print (src/lib/waiver/fonts.ts): the
 * glyph check against the real font files, the signing page's quick guess
 * (src/lib/waiver/people.ts), the names a signed record keeps, and the
 * hidden characters that would make the PDF print something else; and how a
 * signed name is matched to the booking's (nameKey). Run with `npm test` from
 * the repo root: the fonts are read from public/fonts.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { hiddenCharsField, namesForPdf, unprintableChars, type RecordName } from '../src/lib/waiver/fonts';
import { hasHiddenChars, initialsOf, isLatinName, mayNotPrint, nameKey } from '../src/lib/waiver/people';
import type { SignedWaiver } from '../src/lib/waiver/types';

const PRINTS = [
  'Ann Lee',
  "Mary-Jane O'Neil",
  'Łukasz Żółć',
  'Nguyễn Văn Ảnh',
  'Þórður Ægisson',
  'İsmail Güneş',
  'Αλέξανδρος Παππάς',
  'Иван Петров',
  '王伟',
  'さくら タナカ',
];
const DOES_NOT_PRINT = ['김민준', 'محمد علي', 'דוד כהן', 'สมชาย ใจดี', 'राम शर्मा', 'გიორგი', 'Ann 😀'];

describe('unprintableChars', () => {
  test('Latin, Greek, Cyrillic, Chinese and kana print', async () => {
    for (const name of PRINTS) assert.deepEqual(await unprintableChars(name), [], name);
  });

  test('Korean, Arabic, Hebrew, Thai, Devanagari, Georgian and emoji do not', async () => {
    for (const name of DOES_NOT_PRINT) assert.ok((await unprintableChars(name)).length > 0, name);
    assert.deepEqual(await unprintableChars('Ann 😀'), ['😀']);
    assert.deepEqual(await unprintableChars('김민준 김'), ['김', '민', '준']);
  });

  test('initials are whole characters, not half of one outside the BMP', () => {
    assert.equal(initialsOf('𠮷田 太郎'), '𠮷太');
  });

  test('initials made from a Korean name would not print either', async () => {
    // NFKD splits 김 into its jamo, the first of which the fonts lack.
    assert.equal(initialsOf('김민준'), 'ᄀ');
    assert.ok((await unprintableChars(initialsOf('김민준'))).length > 0);
  });
});

describe('the signing page’s guess', () => {
  test('agrees with the fonts on common names', async () => {
    for (const name of [...PRINTS, ...DOES_NOT_PRINT]) {
      assert.equal(mayNotPrint(name), (await unprintableChars(name)).length > 0, name);
    }
  });

  test('English letters, as on a passport', () => {
    for (const ok of ['Kim Minjun', 'KIM MINJUN', 'Zoë O’Neil', 'Ana de la Cruz', 'J. R. Smith', 'Lee-Seoyeon']) {
      assert.ok(isLatinName(ok), ok);
    }
    for (const bad of ['김민준', 'Kim 민준', 'K', '王伟', 'Иван', '123', 'Kim 😀', '']) {
      assert.ok(!isLatinName(bad), bad);
    }
  });
});

describe('nameKey', () => {
  test('a name signed with ø, ł or ß, or an apostrophe, matches the booking typed without', () => {
    const pairs: Array<[string, string]> = [
      ['Søren Jensen', 'Soren Jensen'],
      ['Łukasz Nowak', 'Lukasz Nowak'],
      ['Anna Strauß', 'Anna Strauss'],
      ['Þórður Ægisson', 'Thordur Aegisson'],
      ["Mary O'Neil", 'Mary ONeil'],
      ['Mary O’Neil', "Mary O'Neil"],
      ['José García', 'jose  garcia'],
    ];
    for (const [signed, booked] of pairs) assert.equal(nameKey(signed), nameKey(booked), `${signed} vs ${booked}`);
  });

  test('different people still differ', () => {
    assert.notEqual(nameKey('Mary O’Neil'), nameKey('Mary Neil'));
    assert.notEqual(nameKey('王伟'), nameKey('Иван'));
  });
});

describe('namesForPdf', () => {
  test('asks for every name it can’t print, and says which', async () => {
    const r = await namesForPdf({
      signer: { name: '김민준' },
      minors: [{ name: 'Ann Lee' }, { name: '이서연', latinName: '  ' }],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.field, 'signer.latinName');
    assert.deepEqual(r.latinNamesNeeded, [
      { field: 'signer.latinName', name: '김민준' },
      { field: 'minors.1.latinName', name: '이서연' },
    ]);
    assert.match(r.error, /김민준, 이서연/);
  });

  test('keeps the name exactly as typed, plus the Latin version the PDF prints', async () => {
    const r = await namesForPdf({
      signer: { name: ' 김민준 ', latinName: ' Kim   Minjun ' },
      minors: [
        { name: '이서연', latinName: 'Lee Seoyeon' },
        // A Latin version sent for a name that prints is dropped, so a
        // record's latinName always means the PDF printed it.
        { name: 'Ann Lee', latinName: 'Ann Lee' },
      ],
    });
    assert.ok(r.ok);
    // The record's own field types.
    const signer: Pick<SignedWaiver['signer'], 'name' | 'latinName'> = r.signer;
    const minors: Array<Pick<SignedWaiver['minors'][number], 'name' | 'latinName'>> = r.minors;
    assert.deepEqual(signer, { name: '김민준', latinName: 'Kim Minjun' });
    assert.deepEqual(minors, [
      { name: '이서연', latinName: 'Lee Seoyeon' },
      { name: 'Ann Lee', latinName: null },
    ] satisfies RecordName[]);
  });

  test('a Latin version has to be in Latin letters the PDF can print', async () => {
    const notLatin = await namesForPdf({ signer: { name: '김민준', latinName: '김민준' }, minors: [] });
    assert.ok(!notLatin.ok && notLatin.field === 'signer.latinName' && notLatin.latinNamesNeeded.length === 0);
    assert.match(notLatin.ok ? '' : notLatin.error, /English letters/);

    // U+216C ROMAN NUMERAL FIFTY is Latin script, but the fonts lack it.
    const unprintable = await namesForPdf({
      signer: { name: 'Ann Lee' },
      minors: [{ name: '이서연', latinName: 'Lee SeoⅬyeon' }],
    });
    assert.ok(!unprintable.ok && unprintable.field === 'minors.0.latinName');
    assert.match(unprintable.ok ? '' : unprintable.error, /can’t print “Ⅼ”/);
  });
});

describe('hidden characters', () => {
  // Each "prints" in the fonts (as nothing), so the glyph check passes them.
  const HIDDEN = {
    'right-to-left override': '\u202E',
    'left-to-right isolate': '\u2066',
    'right-to-left mark': '\u200F',
    'zero-width space': '\u200B',
    'word joiner': '\u2060',
    'byte-order mark': '\uFEFF',
    'soft hyphen': '\u00AD',
    NUL: '\u0000',
  };

  test('control and format characters are hidden; letters in any script aren’t', async () => {
    for (const [what, ch] of Object.entries(HIDDEN)) {
      assert.deepEqual(await unprintableChars(`Amy${ch}Lee`), [], `${what} passes the glyph check`);
      assert.ok(hasHiddenChars(`Amy${ch}Lee`), what);
    }
    assert.ok(hasHiddenChars('Amy\tLee'));
    for (const name of [...PRINTS, ...DOES_NOT_PRINT]) assert.ok(!hasHiddenChars(name), name);
  });

  test('joiners only in a name the PDF prints in English letters instead', () => {
    assert.ok(hasHiddenChars('Amy\u200DLee'));
    assert.ok(hasHiddenChars('Amy\u200CLee'));
    assert.ok(!hasHiddenChars('حسین\u200Cزاده', { joinersOk: true }));
    // Nothing else gets through with them.
    assert.ok(hasHiddenChars('\u202Eحسین\u200Cزاده', { joinersOk: true }));
  });

  const signing = {
    signer: { name: 'Ann Lee', latinName: null, email: 'ann@example.com', phone: '352-555-0100', address: '1 Main St, Crystal River, FL' },
    minors: [{ name: 'Sam Lee', latinName: null }],
    accompanyingAdult: null,
    initials: [{ initials: 'AL', at: '2026-10-20T14:04:00.000Z' }],
    clientSignedAt: '2026-10-20T14:05:00.000Z',
    clientTimeZone: 'America/New_York',
  };

  test('the reviewer’s waiver: a name that prints backwards, and one with NUL and a zero-width space', async () => {
    const r = await hiddenCharsField({
      ...signing,
      signer: { ...signing.signer, name: '\u202EJohn Smith' },
      minors: [{ name: 'Amy\u200B\u0000Lee', latinName: null }],
    });
    assert.equal(r?.field, 'signer.name');
    assert.match(r!.error, /hidden character in your name/);
    const minor = await hiddenCharsField({ ...signing, minors: [{ name: 'Amy\u200B\u0000Lee', latinName: null }] });
    assert.equal(minor?.field, 'minors.0.name');
    assert.match(minor!.error, /hidden character in the child’s name/);
  });

  test('names each field the PDF prints as typed', async () => {
    const rlo = '\u202E';
    const cases: Array<[string, Parameters<typeof hiddenCharsField>[0]]> = [
      ['signer.latinName', { ...signing, signer: { ...signing.signer, name: '김민준', latinName: `Kim${rlo} Minjun` } }],
      ['minors.0.latinName', { ...signing, minors: [{ name: '이서연', latinName: `Lee${rlo} Seoyeon` }] }],
      ['signer.email', { ...signing, signer: { ...signing.signer, email: `ann${rlo}@example.com` } }],
      ['signer.phone', { ...signing, signer: { ...signing.signer, phone: `352${rlo}-555-0100` } }],
      ['signer.address', { ...signing, signer: { ...signing.signer, address: `${rlo}1 Main St, Crystal River, FL` } }],
      ['accompanyingAdult', { ...signing, accompanyingAdult: `Bob${rlo} Lee` }],
      ['initials-text', { ...signing, initials: [{ initials: `A${rlo}L`, at: signing.initials[0]!.at }] }],
    ];
    for (const [field, input] of cases) assert.equal((await hiddenCharsField(input))?.field, field, field);

    // Set by the signing page, not typed: nothing for the guest to fix.
    for (const input of [
      { ...signing, clientSignedAt: `${rlo}2026-10-20T14:05:00.000Z` },
      { ...signing, clientTimeZone: `America/New_York${rlo}` },
      { ...signing, initials: [{ initials: 'AL', at: `${rlo}2026-10-20T14:04:00.000Z` }] },
    ]) {
      const r = await hiddenCharsField(input);
      assert.ok(r && !r.field && /Reload/.test(r.error));
    }
  });

  test('a Persian name with a non-joiner goes on to its English-letters version', async () => {
    const persian = 'حسین\u200Cزاده';
    assert.equal(await hiddenCharsField({ ...signing, signer: { ...signing.signer, name: persian } }), null);
    const names = await namesForPdf({ signer: { name: persian, latinName: 'Hosseinzadeh' }, minors: [] });
    assert.ok(names.ok && names.signer.latinName === 'Hosseinzadeh');
    // A name the PDF prints as typed can't have one.
    assert.equal((await hiddenCharsField({ ...signing, signer: { ...signing.signer, name: 'Amy\u200CLee' } }))?.field, 'signer.name');
  });

  test('ordinary waivers pass', async () => {
    assert.equal(await hiddenCharsField(signing), null);
    assert.equal(
      await hiddenCharsField({ ...signing, signer: { ...signing.signer, name: '김민준', latinName: 'Kim Minjun' } }),
      null,
    );
  });
});
