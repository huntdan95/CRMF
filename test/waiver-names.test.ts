/**
 * Names the signed waiver PDF can't print (src/lib/waiver/fonts.ts): the
 * glyph check against the real font files, the signing page's quick guess
 * (src/lib/waiver/people.ts), and the names a signed record keeps. Run with
 * `npm test` from the repo root: the fonts are read from public/fonts.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { namesForPdf, unprintableChars, type RecordName } from '../src/lib/waiver/fonts';
import { initialsOf, isLatinName, mayNotPrint } from '../src/lib/waiver/people';
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
